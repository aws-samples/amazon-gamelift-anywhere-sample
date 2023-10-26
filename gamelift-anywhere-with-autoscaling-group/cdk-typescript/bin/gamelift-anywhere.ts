#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { ServerlessBackendStack } from '../lib/serverless-backend-stack';
import { GameLiftAnywhereStack } from '../lib/gamelift-anywhere-stack';
import { EcrStack } from '../lib/ecr-stack';
import { EcsFargateFleetStack } from '../lib/ecs-fargate-fleet';

const app = new cdk.App();
const vpcStack = new VpcStack(app, 'VpcStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
const serverlessBackendStack = new ServerlessBackendStack(app, 'ServerlessBackendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
const gameliftAnywhereStack = new GameLiftAnywhereStack(app, 'GameLiftAnywhereStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: vpcStack.vpc,
  matchmakingNotificationTopic: serverlessBackendStack.matchmakingNotificationTopic
});
const ecrStack = new EcrStack(app, 'EcrStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});
const ecsFargateFleetStack = new EcsFargateFleetStack(app, 'EcsFargateFleetStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: vpcStack.vpc,
  fleet: gameliftAnywhereStack.fleet,
  customLocation: gameliftAnywhereStack.customLocation,
  repository: ecrStack.repository
});
