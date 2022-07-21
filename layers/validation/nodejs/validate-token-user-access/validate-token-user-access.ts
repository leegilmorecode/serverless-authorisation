import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import middy from "@middy/core";

// middleware to ensure the user is who they say they are based on access token and resource path
export const validateTokenUserAccessMiddleware = (
  resourcePathValue: string
): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> => {
  const before: middy.MiddlewareFn<
    APIGatewayProxyEvent,
    APIGatewayProxyResult
  > = async ({ event }): Promise<void> => {
    const params = event.pathParameters;

    if (!params) throw new Error("missing path parameters");

    const resource = params[resourcePathValue];
    const { sub } = event.requestContext.authorizer?.claims;

    // log the sub (user principal id) to show this working
    console.log(`sub: ${sub}`);

    // if the user in the path params is not the user in the token then throw error
    if (resource !== sub) {
      console.log(`User: ${sub} does not have access to ${resource}`);
      throw new Error("You dont have access to this user");
    }
    console.log("access token validated successfully");
  };

  const after: middy.MiddlewareFn<
    APIGatewayProxyEvent,
    APIGatewayProxyResult
  > = async (): Promise<void> => {};

  return {
    before,
    after,
  };
};
