#!/bin/bash

REGION=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq '.Cluster' | cut -d':' -f4`
TASKID=`curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.TaskARN' | cut -d'/' -f3`

ENI=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASKID --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)

IPADDRESS=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].Association.PublicIp' --output text)

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





