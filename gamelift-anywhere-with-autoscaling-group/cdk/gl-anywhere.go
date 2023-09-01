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

package main

import (
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsautoscaling"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscloudwatch"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsgamelift"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3assets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3deployment"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type GlAnywereStackProps struct {
	awscdk.StackProps
}

func NewGlAnywereStack(scope constructs.Construct, id string, props *GlAnywereStackProps) awscdk.Stack {
	var sprops awscdk.StackProps
	if props != nil {
		sprops = props.StackProps
	}
	stack := awscdk.NewStack(scope, &id, &sprops)

	// Create GameLift a Location resource for an autoscaling group
	location_name := "custom-anywhere-location"
	custom_location := awsgamelift.NewCfnLocation(stack, jsii.String("Location"), &awsgamelift.CfnLocationProps{
		LocationName: jsii.String(location_name),
	})

	// Create GameLift a Fleet resource
	fleet_name := "anywhere-demo-fleet"
	fleet := awsgamelift.NewCfnFleet(stack, jsii.String("Fleet"), &awsgamelift.CfnFleetProps{
		Name: jsii.String(fleet_name),
		AnywhereConfiguration: &awsgamelift.CfnFleet_AnywhereConfigurationProperty{
			Cost: jsii.String("10"),
		},
		ComputeType: jsii.String("ANYWHERE"),
		Description: jsii.String("Demo Anywhere Fleet"),
		Locations: []interface{}{
			&awsgamelift.CfnFleet_LocationConfigurationProperty{
				Location: jsii.String(location_name),
			},
		},
	})
	fleet.AddDependency(custom_location)

	awscdk.NewCfnOutput(stack, jsii.String("FleetId"), &awscdk.CfnOutputProps{
		Value: jsii.String(*fleet.AttrFleetId()),
	})

	// Create a GameLift Matchmaking RuleSet
	content, err := os.ReadFile("./matchmaking_rule1.yml")
	if err != nil {
		fmt.Println("File read error:", err)
	}

	matchmaking_ruleset_name := "AnywhereDemoMatchmakingRule"
	matchmatking_ruleset := awsgamelift.NewCfnMatchmakingRuleSet(stack, jsii.String("MatchmakingRule"), &awsgamelift.CfnMatchmakingRuleSetProps{
		Name:        jsii.String(matchmaking_ruleset_name),
		RuleSetBody: jsii.String(string(content)),
	})

	// Create a GameLift Alias resource
	alias := awsgamelift.NewCfnAlias(stack, jsii.String("Alias"), &awsgamelift.CfnAliasProps{
		Name: jsii.String("AnywhereDemoAlias"),
		RoutingStrategy: &awsgamelift.CfnAlias_RoutingStrategyProperty{
			Type:    jsii.String("SIMPLE"),
			FleetId: jsii.String(*fleet.AttrFleetId()),
		},

		// the properties below are optional
		Description: jsii.String("description"),
	})
	fmt.Println(alias.ToString())
	// Create a GameLift Queue resource
	alias_arn := "arn:aws:gamelift:ap-northeast-2::alias/" + *alias.AttrAliasId()

	queue := awsgamelift.NewCfnGameSessionQueue(stack, jsii.String("Queue"), &awsgamelift.CfnGameSessionQueueProps{
		Name: jsii.String("AnywhereDemoQueue"),

		// the properties below are optional
		//CustomEventData: jsii.String("customEventData"),
		Destinations: []interface{}{
			&awsgamelift.CfnGameSessionQueue_DestinationProperty{
				DestinationArn: jsii.String(alias_arn),
			},
		},
		PriorityConfiguration: &awsgamelift.CfnGameSessionQueue_PriorityConfigurationProperty{
			LocationOrder: &[]*string{
				jsii.String(location_name),
			},

			PriorityOrder: &[]*string{
				jsii.String("DESTINATION"),
				jsii.String("LOCATION"),
				jsii.String("COST"),
				jsii.String("LATENCY"),
			},
		},
	})

	// Create a GameLift Matchmaking Config resource
	matchmaking_config_name := "AnywareDemoMatchmakingConfig" // GameLift MatchMakingConfigName

	matchmaking_config := awsgamelift.NewCfnMatchmakingConfiguration(stack, jsii.String("MatchmakingConfig"), &awsgamelift.CfnMatchmakingConfigurationProps{
		AcceptanceRequired:    jsii.Bool(false),
		Name:                  jsii.String(matchmaking_config_name),
		RequestTimeoutSeconds: jsii.Number(100),
		RuleSetName:           jsii.String(matchmaking_ruleset_name),
		// the properties below are optional
		BackfillMode:  jsii.String("MANUAL"),
		Description:   jsii.String(matchmaking_config_name),
		FlexMatchMode: jsii.String("WITH_QUEUE"),
		GameSessionQueueArns: &[]*string{
			jsii.String(*queue.AttrArn()),
		},
		//NotificationTarget: jsii.String("notificationTarget"),
	})

	// Add dependencies for the MatchMakingConfig to queue
	matchmaking_config.AddDependency(matchmatking_ruleset)

	// Create a VPC for Gamelift anywhere fleet
	vpc := awsec2.NewVpc(stack, jsii.String("AnywereVpc"), nil)
	awscdk.NewCfnOutput(stack, jsii.String("VpcId"), &awscdk.CfnOutputProps{
		Value: jsii.String(*vpc.VpcId()),
	})

	// Create a Security Group for instances in the anywhere fleet
	sg := awsec2.NewSecurityGroup(stack, jsii.String("SecurityGroup"), &awsec2.SecurityGroupProps{
		Vpc:               vpc,
		SecurityGroupName: jsii.String(*stack.StackName() + "-sg"),
		AllowAllOutbound:  jsii.Bool(true),
		Description:       jsii.String("Security Group for " + *stack.StackName()),
	})
	sg.Connections().AllowFrom(sg, awsec2.Port_AllTraffic(),
		jsii.String("Allow all EC2 instance communicate each other with the this SG."))

	sg.AddIngressRule(
		awsec2.Peer_AnyIpv4(),
		awsec2.NewPort(&awsec2.PortProps{
			Protocol:             awsec2.Protocol_TCP,
			FromPort:             jsii.Number(4000),
			ToPort:               jsii.Number(4010),
			StringRepresentation: jsii.String("Allow Game Server Access"),
		}),
		jsii.String("Allow Game Server Access"),
		jsii.Bool(false),
	)

	// Create a S3 bucket and upload game server binary
	// Add removal policy and auto object deletion for cleanup
	bucket := awss3.NewBucket(stack, jsii.String("gamebinaries"), &awss3.BucketProps{
		RemovalPolicy:     awscdk.RemovalPolicy_DESTROY,
		AutoDeleteObjects: jsii.Bool(true),
	})
	awss3deployment.NewBucketDeployment(stack, jsii.String("DeployBucketBinaries"), &awss3deployment.BucketDeploymentProps{
		// The name of the S3 bucket.
		DestinationBucket: bucket,
		// The path to the file to be uploaded.'
		Sources: &[]awss3deployment.ISource{
			awss3deployment.Source_Asset(jsii.String("./gamebinaries/"), &awss3assets.AssetOptions{}),
		},
	})

	awscdk.NewCfnOutput(stack, jsii.String("BucketURL"), &awscdk.CfnOutputProps{
		Value: jsii.String(*bucket.BucketDomainName()),
	})

	// Create new IAM role for instances in the anywhere fleet
	anywhere_fleet_role := awsiam.NewRole(stack, jsii.String("anywhere_fleet_role"), &awsiam.RoleProps{
		AssumedBy:   awsiam.NewServicePrincipal(jsii.String("ec2.amazonaws.com"), nil),
		Description: jsii.String("Allow EC2 instance to access Amazon GameLift"),
		ManagedPolicies: &[]awsiam.IManagedPolicy{
			awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("AmazonSSMManagedInstanceCore")),
			awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("GlobalAcceleratorFullAccess")),
			awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("AmazonSSMPatchAssociation")),
			awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("AmazonSQSFullAccess")),
		},
	})

	anywhere_fleet_role.AddToPolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Resources: &[]*string{
			jsii.String("*"),
		},
		Actions: &[]*string{
			jsii.String("gamelift:*"),
		},
	}))

	anywhere_fleet_role.AddToPolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Resources: &[]*string{
			jsii.String("*"),
		},
		Actions: &[]*string{
			jsii.String("autoscaling:CompleteLifecycleAction"),
			jsii.String("autoscaling:DescribeAutoScalingInstances"),
			jsii.String("autoscaling:SetInstanceProtection"),
		},
	}))

	anywhere_fleet_role.AddToPolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Resources: &[]*string{
			jsii.String(*bucket.BucketArn() + "/*"),
		},
		Actions: &[]*string{
			jsii.String("s3:GetObject"),
			jsii.String("s3:GetObjectVersion"),
			jsii.String("s3:GetObjectMetadata"),
			jsii.String("s3:*Object*"),
		},
	}))

	// Read user_data.txt file for Launch Template
	content, err = os.ReadFile("user_data.txt")
	if err != nil {
		log.Fatal(err)
	}
	contentString := string(content)
	userdata := awsec2.UserData_Custom(&contentString)
	keypairname := fmt.Sprint(stack.Node().TryGetContext(jsii.String("keyPairName"))) // get KeyPairName from cdk context "keypairname"

	launchTemplate := awsec2.NewLaunchTemplate(stack, jsii.String("LaunchTemplate"), &awsec2.LaunchTemplateProps{
		LaunchTemplateName:   jsii.String(*stack.StackName() + "-lt"),
		SecurityGroup:        sg,
		InstanceType:         awsec2.NewInstanceType(jsii.String("c5.large")),
		MachineImage:         awsec2.MachineImage_LatestAmazonLinux2023(&awsec2.AmazonLinux2023ImageSsmParameterProps{}),
		Role:                 anywhere_fleet_role,
		KeyName:              jsii.String(keypairname),
		UserData:             userdata,
		HttpEndpoint:         jsii.Bool(true),
		InstanceMetadataTags: jsii.Bool(true),
	})

	// Create AutoScalingGroup for instances in the anywhere fleet
	selection := vpc.SelectSubnets(&awsec2.SubnetSelection{
		SubnetType: awsec2.SubnetType_PUBLIC,
	})

	//autoscaling := awsautoscaling.NewCfnAutoScalingGroup(stack, jsii.String("ASG"), &awsautoscaling.CfnAutoScalingGroupProps{
	awsautoscaling.NewCfnAutoScalingGroup(stack, jsii.String("ASG"), &awsautoscaling.CfnAutoScalingGroupProps{
		CapacityRebalance:    jsii.Bool(true),
		DesiredCapacity:      jsii.String("1"),
		MaxSize:              jsii.String("2"),
		MinSize:              jsii.String("1"),
		AutoScalingGroupName: jsii.String(*stack.StackName() + "-asg"),
		VpcZoneIdentifier: &[]*string{
			jsii.String(*(*selection.SubnetIds)[0]),
			jsii.String(*(*selection.SubnetIds)[1]),
		},
		HealthCheckType: jsii.String("EC2"),
		LaunchTemplate: &awsautoscaling.CfnAutoScalingGroup_LaunchTemplateSpecificationProperty{
			Version: launchTemplate.LatestVersionNumber(),
			// the properties below are optional
			LaunchTemplateId:   launchTemplate.LaunchTemplateId(),
			LaunchTemplateName: launchTemplate.LaunchTemplateName(),
		},
		MetricsCollection: []*awsautoscaling.CfnAutoScalingGroup_MetricsCollectionProperty{
			{
				Granularity: jsii.String("1Minute"),
				Metrics: &[]*string{
					jsii.String("GroupMinSize"),
					jsii.String("GroupMaxSize"),
					jsii.String("GroupDesiredCapacity"),
					jsii.String("GroupInServiceCapacity"),
					jsii.String("GroupInServiceCapacity"),
					jsii.String("GroupPendingCapacity"),
					jsii.String("GroupStandbyCapacity"),
					jsii.String("GroupTerminatingCapacity"),
					jsii.String("GroupTotalCapacity"),
					jsii.String("GroupPendingInstances"),
					jsii.String("GroupStandbyInstances"),
					jsii.String("GroupTerminatingInstances"),
					jsii.String("GroupTotalInstances"),
					jsii.String("GroupInServiceInstances"),
					jsii.String("GroupPendingInstances"),
					jsii.String("GroupStandbyInstances"),
					jsii.String("GroupTerminatingInstances"),
					jsii.String("GroupTotalInstances"),
					jsii.String("GroupInServiceInstances"),
					jsii.String("GroupPendingInstances"),
					jsii.String("GroupStandbyInstances"),
					jsii.String("GroupTerminatingInstances"),
					jsii.String("GroupTotalInstances"),
					jsii.String("GroupInServiceInstances"),
					jsii.String("GroupPendingInstances"),
					jsii.String("GroupStandbyInstances"),
					jsii.String("GroupTerminatingInstances"),
					jsii.String("GroupTotalInstances"),
					jsii.String("GroupInServiceInstances"),
					jsii.String("GroupPendingInstances"),
					jsii.String("GroupStandbyInstances"),
				},
			},
		},
		Tags: &[]*awsautoscaling.CfnAutoScalingGroup_TagPropertyProperty{
			{
				Key:               jsii.String("FleetId"),
				Value:             jsii.String(*fleet.AttrFleetId()),
				PropagateAtLaunch: jsii.Bool(true),
			},
			{
				Key:               jsii.String("GameLiftEndpoint"),
				Value:             jsii.String(fmt.Sprint(stack.Node().TryGetContext(jsii.String("GameLiftEndpoint")))),
				PropagateAtLaunch: jsii.Bool(true),
			},
			{
				Key:               jsii.String("ConcurrentExecutions"),
				Value:             jsii.String(fmt.Sprint(stack.Node().TryGetContext(jsii.String("ConcurrentExecutions")))),
				PropagateAtLaunch: jsii.Bool(true),
			},
			{
				Key:               jsii.String("GameServerFromPort"),
				Value:             jsii.String(fmt.Sprint(stack.Node().TryGetContext(jsii.String("GameServerFromPort")))),
				PropagateAtLaunch: jsii.Bool(true),
			},
			{
				Key:               jsii.String("Location"),
				Value:             jsii.String(location_name),
				PropagateAtLaunch: jsii.Bool(true),
			},
			/*
				{
					Key:               jsii.String("EndpointGroupArn"),
					Value:             jsii.String("arn:aws:globalaccelerator::394254462122:accelerator/a0d118ed-8cb4-4953-a9ea-529dad865084/listener/e3fc6956/endpoint-group/c16bb882000e"),
					PropagateAtLaunch: jsii.Bool(true),
				},
			*/
			{
				Key:               jsii.String("BucketName"),
				Value:             jsii.String(*bucket.BucketName()),
				PropagateAtLaunch: jsii.Bool(true),
			},
			{
				Key:               jsii.String("AutoScalingGroupName"),
				Value:             jsii.String(*stack.StackName() + "-asg"),
				PropagateAtLaunch: jsii.Bool(true),
			},
			{
				Key:               jsii.String("Name"),
				Value:             jsii.String("gomoku-go-server"),
				PropagateAtLaunch: jsii.Bool(true),
			},
		},
	})

	awscloudwatch.NewMetric(&awscloudwatch.MetricProps{
		//targetMetric := awscloudwatch.NewMetric(&awscloudwatch.MetricProps{
		Namespace:  jsii.String("AWS/GameLift"),
		MetricName: jsii.String("ActiveGameSessions"),
		//MetricName: jsii.String("PercentAvailableGameSessions"),
		DimensionsMap: &map[string]*string{
			"FleetId":  fleet.AttrFleetId(),
			"Location": &location_name,
		},
		Statistic: jsii.String("Average"),
		Unit:      awscloudwatch.Unit_COUNT,
	})

	/*
		targetTrackingPolicy := awsautoscaling.NewTargetTrackingScalingPolicy(stack, jsii.String("GameLiftAnywhereDemoTargetTrackingScalingPolicy"), &awsautoscaling.TargetTrackingScalingPolicyProps{
			AutoScalingGroup:        awsautoscaling.AutoScalingGroup_FromAutoScalingGroupName(stack, jsii.String("ASGPolicy"), autoscaling.AutoScalingGroupName()),
			EstimatedInstanceWarmup: awscdk.Duration_Minutes(jsii.Number(3)),
			TargetValue:             jsii.Number(0.7),
			CustomMetric:            targetMetric,
		})
		targetTrackingPolicy.Node().AddDependency(autoscaling)
	*/
	return stack
}

