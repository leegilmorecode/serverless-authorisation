import {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from "aws-lambda";

import axios from "axios";

// get the users permissions from a separate service using their token sub
async function getUserPermissions(userId: string) {
  const { data: userPermissions } = await axios.request({
    url: `users/${userId}`,
    method: "get",
    baseURL: process.env.PERMISSIONS_API,
  });

  return userPermissions;
}

// use a pre token generation lambda which adds additional context the ID token
// which can be used on the frontend to show/hide ui components
export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
): Promise<any> => {
  try {
    const prefix = "pre-generation.handler";

    console.log(`${prefix} - started`);

    const { userName: userId } = event;

    // hydrate the user permissions from a seperate service
    const permissions = await getUserPermissions(userId);

    console.log(`${prefix} - permissions: ${JSON.stringify(permissions)}`); // logging for the demo only

    const response = {
      ...event,
      response: {
        claimsOverrideDetails: {
          claimsToAddOrOverride: {
            role: permissions.role,
            id: permissions.id,
            companies: JSON.stringify(permissions.companies),
          },
          claimsToSuppress: [],
        },
      },
    };

    console.log(`${prefix} - response: ${JSON.stringify(response)}`);

    return response;
  } catch (error) {
    console.log(error);
  }
};
