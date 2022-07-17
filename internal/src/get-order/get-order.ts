import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventPathParameters,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  hydrateContext,
  validateCompanyAccessMiddleware,
  validateTokenUserAccessMiddleware,
} from "/opt/nodejs/validation";

import middy from "@middy/core";
import { v4 as uuid } from "uuid";

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
    const { user_id, id } = params;

    const sub = event.requestContext.authorizer?.claims.sub;

    console.log(`UserId: ${user_id}, OrderId: ${id}, Sub: ${sub}`);

    // hardcoded for the demo only
    const order = {
      orderId: id,
      companyId: user_id,
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

export const getOrder = middy(handler)
  .use(hydrateContext()) // get the permissions for the user
  .use(validateTokenUserAccessMiddleware("user_id")) // ensure the userId in the url is the same as the sub on the token
  .use(validateCompanyAccessMiddleware("Manager")); // enure that the user has access to the company with the correct role
