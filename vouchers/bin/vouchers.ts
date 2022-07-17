#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { VouchersStack } from "../lib/vouchers-stack";

const app = new cdk.App();
new VouchersStack(app, "VouchersStack", {});
