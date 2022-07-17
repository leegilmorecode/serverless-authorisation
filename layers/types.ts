import { Context } from "aws-lambda";

export interface UserContext extends Context {
  user: {
    id: string;
    companies: string[];
    role: string;
  };
}
