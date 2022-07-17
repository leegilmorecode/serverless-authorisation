import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventPathParameters,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import middy from "@middy/core";
import { v4 as uuid } from "uuid";
import { validateTokenClientAccessMiddleware } from "/opt/nodejs/validation";

const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "get-order.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event.pathParameters) {
      throw new Error("no path parameters");
    }

    const params: APIGatewayProxyEventPathParameters = event.pathParameters;
    const { company_id, id } = params;

    const clientId = event.requestContext.authorizer?.claims.sub;

    console.log(
      `CompanyId: ${company_id}, OrderId: ${id}, ClientId: ${clientId}`
    );

    // hardcoded return value for the demo
    const order = {
      orderId: id,
      companyId: company_id,
      orderStatus: "PENDING",
    };

    console.log(`response: ${JSON.stringify(order)}`);

    return {
      statusCode: 200,
      body: JSON.stringify(order),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};

export const getOrder = middy(handler).use(
  validateTokenClientAccessMiddleware("company_id") // ensure that the token has access to the company
);
