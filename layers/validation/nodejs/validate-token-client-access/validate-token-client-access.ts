import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import middy from "@middy/core";

// middleware to ensure the client (B2B) is who they say they are based on access token and resource path
export const validateTokenClientAccessMiddleware = (
  resourcePathValue: string
): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> => {
  const before: middy.MiddlewareFn<
    APIGatewayProxyEvent,
    APIGatewayProxyResult
  > = async ({ event }): Promise<void> => {
    const params = event.pathParameters;

    if (!params) throw new Error("missing path parameters");

    const resource = params[resourcePathValue];
    const { sub: clientId } = event.requestContext.authorizer?.claims;

    // log the sub (client principal id) to show this working
    console.log(`clientId: ${clientId}`); // this is the company id
    console.log(`apiKey: ${event.requestContext.identity.apiKeyId}`); // this is the specific api key used

    // if the user in the path params is not the user in the token then throw error
    if (resource !== clientId) {
      console.log(`Client: ${clientId} does not have access to ${resource}`);
      throw new Error("You dont have access to this company");
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
