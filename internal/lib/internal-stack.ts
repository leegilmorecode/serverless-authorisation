import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
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

export class InternalStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // import permissions url from the infra stack
    const importedPermissionsApiUrl = cdk.Fn.importValue("PermissionsUrl");
    const validationLayerArn = cdk.Fn.importValue("ValidationLayerVersionArn");

    // import the lambda layer from the infra stack
    const validationLayer: cdk.aws_lambda.ILayerVersion =
      lambda.LayerVersion.fromLayerVersionArn(
        this,
        "ValidationLayer",
        validationLayerArn
      );

    // create the lambda handlers for the api
    const getOrders: nodeLambda.NodejsFunction = new nodeLambda.NodejsFunction(
      this,
      "GetSushiOrdersHandler",
      {
        functionName: "get-sushi-user-orders-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/get-orders/get-orders.ts"),
        memorySize: 1024,
        handler: "getOrders",
        layers: [validationLayer],
        environment: {
          PERMISSIONS_API: importedPermissionsApiUrl,
        },
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
        functionName: "get-sushi-user-order-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/get-order/get-order.ts"),
        memorySize: 1024,
        handler: "getOrder",
        layers: [validationLayer],
        environment: {
          PERMISSIONS_API: importedPermissionsApiUrl,
        },
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      }
    );

    const createOrder: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "CreateSushiOrderHandler", {
        functionName: "create-sushi-user-order-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/create-order/create-order.ts"),
        memorySize: 1024,
        handler: "createOrder",
        layers: [validationLayer],
        environment: {
          PERMISSIONS_API: importedPermissionsApiUrl,
        },
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // create the api for the orders
    const ordersAPI: apigw.RestApi = new apigw.RestApi(this, "OrdersApi", {
      restApiName: "sushi-user-orders-api",
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

    // a lambda handler to run on pre token generation to add to the id token (not access token)
    const preTokenGeneration: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "PreTokenGenerationHandler", {
        functionName: "user-sushi-pre-token-generation",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/pre-generation/pre-generation.ts"),
        memorySize: 1024,
        handler: "handler",
        environment: {
          PERMISSIONS_API: importedPermissionsApiUrl,
        },
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // create the cognito user pool for auth
    const authUserPool: cognito.UserPool = new cognito.UserPool(
      this,
      "SushiAuthUserPool",
      {
        userPoolName: "SushiUserAuthUserPool",
        removalPolicy: RemovalPolicy.DESTROY,
        lambdaTriggers: {
          // https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
          preTokenGeneration,
        },
        signInCaseSensitive: true,
        selfSignUpEnabled: true,
        signInAliases: {
          email: true,
        },
        autoVerify: {
          email: true,
        },
        standardAttributes: {
          givenName: {
            required: true,
            mutable: true,
          },
          familyName: {
            required: true,
            mutable: true,
          },
          phoneNumber: {
            required: true,
            mutable: true,
          },
        },
        customAttributes: {
          companyId: new cognito.StringAttribute({ mutable: true }),
        },
        passwordPolicy: {
          minLength: 6,
          requireLowercase: true,
          requireDigits: true,
          requireUppercase: false,
          requireSymbols: false,
        },
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      }
    );

    // create a user pool domain
    new cognito.UserPoolDomain(this, "SushiUserOrdersUserPoolDomain", {
      userPool: authUserPool,
      cognitoDomain: {
        domainPrefix: "sushi-user-orders-user-pool-domain",
      },
    });

    // create the company resource
    const companies: apigw.Resource = ordersAPI.root.addResource("companies");
    const company: apigw.Resource = companies.addResource("{company_id}");

    // create the user resource
    const users: apigw.Resource = company.addResource("users");
    const user: apigw.Resource = users.addResource("{user_id}");

    // create the order api
    const orders: apigw.Resource = user.addResource("orders");
    const order: apigw.Resource = orders.addResource("{id}");

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
        name: "sushi-user-orders-authorizer",
        identitySource: "method.request.header.Authorization",
        providerArns: [userPool.userPoolArn],
        restApiId: ordersAPI.restApiId,
        type: apigw.AuthorizationType.COGNITO,
      }
    );

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

    const resourceServer: cognito.UserPoolResourceServer =
      authUserPool.addResourceServer("SushiApiResourceServer", {
        userPoolResourceServerName: "SushiApiResourceServer",
        identifier: "orders",
        scopes: [createOrderScope, getOrdersScope, getOrderScope],
      });

    // create the client i.e. the consumer of the resource server
    const userOrdersClient: cognito.UserPoolClient = new cognito.UserPoolClient(
      this,
      "UserOrdersClient",
      {
        userPool: authUserPool,
        userPoolClientName: "UserOrdersClient",
        preventUserExistenceErrors: true,
        refreshTokenValidity: Duration.minutes(60),
        accessTokenValidity: Duration.minutes(60),
        generateSecret: true,
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.COGNITO,
        ],
        oAuth: {
          flows: {
            implicitCodeGrant: true,
          },
          scopes: [
            // it has the scopes assigned for creating orders
            cognito.OAuthScope.resourceServer(resourceServer, createOrderScope),
            // it has the scopes assigned for getting orders
            cognito.OAuthScope.resourceServer(resourceServer, getOrdersScope),
            // it has the scopes assigned for getting a specific order
            cognito.OAuthScope.resourceServer(resourceServer, getOrderScope),
            // openid scopes
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.PHONE,
            cognito.OAuthScope.PROFILE,
          ],
          callbackUrls: ["http://localhost:8080"],
          logoutUrls: ["http://localhost:8080"],
        },
      }
    );

    // add the endpoint for getting all orders
    orders.addMethod(
      "GET",
      new apigw.LambdaIntegration(getOrders, {
        proxy: true,
        allowTestInvoke: true,
      }),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
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
        authorizer: { authorizerId: cognitoAuthorizer.ref }, // the cognito authoriser will ensure we have a token
        authorizationScopes: [`orders/${createOrderScope.scopeName}`], // ensure the token has the correct scope
      }
    );

    // export values for other stacks
    new CfnOutput(this, "InternalUserPoolID", {
      value: authUserPool.userPoolId,
      exportName: "InternalUserPoolID",
    });

    // export values for other stacks
    new CfnOutput(this, "InternalUserPoolClientId", {
      value: userOrdersClient.userPoolClientId,
      exportName: "InternalUserPoolClientId",
    });
  }
}
