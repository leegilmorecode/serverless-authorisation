import {
  APIGatewayRequestAuthorizerEvent,
  AuthResponse,
  PolicyDocument,
} from "aws-lambda";

import { CognitoJwtVerifier } from "aws-jwt-verify";
import { CognitoJwtVerifierSingleUserPool } from "aws-jwt-verify/cognito-verifier";
import axios from "axios";
import jwt from "jsonwebtoken";

type DecodedToken = {
  sub: string;
  username: string;
};

let verifier: CognitoJwtVerifierSingleUserPool<{
  userPoolId: string;
  tokenUse: "access";
  clientId: string;
}>;

function generatePolicy(effect: string, resource: string): PolicyDocument {
  const policyDocument = {} as PolicyDocument;
  if (effect && resource) {
    policyDocument.Version = "2012-10-17";
    policyDocument.Statement = [];
    const statementOne: any = {};
    statementOne.Action = "execute-api:Invoke";
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
  }
  console.log(`Policy document: ${JSON.stringify(policyDocument)}`); // Note: this is for the demo only
  return policyDocument;
}

// get the users permissions from a separate service using their token sub
async function getUserPermissions(userId: string) {
  const { data: userPermissions } = await axios.request({
    url: `users/${userId}`,
    method: "get",
    baseURL: process.env.PERMISSIONS_API,
  });

  return userPermissions;
}

// Note - this could be very specific down to different resource path levels but this is an example only
function validatePermissions(
  companyId: string,
  userId: string,
  companies: string[]
) {
  // ensure that the user has access to this company
  if (!companies.find((company: string) => company === companyId)) {
    throw new Error(
      `User ${userId} does not have access to company ${companyId}`
    );
  }
  console.log(
    `User ${userId} has access to companies ${JSON.stringify(companies)}`
  );
}

// ensure that the user has the correct role for this company
// note - again this could be specific to a particular resource path but this is a demo only
function validateRole(userId: string, role: string, userRole: string) {
  if (role !== userRole) {
    throw new Error(
      `User ${userId} is not the role ${role}, they are ${userRole}`
    );
  }
  console.log(`User ${userId} is a ${userRole} role`);
}

const validateToken = async (token: string) => {
  try {
    if (!verifier) {
      if (!process.env.USER_POOL_ID || !process.env.CLIENT_ID) {
        throw new Error("Missing UserPoolID or ClientID");
      }

      verifier = CognitoJwtVerifier.create({
        userPoolId: process.env.USER_POOL_ID,
        tokenUse: "access",
        clientId: process.env.CLIENT_ID,
      });
    }

    // verify the auth token
    const payload = await verifier.verify(token);
    console.log("Token is valid. Payload:", payload); // note: this is for the demo only
  } catch (error) {
    throw new Error(`Token is not valid: ${error}`);
  }
};

export async function authHandler(
  event: APIGatewayRequestAuthorizerEvent
): Promise<AuthResponse> {
  try {
    const authToken = event?.headers?.["Authorization"];

    if (!event.pathParameters || !event.pathParameters?.company_id) {
      throw new Error("missing path parameters");
    }

    if (!authToken) {
      throw new Error("authorization token not found");
    }

    // allows us to perform some resource based auth
    const { company_id: companyId } = event.pathParameters;
    const token = authToken.substring(7);

    // perform authentication (authN)
    await validateToken(token);

    const decodedToken = jwt.decode(token) as DecodedToken;
    if (!decodedToken) throw new Error("token can not be decoded");

    // hydrate the user permissions from a seperate service
    const permissions = await getUserPermissions(decodedToken.username);

    // perform authorisation (authZ)
    validatePermissions(
      companyId,
      decodedToken.username,
      permissions.companies
    );
    validateRole(decodedToken.username, "Manager", permissions.role);

    const policyDoc = generatePolicy("Allow", "*");
    return {
      principalId: decodedToken.sub,
      policyDocument: policyDoc,
      // add the permissions to the context which will make its way to consuming lambda function
      context: {
        id: permissions.id,
        companies: JSON.stringify(permissions.companies),
        role: permissions.role,
      },
    } as AuthResponse;
  } catch (error) {
    console.error("An error happened during authentication", error);
    throw new Error("Unauthorized");
  }
}
