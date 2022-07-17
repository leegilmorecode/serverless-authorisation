import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";

import { Duration, Stack, StackProps } from "aws-cdk-lib";

import { Construct } from "constructs";

export class VouchersStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // import values from the internal stack
    const internalUserPoolID = cdk.Fn.importValue("InternalUserPoolID");
    const internalUserPoolClientId = cdk.Fn.importValue(
      "InternalUserPoolClientId"
    );
    const importedPermissionsApiUrl = cdk.Fn.importValue("PermissionsUrl");

    // create the lambda handlers for the api
    const validateVoucher: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "ValidateSushiVoucherHandler", {
        functionName: "validate-sushi-voucher-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/validate-voucher/validate-voucher.ts"
        ),
        memorySize: 1024,
        handler: "validateVoucher",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // add the lambda authorizer
    const authHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "AuthHandler", {
        functionName: "voucher-auth-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/auth-handler/auth-handler.ts"),
        memorySize: 1024,
        handler: "authHandler",
        environment: {
          USER_POOL_ID: internalUserPoolID,
          CLIENT_ID: internalUserPoolClientId,
          PERMISSIONS_API: importedPermissionsApiUrl,
        },
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // create the api for the vouchers
    const vouchersApi: apigw.RestApi = new apigw.RestApi(this, "VouchersApi", {
      restApiName: "vouchers-api",
      deploy: true,
      description: "LJG Sushi Vouchers API",
      deployOptions: {
        stageName: "prod",
        dataTraceEnabled: false,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        tracingEnabled: false,
        metricsEnabled: false,
      },
    });

    // create the company resource
    const companies: apigw.Resource = vouchersApi.root.addResource("companies");
    const company: apigw.Resource = companies.addResource("{company_id}");

    // create the user resource
    const users: apigw.Resource = company.addResource("users");
    const user: apigw.Resource = users.addResource("{user_id}");

    // create the vouchers api
    const vouchers: apigw.Resource = user.addResource("vouchers");
    const voucher: apigw.Resource = vouchers.addResource("{id}");

    const authorizer: apigw.RequestAuthorizer = new apigw.RequestAuthorizer(
      this,
      "RequestLambdaAuthorizer",
      {
        handler: authHandler,
        identitySources: [apigw.IdentitySource.header("Authorization")],
        authorizerName: "rest-api-authorizer",
        resultsCacheTtl: Duration.minutes(5), // cache the token/iam policy for 5 mins
      }
    );

    // add the endpoint for validating a specific voucher by id
    voucher.addMethod(
      "GET",
      new apigw.LambdaIntegration(validateVoucher, {
        proxy: true,
        allowTestInvoke: true,
      }),
      {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: authorizer,
      }
    );
  }
}
