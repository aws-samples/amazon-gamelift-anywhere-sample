#!/bin/bash

REGION=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq '.Cluster' | cut -d':' -f4`
TASKID=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.TaskARN' | cut -d'/' -f3`
CLUSTER=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.TaskARN' | cut -d'/' -f2`

# Populate environment variable if not ECS task environment
if [[ -z "$REGION" ]]; then
  echo "ECS Container metadata not available. Use EC2 metadata instead."

  # Get EC2 metadata service token
  TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

  REGION=$(curl -s "http://169.254.169.254/latest/dynamic/instance-identity/document" -H "X-aws-ec2-metadata-token: $TOKEN" | jq -r .region)
  # Use instance-id for TASKID
  TASKID=$(curl -s "http://169.254.169.254/latest/meta-data/instance-id" -H "X-aws-ec2-metadata-token: $TOKEN")

  ENI=$(aws ec2 describe-network-interfaces --filters "Name=attachment.instance-id,Values=$TASKID" --query 'NetworkInterfaces[*].NetworkInterfaceId | [0]' --output text)
  SUBNET_ID=$(aws ec2 describe-instances --instance-ids $TASKID --query 'Reservations[0].Instances[0].SubnetId' --output text)

else
  ENI=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASKID --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)
  SUBNET_ID=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASKID --query "tasks[0].attachments[0].details[?name=='subnetId'].value | [0]" --output text)
fi

if [[ -z "${ENDPOINT_GROUP_ARN}" ]]; then
  # Use public IP if global accelerator endpoint group ARN is not set
  IPADDRESS=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].Association.PublicIp' --output text)
else
  # Use private IP if global accelerator endpoint group ARN is set
  IPADDRESS=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].PrivateIpAddress' --output text)

  # Allow custom routing traffic for the IP:port on global accelerator endpoint group
  aws globalaccelerator allow-custom-routing-traffic --endpoint-group-arn $ENDPOINT_GROUP_ARN --endpoint-id $SUBNET_ID --destination-addresses $IPADDRESS --destination-ports $PORT --region us-west-2
fi

echo "Task IP address is $IPADDRESS"

# Use below environment variables which are passed from task definition
# LOCATION : custom location for the anywhere fleet
# FLEET_ID : anywhere fleet id
# PORT : game server port

# Use aws gamelift update-runtime-configuration to configure gameserver execution path, concurrent executions, port
nohup java -jar agent/GameLiftAgent-1.0.jar -fleet-id $FLEET_ID -compute-name $TASKID-$DATE -region $REGION -location $LOCATION -ip $IPADDRESS &

tail -f /dev/null