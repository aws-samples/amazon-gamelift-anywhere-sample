#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GameliftAnywhereStack } from '../lib/gamelift-anywhere-stack';
import { ServerlessBackendStack } from '../lib/serverless-backend-stack';

const app = new cdk.App();
const gameliftAnywhereStack = new GameliftAnywhereStack(app, 'GameliftAnywhereStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
new ServerlessBackendStack(app, 'ServerlessBackendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: gameliftAnywhereStack.vpc
});