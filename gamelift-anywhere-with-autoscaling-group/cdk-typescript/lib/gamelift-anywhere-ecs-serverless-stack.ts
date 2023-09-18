import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as gamelift from 'aws-cdk-lib/aws-gamelift';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as fs from 'fs';
import * as path from 'path';

export class GameliftAnywhereEcsServerlessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const locationName = 'custom-anywhere-location';
    const customLocation = new gamelift.CfnLocation(this, 'Location', {
      locationName: locationName,
    });

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

    new cdk.CfnOutput(this, 'FleetId', {
      value: fleet.attrFleetId
    });

    const matchmakingRulesetName = 'AnywhereDemoMatchmakingRule';
    const matchmakingRuleset = new gamelift.CfnMatchmakingRuleSet(this, 'MatchmakingRuleset', {
      name: matchmakingRulesetName,
      ruleSetBody: fs.readFileSync(path.join(__dirname, '..', 'matchmaking_rule1.yml'), 'utf-8')
    });

    // Create a GameLift Alias resource
    const alias = new gamelift.CfnAlias(this, 'Alias', {
      name: 'anywhere-demo-alias',
      routingStrategy: {
        type: 'SIMPLE',
        fleetId: fleet.attrFleetId,
      }
    });

    const aliasArn = `arn:aws:gamelift:${this.region}:${this.account}:alias/${alias.attrAliasId}`;
    
    const queue = new gamelift.CfnGameSessionQueue(this, 'Queue', {
      name: 'anywhere-demo-queue',
      destinations: [{
        destinationArn: aliasArn
      }],
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

    const matchmakingConfigName = 'AnywhereDemoMatchmakingConfig';
    const matchmakingConfig = new gamelift.CfnMatchmakingConfiguration(this, 'MatchmakingConfig', {
      acceptanceRequired: false,
      name: matchmakingConfigName,
      requestTimeoutSeconds: 100,
      ruleSetName: matchmakingRulesetName,
      backfillMode: 'MANUAL',
      description: matchmakingConfigName,
      flexMatchMode: 'WITH_QUEUE',
      gameSessionQueueArns: [queue.attrArn],
      // notificationTarget: // TODO: Add notification target
    });

    matchmakingConfig.addDependency(matchmakingRuleset);

    const vpc = new ec2.Vpc(this, 'AnywhereVPC');
    new cdk.CfnOutput(this, 'VPCId', {
      value: vpc.vpcId
    });

    const sg = new ec2.SecurityGroup(this, 'AnywhereSG', {
      vpc,
      securityGroupName: `${this.stackName}-sg`,
      allowAllOutbound: true,
      description: `Security group for {this.stackName}`
    });
    sg.connections.allowFrom(sg, ec2.Port.allTraffic(), 'Allow all EC2 instances communicate each other with this SG');

    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcpRange(4000, 4010), 'Allow Game Server Access', false);

    // Create a S3 bucket and upload game server binary
	  // Add removal policy and auto object deletion for cleanup
    const bucket = new s3.Bucket(this, 'GameBinaries', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    new s3deploy.BucketDeployment(this, 'DeployBucketBinaries', {
      destinationBucket: bucket,
      sources: [ s3deploy.Source.asset('./gamebinaries/') ]
    });

    new cdk.CfnOutput(this, 'BucketURL', {
      value: bucket.bucketDomainName
    });

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

    const userData = ec2.UserData.custom(fs.readFileSync(path.join(__dirname, '..', 'user_data.txt'), 'utf-8'));
    const keyPairName = this.node.tryGetContext('keyPairName');

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

    const subnetSelection = vpc.selectSubnets
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
        launchTemplateId: launchTemplate.launchTemplateId
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
        key:               'Location',
        value:             locationName,
        propagateAtLaunch: true,
      }, {
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
  }
}
