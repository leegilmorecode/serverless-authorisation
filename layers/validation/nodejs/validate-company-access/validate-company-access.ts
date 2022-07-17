import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { UserContext } from "../../../types";
import middy from "@middy/core";

// middleware to ensure that the user is part of the given company i.e. permissions
// when getting their order for a specific company, as well as checking their role
export const validateCompanyAccessMiddleware = (
  role: string
): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> => {
  const before: middy.MiddlewareFn<
    APIGatewayProxyEvent,
    APIGatewayProxyResult
  > = async (handler): Promise<void> => {
    const { event } = handler;
    const { sub } = event.requestContext.authorizer?.claims;
    const { user } = handler.context as UserContext;

    const params = event.pathParameters;

    if (!params) throw new Error("missing path parameters");

    const { company_id: companyId } = params;

    // ensure that the user has access to this company
    if (!user.companies.find((company: string) => company === companyId)) {
      throw new Error(
        `User ${sub} does not have access to company ${companyId}`
      );
    }
    console.log(
      `User ${sub} has access to companies ${JSON.stringify(user.companies)}`
    );

    // ensure that the user has the correct role for this company
    if (role !== user.role) {
      throw new Error(
        `User ${sub} is not the role ${role}, they are ${user.role}`
      );
    }
    console.log(`User ${sub} is a ${user.role} role`);
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
