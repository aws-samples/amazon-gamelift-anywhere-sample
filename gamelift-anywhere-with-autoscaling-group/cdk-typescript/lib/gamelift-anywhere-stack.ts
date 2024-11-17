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

interface StackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  matchmakingNotificationTopic: sns.Topic;
}

export class GameLiftAnywhereStack extends cdk.Stack {
  public readonly fleet: gamelift.CfnFleet;
  public readonly customLocation: gamelift.CfnLocation; 

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = props.vpc;

/* moved to AWS CLI deployment
    // Create location resource for dev machine
    const devLocationName = 'custom-devmachine-location';
    const devCustomLocation = new gamelift.CfnLocation(this, 'DevLocation', {
      locationName: devLocationName,
    });
    
    // Create GameLift a Fleet resource for dev machine
    const devFleetName = 'anywhere-devmachine-fleet';
    const devFleet = new gamelift.CfnFleet(this, 'DevFleet', {
      name: devFleetName,
      anywhereConfiguration: {
        cost: '10'
      },
      computeType: 'ANYWHERE',
      description: 'Dev Anywhere Fleet',
      locations: [{
        location: devLocationName
      }]
    });
    devFleet.addDependency(devCustomLocation);
    
    // Create a GameLift Alias resource for dev machine
    const devAlias = new gamelift.CfnAlias(this, 'DevAlias', {
      name: 'AnywhereDevFleetAlias',
      routingStrategy: {
        type: 'SIMPLE',
        fleetId: devFleet.attrFleetId,
      },
      // the properties below are optional
      description: 'Alias to Dev Anywhere Fleet'
    });
    const devAliasArn = this.formatArn({ service: 'gamelift', resource: 'alias', resourceName: devAlias.attrAliasId });
  */
    
    // Create  Location resource for demo fleet
    const locationName = 'custom-anywhere-location';
    const customLocation = new gamelift.CfnLocation(this, 'DemoLocation', {
      locationName: locationName,
    });

    this.customLocation = customLocation;

    // Create GameLift demo fleet
    const fleetName = 'anywhere-demo-fleet';
    const fleet = new gamelift.CfnFleet(this, 'Fleet', {
      name: fleetName,
      anywhereConfiguration: {
        cost: '10'
      },
      computeType: 'ANYWHERE',
      description: 'Demo Anywhere Fleet',
      locations: [{
        location: locationName
      }],
      runtimeConfiguration: {
        serverProcesses: [
          {
            launchPath: '/local/game/gomoku-in-go',
            concurrentExecutions: 1,
            parameters: '--port 4000' // hardcoded to port 4000 for demo purpose only
          }
        ]
      },
    });
    fleet.addDependency(customLocation);

    this.fleet = fleet;

    new cdk.CfnOutput(this, 'FleetId', {
      value: fleet.attrFleetId
    });


    // Create a GameLift Alias resource for demo fleet
    const alias = new gamelift.CfnAlias(this, 'Alias', {
      name: 'AnywhereDemoAlias',
      routingStrategy: {
        type: 'SIMPLE',
        fleetId: fleet.attrFleetId,
      },
      // the properties below are optional
      description: 'description'
    });

    // Create a GameLift Matchmaking RuleSet
    const rulSetBody = fs.readFileSync(path.join(__dirname, '..', 'matchmaking_rule1.yml'), 'utf-8');

    const matchmakingRulesetName = 'AnywhereDemoMatchmakingRule';
    const matchmakingRuleset = new gamelift.CfnMatchmakingRuleSet(this, 'MatchmakingRule', {
      name: matchmakingRulesetName,
      ruleSetBody: rulSetBody
    });
    
    // Create a GameLift Queue resource
    const aliasArn = this.formatArn({ service: 'gamelift', resource: 'alias', resourceName: alias.attrAliasId });
    
    const queue = new gamelift.CfnGameSessionQueue(this, 'Queue', {
      name: 'AnywhereDemoQueue',
      // the properties below are optional
      // customEventData: 'customEventData',
      destinations: [
      /*
      {
        destinationArn: devAliasArn
      },
      */
      {
        destinationArn: aliasArn
      }
      ],
      priorityConfiguration: {
        locationOrder: [ locationName ],
        priorityOrder: [
          'DESTINATION',
          'LOCATION',
          'COST',
          'LATENCY'
        ]
      },
      timeoutInSeconds: 60
    });

    // Create a GameLift Matchmaking Config resource
    const matchmakingConfigurationName = this.node.tryGetContext('MatchmakingConfigurationName');
    const matchmakingConfig = new gamelift.CfnMatchmakingConfiguration(this, 'MatchmakingConfig', {
      acceptanceRequired: false,
      name: matchmakingConfigurationName,
      requestTimeoutSeconds: 100,
      ruleSetName: matchmakingRulesetName,
      // the properties below are optional
      backfillMode: 'MANUAL',
      description: matchmakingConfigurationName,
      flexMatchMode: 'WITH_QUEUE',
      gameSessionQueueArns: [queue.attrArn],
      notificationTarget: props.matchmakingNotificationTopic.topicArn
    });

    // Add dependencies for the MatchMakingConfig to queue
    matchmakingConfig.addDependency(matchmakingRuleset);

    // Create a Security Group for instances in the anywhere fleet
    const sg = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      securityGroupName: `${this.stackName}-sg`,
      allowAllOutbound: true,
      description: `Security group for ${this.stackName}`
    });
    sg.connections.allowFrom(sg, ec2.Port.allTraffic(), 'Allow all EC2 instances communicate each other with this SG');

    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcpRange(4000, 4010), 'Allow Game Server Access', false);

    // Create a S3 bucket 
	  // Add removal policy and auto object deletion for cleanup
    const bucket = new s3.Bucket(this, 'gamebinaries', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    new cdk.CfnOutput(this, 'BucketURL', {
      value: bucket.bucketDomainName
    });

    const s3AccessRoleForGameLift = new iam.Role(this, 's3_access_role_for_gamelift', {
      assumedBy: new iam.CompositePrincipal(
         new iam.ServicePrincipal('gamelift.amazonaws.com'),
         new iam.ServicePrincipal('cloudformation.amazonaws.com'),
      ),
      description: 'Allow GameLift to access S3 bucket',
    });

    s3AccessRoleForGameLift.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:GetObjectVersion',
        's3:GetObjectMetadata',
        's3:*Object*'
      ],
      resources: [ bucket.arnForObjects("*") ]
    }));

    new cdk.CfnOutput(this, 's3AccessRoleForGameLiftArn', {
      value: s3AccessRoleForGameLift.roleArn
    });

    const gameliftFleetRole = new iam.Role(this, 'gamelift_fleet_role', {
      assumedBy: new iam.ServicePrincipal('gamelift.amazonaws.com'),
      description: 'Allow GameLift to access S3 bucket',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSQSFullAccess'),
      ]
    });

    new cdk.CfnOutput(this, 'gameliftFleetRoleArn', {
      value: gameliftFleetRole.roleArn
    });

  }
}
