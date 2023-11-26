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
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export class ServerlessBackendStack extends cdk.Stack {
  public readonly matchmakingNotificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB for player info
    const table = new dynamodb.Table(this, 'GomokuPlayerInfo', {
      tableName: 'GomokuPlayerInfo',
      partitionKey: { name: 'PlayerName', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ExpireAt',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    const leaderboardGSIName = 'LeaderBoard';
    table.addGlobalSecondaryIndex({
      indexName: leaderboardGSIName,
      partitionKey: { name: 'LeaderboardName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'Score', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: [ 'PlayerName' ]
    });
    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: table.tableName
    });

    // DynamoDB for custom accelerator port mapping
    const portMappingTable = new dynamodb.Table(this, 'CustomPortMapping', {
      tableName: 'CustomPortMapping',
      partitionKey: { name: 'DestinationIpAddress', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
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
        TABLE_NAME: table.tableName
      },
      timeout: cdk.Duration.seconds(3),
    });
    table.grantWriteData(gameSqsProcess);
    gameResultQueue.grantConsumeMessages(gameSqsProcess);

    gameSqsProcess.addEventSourceMapping('GameSqsProcessEventSourceMapping', {
      eventSourceArn: gameResultQueue.queueArn
    });

    const matchmakingNotificationTopic = new sns.Topic(this, 'MatchmakingNotificationTopic');
    this.matchmakingNotificationTopic = matchmakingNotificationTopic;

    // Lambda function that handles the matchmaking event messages and matchmaked result for future reference
    const gameMatchEvent = new lambda.Function(this, 'GameMatchEvent', {
      code: codeAsset,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handle-matchmaking-event.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
        GLOBAL_ACCELERATOR_IP: this.node.tryGetContext('GlobalAcceleratorIp'),
      }
    });
    table.grantWriteData(gameMatchEvent);
    portMappingTable.grantReadData(gameMatchEvent);

    matchmakingNotificationTopic.addSubscription(new sns_subscriptions.LambdaSubscription(gameMatchEvent));

    // API Gateway
    const gomokuApi = new apigateway.RestApi(this, 'GomokuAPI', {
      restApiName: 'GomokuAPI',
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL]
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
      handler: 'read-player-ranking.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
        INDEX_NAME: leaderboardGSIName,
      }
    });
    table.grantReadData(gameRankReader);

    const rankingApi = gomokuApi.root.addResource('ranking');
    rankingApi.addMethod('GET', new apigateway.LambdaIntegration(gameRankReader, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT
    }), {
      methodResponses: [{ statusCode: '200' }]
    });

    const matchmakingConfigurationName = this.node.tryGetContext('MatchmakingConfigurationName');

    // Lambda function for API Gateway that make a matchmaking request to FlexMatch configuration
    // it initialize dynamodb table record for the player and request a matchmaking
    const gameMatchRequest = new lambda.Function(this, 'GameMatchRequest', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas')),
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'post-match-making.lambda_handler',
      environment: {
        TABLE_NAME: table.tableName,
        MATCHMAKING_CONFIGURATION_NAME: matchmakingConfigurationName
      }
    });
    table.grantReadWriteData(gameMatchRequest);
    gameMatchRequest.role?.addManagedPolicy(gameLiftFullAccessPolicy);

    const matchrequestApi = gomokuApi.root.addResource('matchrequest');
    matchrequestApi.addMethod('POST', new apigateway.LambdaIntegration(gameMatchRequest, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT
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
        MATCHMAKING_CONFIGURATION_NAME: matchmakingConfigurationName
      }
    });
    table.grantReadWriteData(gameMatchStatus);

    const matchstatusApi = gomokuApi.root.addResource('matchstatus');
    matchstatusApi.addMethod('POST', new apigateway.LambdaIntegration(gameMatchStatus, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT
    }), {
      methodResponses: [{ statusCode: '200' }]
    });
    
    // Lambda function for reloading custom port mappings to 'CustomPortMapping' dynamodb table
    const reloadCustomPortMapping = new lambda.Function(this, 'reloadCustomPortMapping', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas')),
      runtime: lambda.Runtime.PYTHON_3_11,
      timeout: cdk.Duration.minutes(5),
      handler: 'reload-custom-port-mapping.lambda_handler',
      environment: {
        TABLE_NAME: portMappingTable.tableName
      }
    });
    //portMappingTable.grantReadWriteData(reloadCustomPortMapping);
    portMappingTable.grantFullAccess(reloadCustomPortMapping);
    
    // allow lambda function to globalaccelerator:ListCustomRoutingPortMappings
    const statement = new iam.PolicyStatement();
    statement.addActions("globalaccelerator:ListCustomRoutingPortMappings");
    const arn_string = "arn:aws:globalaccelerator::" + cdk.Stack.of(this).account + ":accelerator/*";
    statement.addResources(arn_string);

    reloadCustomPortMapping.addToRolePolicy(statement); 

    const reloadcustomportmappingApi = gomokuApi.root.addResource('reloadcustomportmapping');
    reloadcustomportmappingApi.addMethod('POST', new apigateway.LambdaIntegration(reloadCustomPortMapping, {
      proxy: false,
      integrationResponses: [{ statusCode: '200', }],
      contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT
    }), {
      methodResponses: [{ statusCode: '200' }]
    });
  }
}
