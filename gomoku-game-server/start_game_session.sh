#!/bin/bash

REGION=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq '.Cluster' | cut -d':' -f4`
TASKID=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.TaskARN' | cut -d'/' -f3`

ENI=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASKID --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)
SUBNET_ID=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASKID --query "tasks[0].attachments[0].details[?name=='subnetId'].value | [0]" --output text)

if [[ -z "${ENDPOINT_GROUP_ARN}" ]]; then
  # Use public IP if global accelerator endpoint group ARN is not set
  IPADDRESS=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].Association.PublicIp' --output text)
else
    # Use private IP if global accelerator endpoint group ARN is set
  IPADDRESS=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].PrivateIpAddress' --output text)
  
  # Allow custom routing traffic for the IP:port on global accelerator endpoint group
  aws globalaccelerator allow-custom-routing-traffic --endpoint-group-arn $ENDPOINT_GROUP_ARN --endpoint-id $SUBNET_ID --destination-addresses $IPADDRESS --destination-ports $PORT --region us-west-2
fi

# Block below line. (private IP address)
#IPADDRESS=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.Containers[0].Networks[0].IPv4Addresses[0]'`

echo "Task IP address is $IPADDRESS"

# Use below environment variables which are passed from task definition
# LOCATION : custom location for the anywhere fleet
# FLEET_ID : anywhere fleet id
# GAMELIFT_ENDPOINT
# PORT : game server port

GAMESERVER_PATH=/gomoku-in-go

result=`aws gamelift register-compute --compute-name $TASKID --fleet-id $FLEET_ID  --ip-address $IPADDRESS --location $LOCATION --region $REGION`

echo "register-compute result: $result"

# Catch SIGTERM for grace termination when task is terminating
function sigterm_handler() {
    aws gamelift deregister-compute --compute-name $TASKID --fleet-id $FLEET_ID --region $REGION
    echo "Task Completed. deregister-compute result: $result"
    
    if [[ -z "${ENDPOINT_GROUP_ARN}" ]]; then
      :
    else
      # Deny custom routing traffic for the IP:port on global accelerator endpoint group back
      aws globalaccelerator deny-custom-routing-traffic --endpoint-group-arn $ENDPOINT_GROUP_ARN --endpoint-id $SUBNET_ID --destination-addresses $IPADDRESS --destination-ports $PORT --region us-west-2
    fi
}
trap sigterm_handler exit

PID=0

$GAMESERVER_PATH --port $PORT --endpoint $GAMELIFT_ENDPOINT --fleet-id $FLEET_ID  --host-id $TASKID & PID="$!"

sleep 1



serverPorts=$PORT
state_file=/tmp/${serverPorts}.state
current_instance_scale_in_protection=0

while true; do
  instance_scale_in_protection=0
  if grep -q ACTIVE "$state_file"; then
    instance_scale_in_protection=1
  fi


  if ps -p ${PID} > /dev/null
  then
    #echo "process(${PID}) is runnnig good"
    :
  else
    echo "process is not running start the process again"
    $GAMESERVER_PATH --port $PORT --endpoint $GAMELIFT_ENDPOINT --fleet-id $FLEET_ID  --host-id $TASKID & PID="$!" 
    echo "PID: ${PID} started" 
 
    #echo "process is not running. call deregister-compute and exit container..."
    #result=`aws gamelift deregister-compute --compute-name $TASKID --fleet-id $FLEET_ID --region $REGION`
    #echo "deregister-compute result: $result"
    #break
  fi

  if [[ $instance_scale_in_protection -ne $current_instance_scale_in_protection ]]; then
    if [[ "$instance_scale_in_protection" -eq 1 ]]
    then
      :
      curl --request PUT --header 'Content-Type: application/json' ${ECS_AGENT_URI}/task-protection/v1/state --data '{"ProtectionEnabled":true}'
    else
      :
      curl --request PUT --header 'Content-Type: application/json' ${ECS_AGENT_URI}/task-protection/v1/state --data '{"ProtectionEnabled":false}'
    fi
    echo "Changed instance protection state: $result"
    current_instance_scale_in_protection=$instance_scale_in_protection
  fi

  sleep 1
done





