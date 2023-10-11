#!/bin/bash
#
FLEET_NAME=anywhere-demo-fleet
FLEET_ID=`aws gamelift describe-fleet-attributes --query "FleetAttributes[?Name=='$FLEET_NAME'].FleetId" --output text`

POLICY_NAME=GameLiftAnywhereEcsDemoTargetTrackingScalingPolicy

jq '.CustomizedMetricSpecification.Metrics[0].MetricStat.Metric.Dimensions[0].Value="'"$FLEET_ID"'"' config.json.tpl > config.json

RESOURCEARN=`aws ecs list-services --cluster ecs-gameserver-cluster --output text  --query serviceArns`
IFS=":" read -r -a RESOURCE_ID <<< "${RESOURCEARN}"

aws application-autoscaling put-scaling-policy  --policy-name $POLICY_NAME \
  --service-namespace ecs \
  --resource-id ${RESOURCE_ID[5]} \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://config.json

