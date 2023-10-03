#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { ServerlessBackendStack } from '../lib/serverless-backend-stack';
import { GameliftAnywhereStack } from '../lib/gamelift-anywhere-stack';

const app = new cdk.App();
const vpcStack = new VpcStack(app, 'VpcStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
const gameliftAnywhereStack = new GameliftAnywhereStack(app, 'GameliftAnywhereStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: vpcStack.vpc,
});
const serverlessBackendStack = new ServerlessBackendStack(app, 'ServerlessBackendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: vpcStack.vpc,
  matchmakerNotificationTopic: gameliftAnywhereStack.matchmakerNotificationTopic
});