func main() {
	defer jsii.Close()

	app := awscdk.NewApp(nil)

	NewGlAnywereStack(app, "GlAnywereStack", &GlAnywereStackProps{
		awscdk.StackProps{
			Env: env(),
		},
	})

	app.Synth(nil)
}

// env determines the AWS environment (account+region) in which our stack is to
// be deployed. For more information see: https://docs.aws.amazon.com/cdk/latest/guide/environments.html
func env() *awscdk.Environment {
	// If unspecified, this stack will be "environment-agnostic".
	// Account/Region-dependent features and context lookups will not work, but a
	// single synthesized template can be deployed anywhere.
	//---------------------------------------------------------------------------
	return nil

	// Uncomment if you know exactly what account and region you want to deploy
	// the stack to. This is the recommendation for production stacks.
	//---------------------------------------------------------------------------
	// return &awscdk.Environment{
	//  Account: jsii.String("123456789012"),
	//  Region:  jsii.String("us-east-1"),
	// }

	// Uncomment to specialize this stack for the AWS Account and Region that are
	// implied by the current CLI configuration. This is recommended for dev
	// stacks.
	//---------------------------------------------------------------------------
	// return &awscdk.Environment{
	// 	Account: jsii.String(os.Getenv("CDK_DEFAULT_ACCOUNT")),
	// 	Region:  jsii.String(os.Getenv("CDK_DEFAULT_REGION")),
	// }
}
