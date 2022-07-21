import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";

import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";

import { Construct } from "constructs";

export class ExternalStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // import the lambda layer from the infra stack
    const validationLayerArn = cdk.Fn.importValue("ValidationLayerVersionArn");
    const validationLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "ValidationLayer",
      validationLayerArn
    );

    // create the lambda handlers for the api
    const getOrders: nodeLambda.NodejsFunction = new nodeLambda.NodejsFunction(
      this,
      "GetSushiOrdersHandler",
      {
        functionName: "get-sushi-orders-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/get-orders/get-orders.ts"),
        memorySize: 1024,
        layers: [validationLayer],
        handler: "getOrders",
        environment: {},
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      }
    );

    const getOrder: nodeLambda.NodejsFunction = new nodeLambda.NodejsFunction(
      this,
      "GetSushiOrderHandler",
      {
        functionName: "get-sushi-order-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/get-order/get-order.ts"),
        memorySize: 1024,
        layers: [validationLayer],
        handler: "getOrder",
        environment: {},
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      }
    );

    const createOrder: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "CreateSushiOrderHandler", {
        functionName: "create-sushi-order-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/create-order/create-order.ts"),
        memorySize: 1024,
        layers: [validationLayer],
        handler: "createOrder",
        environment: {},
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // create the api for the orders
    const ordersAPI: apigw.RestApi = new apigw.RestApi(this, "OrdersApi", {
      restApiName: "sushi-orders-api",
      deploy: true,
      description: "LJG Sushi Orders API",
      deployOptions: {
        stageName: "prod",
        dataTraceEnabled: false,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        tracingEnabled: false,
        metricsEnabled: false,
      },
    });

    // add the usage plan for the api
    const usagePlan: apigw.UsagePlan = ordersAPI.addUsagePlan(
      "ExternalConsumerUsagePlan",
      {
        name: "ExternalConsumer",
        description: "Usage plan for external customers",
        apiStages: [
          {
            api: ordersAPI,
            stage: ordersAPI.deploymentStage,
          },
        ],
        throttle: {
          rateLimit: 10,
          burstLimit: 2,
        },
      }
    );
    usagePlan.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // add a specific api key for the usage plan
    const keyValue = "SuperSecretKey!12345";
    const key = ordersAPI.addApiKey("ApiKey", {
      apiKeyName: "ExternalConsumerApiKey",
      description: "The API key for the external consumer company",
      value: keyValue,
    });

    usagePlan.addApiKey(key);

    // create the cognito user pool for auth
    const authUserPool: cognito.UserPool = new cognito.UserPool(
      this,
      "SushiAuthUserPool",
      {
        userPoolName: "SushiAuthUserPool",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // create a user pool domain
    new cognito.UserPoolDomain(this, "SushiOrdersUserPoolDomain", {
      userPool: authUserPool,
      cognitoDomain: {
        domainPrefix: "sushi-orders-user-pool-domain",
      },
    });

    // create the scopes which are required
    const createOrderScope: cognito.ResourceServerScope =
      new cognito.ResourceServerScope({
        scopeName: "create.order",
        scopeDescription: "createOrderScope",
      });

    const getOrdersScope: cognito.ResourceServerScope =
      new cognito.ResourceServerScope({
        scopeName: "list.orders",
        scopeDescription: "getOrdersScope",
      });

    const getOrderScope: cognito.ResourceServerScope =
      new cognito.ResourceServerScope({
        scopeName: "get.order",
        scopeDescription: "getOrderScope",
      });

    // create the resource server
    const resourceServer: cognito.UserPoolResourceServer =
      authUserPool.addResourceServer("SushiApiResourceServer", {
        userPoolResourceServerName: "SushiApiResourceServer",
        identifier: "orders",
        scopes: [createOrderScope, getOrdersScope, getOrderScope],
      });

    // create the client i.e. the consumer of the resource server
    new cognito.UserPoolClient(this, "ExternalOrdersCompanyClient", {
      userPool: authUserPool,
      userPoolClientName: "ExternalOrdersCompanyClient",
      preventUserExistenceErrors: true,
      refreshTokenValidity: Duration.minutes(60),
      accessTokenValidity: Duration.minutes(60),
      generateSecret: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: [
          // it has the scopes assigned for creating orders
          cognito.OAuthScope.resourceServer(resourceServer, createOrderScope),
          // it has the scopes assigned for getting orders
          cognito.OAuthScope.resourceServer(resourceServer, getOrdersScope),
          // it has the scopes assigned for getting a specific order
          cognito.OAuthScope.resourceServer(resourceServer, getOrderScope),
        ],
      },
    });

    // access the user pool to get the arn
    const userPool: cognito.IUserPool = cognito.UserPool.fromUserPoolId(
      this,
      "SushiUserPool",
      authUserPool.userPoolId
    );

    // add the cognito authorizer to our api which validates our tokens using cognito
    const cognitoAuthorizer: apigw.CfnAuthorizer = new apigw.CfnAuthorizer(
      this,
      "APIGatewayAuthorizer",
      {
        name: "sushi-orders-authorizer",
        identitySource: "method.request.header.Authorization",
        providerArns: [userPool.userPoolArn],
        restApiId: ordersAPI.restApiId,
        type: apigw.AuthorizationType.COGNITO,
      }
    );

    // create the company resource
    const companys: apigw.Resource = ordersAPI.root.addResource("companies");
    const company: apigw.Resource = companys.addResource("{company_id}");

    // create the order api
    const orders: apigw.Resource = company.addResource("orders");
    const order: apigw.Resource = orders.addResource("{id}");

    // add the endpoint for getting all orders
    orders.addMethod(
      "GET",
      new apigw.LambdaIntegration(getOrders, {
        proxy: true,
        allowTestInvoke: true,
      }),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
        apiKeyRequired: true, // ensure that the consumer needs to send the api key
        authorizer: { authorizerId: cognitoAuthorizer.ref }, // the cognito authoriser will ensure we have a token
        authorizationScopes: [`orders/${getOrdersScope.scopeName}`], // ensure the token has the correct scope
      }
    );

    // add the endpoint for getting a specific order
    order.addMethod(
      "GET",
      new apigw.LambdaIntegration(getOrder, {
        proxy: true,
        allowTestInvoke: true,
      }),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
        apiKeyRequired: true, // ensure that the consumer needs to send the api key
        authorizer: { authorizerId: cognitoAuthorizer.ref }, // the cognito authoriser will ensure we have a token
        authorizationScopes: [`orders/${getOrderScope.scopeName}`], // ensure the token has the correct scope
      }
    );

    // add the endpoint for creating an order
    orders.addMethod(
      "POST",
      new apigw.LambdaIntegration(createOrder, {
        proxy: true,
        allowTestInvoke: true,
      }),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
        apiKeyRequired: true, // ensure that the consumer needs to send the api key
        authorizer: { authorizerId: cognitoAuthorizer.ref }, // the cognito authoriser will ensure we have a token
        authorizationScopes: [`orders/${createOrderScope.scopeName}`], // ensure the token has the correct scope
      }
    );
  }
}
