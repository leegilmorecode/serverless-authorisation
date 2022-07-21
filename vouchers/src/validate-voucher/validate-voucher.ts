import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

export const validateVoucher: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "validate-voucher.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    console.log(`Context: ${JSON.stringify(event.requestContext)}`);

    // simply return a hardcoded value for the demo
    return {
      statusCode: 200,
      body: JSON.stringify("validated"),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};
