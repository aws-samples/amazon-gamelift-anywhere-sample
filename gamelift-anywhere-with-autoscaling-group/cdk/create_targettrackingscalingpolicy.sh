#!/bin/bash
#
FLEET_NAME=anywhere-demo-fleet
FLEET_ID=`aws gamelift describe-fleet-attributes --query "FleetAttributes[?Name=='$FLEET_NAME'].FleetId" --output text`

POLICY_NAME=GlAnywereStack-GameLiftAnywhereDemoTargetTrackingScalingPolicy
AUTOSCALINGGROUP_NAME=GlAnywereStack-asg

jq '.CustomizedMetricSpecification.Metrics[0].MetricStat.Metric.Dimensions[0].Value="'"$FLEET_ID"'"' config.json.tpl > config.json

aws autoscaling put-scaling-policy --policy-name $POLICY_NAME \
  --auto-scaling-group-name $AUTOSCALINGGROUP_NAME --policy-type TargetTrackingScaling \
  --target-tracking-configuration file://config.json

