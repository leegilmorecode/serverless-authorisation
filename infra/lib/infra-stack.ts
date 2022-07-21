import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as dynamodbDax from "aws-cdk-lib/aws-dax";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import { Construct } from "constructs";

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dynamoDBTableName = "PermissionsTable";

    // create our lambda layer for our middleware
    const validationLayer: lambda.LayerVersion = new lambda.LayerVersion(
      this,
      "ValidationLayer",
      {
        compatibleRuntimes: [
          lambda.Runtime.NODEJS_12_X,
          lambda.Runtime.NODEJS_14_X,
        ],
        code: lambda.Code.fromAsset("../layers/validation"),
        removalPolicy: RemovalPolicy.DESTROY,
        layerVersionName: "ValidationLayer",
        description: "validation middy middlewares",
      }
    );

    // create the vpc for dax to sit in
    const vpc: ec2.Vpc = new ec2.Vpc(this, "VPC", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "private-subnet-1",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // create the dynamodb table
    const permissionsTable: dynamodb.Table = new dynamodb.Table(
      this,
      dynamoDBTableName,
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: dynamoDBTableName,
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: "id",
          type: dynamodb.AttributeType.STRING,
        },
      }
    );

    // create a role for dax
    const daxServiceRole: iam.Role = new iam.Role(this, "DaxServiceRole", {
      assumedBy: new iam.ServicePrincipal("dax.amazonaws.com"),
    });

    // create a subnet group for our dax cluster to utilise
    const subnetGroup: dynamodbDax.CfnSubnetGroup =
      new dynamodbDax.CfnSubnetGroup(this, "DaxSubnetGroup", {
        subnetIds: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        subnetGroupName: "dax-subnet-group",
        description: "subnet group for our dax cluster",
      });

    // add a security group for the dax cluster
    const daxSecurityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      "DaxVpcSg",
      {
        vpc,
        allowAllOutbound: true,
        securityGroupName: "dax-vpc-sg",
      }
    );

    // add a security group for the lambdas
    const lambdaSecurityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      "LambdaVpcSg",
      {
        vpc,
        allowAllOutbound: true,
        securityGroupName: "lambda-vpc-sg",
      }
    );

    // allow inbound traffic from the lambda security group on port 8111
    daxSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(8111));

    // add permissions to the dax policy
    daxServiceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:DescribeTable",
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [permissionsTable.tableArn],
      })
    );

    // create the dynamodb dax cluster
    const permissionsDaxCluster: dynamodbDax.CfnCluster =
      new dynamodbDax.CfnCluster(this, "PermissionsDaxCluster", {
        iamRoleArn: daxServiceRole.roleArn,
        nodeType: "dax.t2.small",
        replicationFactor: 2,
        securityGroupIds: [daxSecurityGroup.securityGroupId],
        subnetGroupName: subnetGroup.subnetGroupName,
        availabilityZones: vpc.availabilityZones,
        clusterEndpointEncryptionType: "NONE",
        clusterName: "DaxCluster",
        description: "permissions dax cluster",
        preferredMaintenanceWindow: "sun:01:00-sun:09:00",
        sseSpecification: {
          sseEnabled: false,
        },
      });

    permissionsDaxCluster.node.addDependency(vpc);
    subnetGroup.node.addDependency(vpc);
    permissionsDaxCluster.node.addDependency(subnetGroup);

    // get the permissions for the user - this uses dax for its caching
    const getPermissionsHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "GetPermissionsLambda", {
        functionName: "get-permissions-lambda",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/permissions/get-permissions/get-permissions.ts"
        ),
        memorySize: 1024,
        securityGroups: [lambdaSecurityGroup],
        handler: "getPermissionsHandler",
        timeout: Duration.seconds(30),
        vpc,
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          TABLE_NAME: permissionsTable.tableName,
          DAX_ENDPOINT: permissionsDaxCluster.attrClusterDiscoveryEndpoint,
        },
      });

    // give the lambdas access to the DAX cluster
    getPermissionsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dax:GetItem"],
        resources: [permissionsDaxCluster.attrArn],
      })
    );

    // create the api for the permissions. Note: This should be a private API with AuthN/AuthZ
    // but this is a demo only for ease and is open without auth
    const permissionsApi: apigw.RestApi = new apigw.RestApi(
      this,
      "PermissionsApi",
      {
        restApiName: "permissions-api",
        deploy: true,
        description: "API for the User Permissions",
        deployOptions: {
          stageName: "prod",
          dataTraceEnabled: false,
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          tracingEnabled: false,
          metricsEnabled: false,
        },
      }
    );

    // create the users resource
    const users: apigw.Resource = permissionsApi.root.addResource("users");
    const user: apigw.Resource = users.addResource("{user_id}");

    // add the endpoint for getting a specific user permission set
    user.addMethod(
      "GET",
      new apigw.LambdaIntegration(getPermissionsHandler, {
        proxy: true,
      })
    );

    // validationLayer export
    new CfnOutput(this, "ValidationLayerVersionArn", {
      value: validationLayer.layerVersionArn,
      exportName: "ValidationLayerVersionArn",
    });

    // export this permissions api url to be used in the other stacks
    new CfnOutput(this, "PermissionsUrl", {
      value: permissionsApi.url,
      exportName: "PermissionsUrl",
    });
  }
}
