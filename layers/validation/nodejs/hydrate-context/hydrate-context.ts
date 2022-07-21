import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { UserContext } from "../../../types";
import axios from "axios";
import middy from "@middy/core";

// middleware to ensure that the user is part of the given company i.e. permissions
export const hydrateContext = (): middy.MiddlewareObj<
  APIGatewayProxyEvent,
  APIGatewayProxyResult
> => {
  const before: middy.MiddlewareFn<
    APIGatewayProxyEvent,
    APIGatewayProxyResult
  > = async (handler): Promise<void> => {
    const { event } = handler;
    const params = event.pathParameters;

    if (!params) throw new Error("missing path parameters");

    const { sub: userId } = event.requestContext.authorizer?.claims;

    // make a call to the user permissions service and add to the context
    const { data: userPermissions } = await axios.request({
      url: `users/${userId}`,
      method: "get",
      baseURL: process.env.PERMISSIONS_API,
    });

    // update the context object with the user permissions
    Object.assign(handler.context as UserContext, {
      user: userPermissions,
    });
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
