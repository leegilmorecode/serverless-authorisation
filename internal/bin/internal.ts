#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { InternalStack } from "../lib/internal-stack";

const app = new cdk.App();
new InternalStack(app, "InternalStack", {});
