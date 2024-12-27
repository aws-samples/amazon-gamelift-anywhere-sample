/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as gamelift from 'aws-cdk-lib/aws-gamelift';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as fs from 'fs';
import * as path from 'path';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { GameLiftAnywhereStack } from './gamelift-anywhere-stack';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

interface StackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  fleet: gamelift.CfnFleet;
  customLocation: gamelift.CfnLocation;
  repository: ecr.Repository;
}

export class EcsFargateFleetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = props.vpc;
    const repository = props.repository;
    const fleet = props.fleet;
    const customLocation = props.customLocation;

    const cluster = new ecs.Cluster(this, "MyCluster", {
      clusterName: 'ecs-gameserver-cluster',
      containerInsights: false,
      enableFargateCapacityProviders: false,
      vpc: vpc
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "ecs-logs"
    });

    // https://containers-cdk-react-amplify.ws.kabits.com/backend-containers-with-aws-cdk/creating-task/
    //
    const executionRolePolicy =  new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
              "ecr:GetAuthorizationToken",
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetDownloadUrlForLayer",
              "ecr:BatchGetImage",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "ecs:DescribeTasks",
              "ec2:DescribeNetworkInterfaces",
              "ecs:GetTaskProtection",
              "ecs:UpdateTaskProtection",

              "ssmmessages:CreateControlChannel",
              "ssmmessages:CreateDataChannel",
              "ssmmessages:OpenControlChannel",
              "ssmmessages:OpenDataChannel"
            ]
    });

    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDefinition', {
      memoryLimitMiB: 1024,
      cpu: 512,
    });

    fargateTaskDefinition.addToExecutionRolePolicy(executionRolePolicy);
    fargateTaskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: [
        "gamelift:*",
        "ecs:DescribeTasks",
        "ec2:DescribeNetworkInterfaces",
        "ecs:GetTaskProtection",
        "ecs:UpdateTaskProtection",
        "globalaccelerator:AllowCustomRoutingTraffic",
				"globalaccelerator:DenyCustomRoutingTraffic",
      ]
    }));

    const container = fargateTaskDefinition.addContainer("backend", {
      // Use an image from Amazon ECR
      image: ecs.ContainerImage.fromRegistry(repository.repositoryUri),
      logging: ecs.LogDrivers.awsLogs({streamPrefix: 'ecs-logs'}),
      environment: { 
        'CLUSTER': cluster.clusterName,
        'PORT' : '4000',
        'LOCATION' : customLocation.locationName,
        'FLEET_ID' : fleet.attrFleetId,
        //'GAMELIFT_ENDPOINT' : this.node.tryGetContext('GameLiftEndpoint'),
        'ENDPOINT_GROUP_ARN' : this.node.tryGetContext('EndpointGroupArn'),
      },
      // ... other options here ...
    });
    
    container.addPortMappings({
      containerPort: 4000
    }); 
    

    const sg_service = new ec2.SecurityGroup(this, 'gomoku-demo-sg', { vpc: vpc });
    const globalaccelerator_securitygroup_id = this.node.tryGetContext('GlobalAcceleratorSecurityGroupId');

    if(globalaccelerator_securitygroup_id.length === 0) { // Use public subnet 
      sg_service.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(4000));
      
      const service = new ecs.FargateService(this, 'gomoku', {
        cluster,
        taskDefinition: fargateTaskDefinition,
        desiredCount: 5,
        assignPublicIp: true,
        securityGroups: [sg_service],
        enableExecuteCommand: true,
      });
      
      // Setup AutoScaling policy
      const scaling = service.autoScaleTaskCount({ maxCapacity: 10, minCapacity: 1 });
    }
    else { // Use private subnet 
      sg_service.addIngressRule(ec2.Peer.securityGroupId(globalaccelerator_securitygroup_id), ec2.Port.tcp(4000));

      const service = new ecs.FargateService(this, 'gomoku', {
        cluster,
        taskDefinition: fargateTaskDefinition,
        desiredCount: 5,
        assignPublicIp: false,
        securityGroups: [sg_service],
        enableExecuteCommand: true,
        vpcSubnets: { subnets:vpc.privateSubnets },
      });
      
      // Setup AutoScaling policy
      const scaling = service.autoScaleTaskCount({ maxCapacity: 10, minCapacity: 5 });
    }

    // Lambda function that handles the game result and update the player information

    // Create IAM role for Lambda
    const lambdaRole = new iam.Role(this, 'GameLiftScaleProtectionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });


    // Add custom policy for ECS permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecs:ListTasks',
          'ecs:DescribeTasks',
          'ecs:UpdateTaskProtection',
          'ecs:GetTaskProtection', 
        ],
        resources: ['*'],
      })
    );

    // Add custom policy for GameLift permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'gamelift:DescribeGameSessions',
        ],
        resources: ['*'],
      })
    );

    const CheckIdleTask = new lambda.Function(this, 'CheckIdleTask', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas')),
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'check-idle-task.lambda_handler',
      role: lambdaRole,
      environment: {
        ECS_CLUSTER_NAME: cluster.clusterName,
        GAMELIFT_FLEET_ID: fleet.attrFleetId,
        GAMELIFT_LOCATION : customLocation.locationName,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // Create EventBridge rule to trigger Lambda every minute
    new events.Rule(this, 'GameLiftIdleTaskCheckRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(CheckIdleTask)],
    });

      // In your ECS Fargate Fleet Stack
    const taskTerminationHandler = new lambda.Function(this, 'TaskTerminationHandler', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas')),
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'task-termination-handler.lambda_handler',
      environment: {
        GAMELIFT_FLEET_ID: fleet.attrFleetId,
        GAMELIFT_LOCATION: customLocation.locationName
      },
      timeout: cdk.Duration.seconds(30)
    });

    // Add GameLift permissions to Lambda
    taskTerminationHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'gamelift:DeregisterCompute'
      ],
      resources: ['*']
    }));

    // Create EventBridge rule
    new events.Rule(this, 'TaskTerminationRule', {
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          lastStatus: ['STOPPED'],
          clusterArn: [cluster.clusterArn],
        }
      },
      targets: [new targets.LambdaFunction(taskTerminationHandler)]
    });

  }

}
