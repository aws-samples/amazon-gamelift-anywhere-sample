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
import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as sqs  from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

interface StackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class ServerlessBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const matchmakerConfigurationName = this.node.tryGetContext('matchmakerConfigurationName');

    // DynamoDB for player info
    const table = new ddb.Table(this, 'GomokuPlayerInfo', {
      tableName: 'GomokuPlayerInfo',
      partitionKey: { name: 'PlayerName', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // ElastiCache for Redis cluster for ranking info
    const rankingRedisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'GomokuRedisSubnetGroup', {
      description: 'Gomoku Redis Subnet Group',
      subnetIds: props.vpc.privateSubnets.map(s => s.subnetId),
    });

    const defaultSG = new ec2.SecurityGroup(this, 'GomokuDefault', {
      securityGroupName: 'GomokuDefault',
      description: 'Security group for Gomoku Demo Resources',
      vpc: props.vpc
    });
    defaultSG.addIngressRule(defaultSG, ec2.Port.tcpRange(0, 65535));

    const rankingRedis = new elasticache.CfnCacheCluster(this, 'GomokuRanking', {
      clusterName: 'GomokuRanking',
      port: 6379,
      cacheNodeType: 'cache.t2.medium',
      engine: 'redis',
      engineVersion: '6.2',
      numCacheNodes: 1,
      cacheSubnetGroupName: rankingRedisSubnetGroup.ref,
      vpcSecurityGroupIds: [ defaultSG.securityGroupId ],
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: rankingRedis.attrRedisEndpointAddress
    });

    // GameLift Full Access Policy for various lambda functions
    const gameLiftFullAccessPolicy = new iam.ManagedPolicy(this, 'GomokuGameLiftManagedPolicy', {
      managedPolicyName: 'GameLiftFullAccess',
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['gamelift:*'],
            resources: ['*']
          })
        ]
      })
    });

    const codeAsset = lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas'));

    // SQS queue that receive game result info
    // The game server will send message to this SQS queue and lambda function will handle the result
    const gameResultQueue = new sqs.Queue(this, 'GameResultQueue', {
      queueName: 'game-result-queue',
      visibilityTimeout: cdk.Duration.seconds(10)
    });

    new cdk.CfnOutput(this, 'SQSQueueUrl', {
      value: gameResultQueue.queueUrl
    });

    // Lambda function that handles the game result and update the player information
    const gameSqsProcess = new lambda.Function(this, 'GameSqsProcess', {
      code: codeAsset,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'process-game-result.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
      },
      timeout: cdk.Duration.seconds(3),
    });
    table.grantWriteData(gameSqsProcess);
    gameResultQueue.grantConsumeMessages(gameSqsProcess);

    gameSqsProcess.addEventSourceMapping('GameSqsProcessEventSourceMapping', {
      eventSourceArn: gameResultQueue.queueArn
    });

    // SNS topic that receive matchmaking event from FlexMatch configuration
    const gomokuMatchmakingTopic = new sns.Topic(this, 'GomokuMatchTopic');

    new cdk.CfnOutput(this, 'GameLiftEventTopicArn', {
      value: gomokuMatchmakingTopic.topicArn
    });

    // Lambda function that handles the matchmaking event messages and matchmaked result for future reference
    const gameMatchEvent = new lambda.Function(this, 'GameMatchEvent', {
      code: codeAsset,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handle-matchmaking-event.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
      }
    });
    table.grantWriteData(gameMatchEvent);

    gomokuMatchmakingTopic.addSubscription(new sns_subscriptions.LambdaSubscription(gameMatchEvent));

    // Lambda layer that support python redis module
    const redisLayer = new lambda.LayerVersion(this, 'GameRankRedisLayer', {
      compatibleRuntimes: [
        lambda.Runtime.PYTHON_3_7,
        lambda.Runtime.PYTHON_3_8,
        lambda.Runtime.PYTHON_3_9,
        lambda.Runtime.PYTHON_3_10,
        lambda.Runtime.PYTHON_3_11
      ],
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda_layers', 'redis')),
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Lambda function that read DynamoDB stream that publish updated player record and update player ranking record in redis 
    const gameRankUpdate = new lambda.Function(this, 'GameRankUpdate', {
      code: codeAsset,
      runtime: lambda.Runtime.PYTHON_3_11,
      layers: [ redisLayer ],
      handler: 'update-player-ranking.lambda_handler',
      environment: {
        REDIS: rankingRedis.attrRedisEndpointAddress
      },
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [ defaultSG ]
    });
    table.grantStreamRead(gameRankUpdate);

    gameRankUpdate.addEventSourceMapping('GameRankUpdateEventSourceMapping', {
      eventSourceArn: table.tableStreamArn,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      retryAttempts: 5
    });

    // API Gateway
    const gomokuApi = new apigateway.RestApi(this, 'GomokuAPI', {
      restApiName: 'GomokuAPI',
      endpointConfiguration: {
        types: [ apigateway.EndpointType.REGIONAL ]
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS // this is also the default
      },
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: cdk.RemovalPolicy.DESTROY,
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.INFO
      }
    });

    new cdk.CfnOutput(this, 'ApiGatewayEndpoint', {
      value: gomokuApi.url
    });

    // Lambda function for API Gateway that read player ranking from redis
    const gameRankReader = new lambda.Function(this, 'GameRankReader', {
      code: codeAsset,
      runtime: lambda.Runtime.PYTHON_3_11,
      layers: [ redisLayer ],
      handler: 'read-player-ranking.lambda_handler',
      environment: {
        REDIS: rankingRedis.attrRedisEndpointAddress
      },
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [ defaultSG ]
    });

    const rankingApi = gomokuApi.root.addResource('ranking');
    rankingApi.addMethod('GET', new apigateway.LambdaIntegration(gameRankReader, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling:  apigateway.ContentHandling.CONVERT_TO_TEXT
    }), {
      methodResponses: [{ statusCode: '200' }]
    });

    // Lambda function for API Gateway that make a matchmaking request to FlexMatch configuration
    // it initialize dynamodb table record for the player and request a matchmaking
    const gameMatchRequest = new lambda.Function(this, 'GameMatchRequest', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas')),
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'post-match-making.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
        MATCHMAKING_CONFIGURATION_NAME: matchmakerConfigurationName
      }
    });
    table.grantReadWriteData(gameMatchRequest);
    gameMatchRequest.role?.addManagedPolicy(gameLiftFullAccessPolicy);

    const matchrequestApi = gomokuApi.root.addResource('matchrequest');
    matchrequestApi.addMethod('POST', new apigateway.LambdaIntegration(gameMatchRequest, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling:  apigateway.ContentHandling.CONVERT_TO_TEXT
    }), {
      methodResponses: [{ statusCode: '200' }]
    });

    // Lambda function for API Gateway that read matchmaking status that is updated in dynamodb table
    const gameMatchStatus = new lambda.Function(this, 'GameMatchStatus', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas')),
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'check-matchmaking-status.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
        MATCHMAKING_CONFIGURATION_NAME: matchmakerConfigurationName
      }
    });
    table.grantReadWriteData(gameMatchStatus);

    const matchstatusApi = gomokuApi.root.addResource('matchstatus');
    matchstatusApi.addMethod('POST', new apigateway.LambdaIntegration(gameMatchStatus, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling:  apigateway.ContentHandling.CONVERT_TO_TEXT
    }), {
      methodResponses: [{ statusCode: '200' }]
    });
  }
}
