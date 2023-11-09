#!/bin/bash
#
FLEET_NAME=anywhere-demo-fleet
FLEET_ID=`aws gamelift describe-fleet-attributes --query "FleetAttributes[?Name=='$FLEET_NAME'].FleetId" --output text`

POLICY_NAME=GlAnywereStack-GameLiftAnywhereDemoTargetTrackingScalingPolicy
AUTOSCALINGGROUP_NAME=GlAnywereStack-asg

aws autoscaling delete-policy --policy-name $POLICY_NAME --auto-scaling-group-name $AUTOSCALINGGROUP_NAME