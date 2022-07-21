import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventPathParameters,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  hydrateContext,
  validateCompanyAccessMiddleware,
  validateTokenUserAccessMiddleware,
} from "/opt/nodejs/validation";

import middy from "@middy/core";
import { v4 as uuid } from "uuid";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "get-orders.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event.pathParameters) {
      throw new Error("no path parameters");
    }

    const params: APIGatewayProxyEventPathParameters = event.pathParameters;
    const { user_id } = params;
    const sub = event.requestContext.authorizer?.claims.sub;

    console.log(`UserId: ${user_id}, Sub: ${sub}`);

    // hardcoded for the demo only
    const orders = [
      {
        orderId: uuid(),
        companyId: user_id,
        orderStatus: "PENDING",
      },
      {
        orderId: uuid(),
        companyId: user_id,
        orderStatus: "PENDING",
      },
    ];

    console.log(`response: ${JSON.stringify(orders)}`);

    return {
      statusCode: 200,
      body: JSON.stringify(orders),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};

export const getOrders = middy(handler)
  .use(hydrateContext()) // get the permissions for the user
  .use(validateTokenUserAccessMiddleware("user_id")) // ensure the userId in the url is the same as the sub on the token
  .use(validateCompanyAccessMiddleware("Manager")); // enure that the user has access to the company with the correct role
