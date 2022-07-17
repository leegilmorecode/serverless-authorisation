import * as AWS from "aws-sdk";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventPathParameters,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

type UserPermission = {
  id: string;
  companies: string[];
  role: string;
};

const AmazonDaxClient = require("amazon-dax-client");

const dax = new AmazonDaxClient({
  endpoints: [process.env.DAX_ENDPOINT],
  region: process.env.REGION,
});
const dynamoDb: AWS.DynamoDB.DocumentClient = new AWS.DynamoDB.DocumentClient({
  service: dax,
});

export const getPermissionsHandler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "get-permissions.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event.pathParameters) {
      throw new Error("no path parameters");
    }

    const params: APIGatewayProxyEventPathParameters = event.pathParameters;
    const { user_id: userId } = params;

    console.log(
      `${prefix} - user: ${userId} - table: ${process.env.TABLE_NAME}`
    );

    const dbParams: AWS.DynamoDB.DocumentClient.GetItemInput = {
      TableName: process.env.TABLE_NAME as string,
      ConsistentRead: false,
      Key: {
        id: userId,
      },
    };

    const { Item: data }: AWS.DynamoDB.DocumentClient.GetItemOutput =
      await dynamoDb.get(dbParams).promise();

    if (!data) throw new Error("item not found");

    // return the user permissions
    const response: UserPermission = {
      id: data.id,
      companies: data.companies,
      role: data.role,
    };

    console.log(`response: ${JSON.stringify(response)}`);

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};
