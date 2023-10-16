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
    
    // Create  Location resource for demo fleet
    const locationName = 'custom-anywhere-location';
    const customLocation = new gamelift.CfnLocation(this, 'Location', {
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
      }]
    });
    fleet.addDependency(customLocation);

    this.fleet = fleet;

    new cdk.CfnOutput(this, 'FleetId', {
      value: fleet.attrFleetId
    });

    // Create a GameLift Matchmaking RuleSet
    const rulSetBody = fs.readFileSync(path.join(__dirname, '..', 'matchmaking_rule1.yml'), 'utf-8');

    const matchmakingRulesetName = 'AnywhereDemoMatchmakingRule';
    const matchmakingRuleset = new gamelift.CfnMatchmakingRuleSet(this, 'MatchmakingRule', {
      name: matchmakingRulesetName,
      ruleSetBody: rulSetBody
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

    // Create a GameLift Queue resource
    const aliasArn = this.formatArn({ service: 'gamelift', resource: 'alias', resourceName: alias.attrAliasId });
    
    const queue = new gamelift.CfnGameSessionQueue(this, 'Queue', {
      name: 'AnywhereDemoQueue',
      // the properties below are optional
      // customEventData: 'customEventData',
      destinations: [{
        destinationArn: devAliasArn
      },
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
      }
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


    
    
    /*
    // upload game server binary
    new s3deploy.BucketDeployment(this, 'DeployBucketBinaries', {
      // The name of the S3 bucket.
      destinationBucket: bucket,
      // The path to the file to be uploaded.'
      sources: [ s3deploy.Source.asset(path.join(__dirname, '..', 'gamebinaries')) ],
      // Need to increase memoryLimit from 128 for 100MB+ deployment size
      memoryLimit: 256,
    });
    */




/* ECS deployment
 *
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
      memoryLimitMiB: 512,
      cpu: 256,
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
      ]
    }));

    const container = fargateTaskDefinition.addContainer("backend", {
      // Use an image from Amazon ECR
      image: ecs.ContainerImage.fromRegistry('018700324583.dkr.ecr.ap-northeast-2.amazonaws.com/gomoku'),
      logging: ecs.LogDrivers.awsLogs({streamPrefix: 'ecs-logs'}),
      environment: { 
        'CLUSTER': cluster.clusterName,
        'PORT' : '4000',
        'LOCATION' : 'custom-anywhere-location',
        'FLEET_ID' : fleet.attrFleetId,
        'GAMELIFT_ENDPOINT' : this.node.tryGetContext('GameLiftEndpoint')
      }
      // ... other options here ...
    });
    
    container.addPortMappings({
      containerPort: 4000
    }); 

    const sg_service = new ec2.SecurityGroup(this, 'gomoku-demo-sg', { vpc: vpc });

    sg_service.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(4000));

    const service = new ecs.FargateService(this, 'gomoku', {
      cluster,
      taskDefinition: fargateTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [sg_service],
      enableExecuteCommand: true
    });

ECS deployment */



  
    // Setup AutoScaling policy
    //const scaling = service.autoScaleTaskCount({ maxCapacity: 10, minCapacity: 5 });
    /*
    scaling.scaleToTrackCustomMetric()
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 50,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60)
    });
    */
    /*
    const taskrole = new iam.Role(this, `ecs-taskrole-${this.stackName}`, {
      roleName: `ecs-taskrole-${this.stackName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    */


/*
    const ecrRepo = new ecr.Repository(this, 'ecrRepo', {
      repositoryName: 'gomoku'
    });
*/

/*
    const taskDef = new ecs.FargateTaskDefinition(this, "taskDefinition", {
      family: 'gomoku',
      taskRole: taskrole
    });

    const baseImage = 'public.ecr.aws/amazonlinux/amazonlinux:2022'
    const container = taskDef.addContainer('flask-app', {
      image: ecs.ContainerImage.fromRegistry(baseImage),
      memoryLimitMiB: 512,
      cpu: 256,
      logging
    });



    cluster.addCapacity('hello-web', {
      instanceType: new ec2.InstanceType("t2.small"),
      desiredCapacity: 1, // 초기 instance 생성 개수
      maxCapacity: 2,
      minCapacity: 1,
      // vpcSubnets : default > all private subnets.
    });
*/
/*
    // Create new IAM role for instances in the anywhere fleet
    const anywhereFleetRole = new iam.Role(this, 'anywhere_fleet_role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Allow EC2 instances to access Amazon GameLift',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('GlobalAcceleratorFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMPatchAssociation'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSQSFullAccess'),
      ]
    });

    anywhereFleetRole.addToPolicy(new iam.PolicyStatement({
      actions: [ 'gamelift:*' ],
      resources: [ '*' ]
    }));

    anywhereFleetRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'autoscaling:CompleteLifecycleAction',
        'autoscaling:DescribeAutoScalingInstances',
        'autoscaling:SetInstanceProtection'
      ],
      resources: [ '*' ]
    }));

    const userDataString = fs.readFileSync(path.join(__dirname, '..', 'user_data.txt'), 'utf-8');
    const userData = ec2.UserData.custom(userDataString);
    const keyPairName = this.node.tryGetContext('keyPairName'); // get KeyPairName from cdk context "keypairname"

    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateName: `${this.stackName}-lt`,
      securityGroup: sg,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role: anywhereFleetRole,
      keyName: keyPairName,
      userData,
      httpEndpoint: true,
      instanceMetadataTags: true
    });






    // Create AutoScalingGroup for instances in the anywhere fleet
    const selection = vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC });

    new autoscaling.CfnAutoScalingGroup(this, 'ASG', {
      capacityRebalance: true,
      desiredCapacity: '1',
      maxSize: '2',
      minSize: '1',
      autoScalingGroupName: `${this.stackName}-asg`,
      vpcZoneIdentifier: vpc.publicSubnets.map(subnet => subnet.subnetId),
      healthCheckType: 'EC2',
      launchTemplate: {
        version: launchTemplate.latestVersionNumber,
        // the properties below are optional
        launchTemplateId: launchTemplate.launchTemplateId,
        launchTemplateName: launchTemplate.launchTemplateName,
      },
      metricsCollection: [{
        granularity: '1Minute',
        metrics: [
          'GroupMinSize',
					'GroupMaxSize',
					'GroupDesiredCapacity',
					'GroupInServiceCapacity',
					'GroupInServiceCapacity',
					'GroupPendingCapacity',
					'GroupStandbyCapacity',
					'GroupTerminatingCapacity',
					'GroupTotalCapacity',
					'GroupPendingInstances',
					'GroupStandbyInstances',
					'GroupTerminatingInstances',
					'GroupTotalInstances',
					'GroupInServiceInstances',
					'GroupPendingInstances',
					'GroupStandbyInstances',
					'GroupTerminatingInstances',
					'GroupTotalInstances',
					'GroupInServiceInstances',
					'GroupPendingInstances',
					'GroupStandbyInstances',
					'GroupTerminatingInstances',
					'GroupTotalInstances',
					'GroupInServiceInstances',
					'GroupPendingInstances',
					'GroupStandbyInstances',
					'GroupTerminatingInstances',
					'GroupTotalInstances',
					'GroupInServiceInstances',
					'GroupPendingInstances',
					'GroupStandbyInstances',
        ]
      }],
      tags: [{
        key:               'FleetId',
        value:             fleet.attrFleetId,
        propagateAtLaunch: true,
      }, {
        key:               'GameLiftEndpoint',
        value:             this.node.tryGetContext('GameLiftEndpoint'),
        propagateAtLaunch: true,
      }, {
        key:               'ConcurrentExecutions',
        value:             this.node.tryGetContext('ConcurrentExecutions'),
        propagateAtLaunch: true,
      }, {
        key:               'GameServerFromPort',
        value:             this.node.tryGetContext('GameServerFromPort'),
        propagateAtLaunch: true,
      }, {
        key:               'Location',
        value:             locationName,
        propagateAtLaunch: true,
      }, {
      //   key:               'EndpointGroupArn',
      //   value:             'arn:aws:globalaccelerator::394254462122:accelerator/a0d118ed-8cb4-4953-a9ea-529dad865084/listener/e3fc6956/endpoint-group/c16bb882000e',
      //   propagateAtLaunch: true,
      // }, {
        key:               'BucketName',
        value:             bucket.bucketName,
        propagateAtLaunch: true,
      }, {
        key:               'AutoScalingGroupName',
        value:             `${this.stackName}-asg`,
        propagateAtLaunch: true,
      }, {
        key:               'Name',
        value:             'gomoku-go-server',
        propagateAtLaunch: true,
      }]
    });

    new cloudwatch.Metric({
      namespace: 'AWS/GameLift',
      metricName: 'ActiveGameSessions',
      //metricName: 'PercentAvailableGameSessions',
      dimensionsMap: {
        FleetId: fleet.attrFleetId,
        Location: locationName
      },
      statistic: 'Average',
      unit: cloudwatch.Unit.COUNT,
    });

    // const targetTrackingPolicy = new autoscaling.TargetTrackingScalingPolicy(this, 'GameLiftAnywhereDemoTargetTrackingScalingPolicy', {
    //   autoScalingGroup: autoscaling.AutoScalingGroup.fromAutoScalingGroupName(this, 'ASGPolicy', autoscaling.AutoScalingGroupName),
    //   estimatedInstanceWarmup: cdk.Duration.minutes(3),
    //   targetValue: 0.7,
    //   customMetric: targetMetrics
    // });
*/
  }
}
