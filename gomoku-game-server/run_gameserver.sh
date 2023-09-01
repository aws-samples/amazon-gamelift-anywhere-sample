#!/bin/bash

TOKEN=`curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"`
COMPUTE_NAME=`curl -s http://169.254.169.254/latest/meta-data/instance-id -H "X-aws-ec2-metadata-token: $TOKEN"`
MAC=`curl -s http://169.254.169.254/latest/meta-data/network/interfaces/macs -H "X-aws-ec2-metadata-token: $TOKEN"`
IPADDRESS=`curl -s http://169.254.169.254/latest/meta-data/network/interfaces/macs/$MAC/public-ipv4s -H "X-aws-ec2-metadata-token: $TOKEN"`

LOCATION_NAME=custom-devmachine-location
FLEET_NAME=anywhere-devmachine-fleet

# Create a location if not yet created
echo "Creating custom location..."
LOCATION=`aws gamelift list-locations --query "Locations[?LocationName == '$LOCATION_NAME'].LocationName" --output text`
if [ "$LOCATION" == $LOCATION_NAME ]; then 
  echo "Location already exists. Use existing location"
else
  aws gamelift create-location --location-name $LOCATION_NAME
fi

echo "Creating an anywhere fleet..."
# FLEET_ID=`aws gamelift describe-fleet-attributes --query "FleetAttributes[?Name=='$FLEET_NAME'].FleetId" --output text`
FLEET_ID=`aws gamelift create-fleet --name $FLEET_NAME --compute-type ANYWHERE --locations "Location=$LOCATION_NAME" --query "FleetAttributes.FleetId" --output text`

echo "Creating an alias to the fleet..."
# Create an alias for the fleet
ALIAS_ARN=`aws gamelift create-alias --name AnywhereDevFleetAlias --description "Anywhere Dev Fleet Alias" --routing-strategy "Type=SIMPLE,FleetId=$FLEET_ID" --query "Alias.AliasArn" --output text`

echo "Updating session queue destinations..."
# Get existing session queue destinations (aliases)
DESTINATIONS=`aws gamelift describe-game-session-queues --query "GameSessionQueues[?Name=='AnywhereDemoQueue'].Destinations" --output text`

# Update destination to the queue
aws gamelift update-game-session-queue --name AnywhereDemoQueue --destinations "DestinationArn=$ALIAS_ARN" "DestinationArn=$DESTINATIONS"

# Register Dev machine (cloud9 machine in this example) to the fleet
aws gamelift register-compute --compute-name $COMPUTE_NAME --fleet-id $FLEET_ID  --ip-address $IPADDRESS --location $LOCATION_NAME

GAMESERVER_PATH=./gomoku-in-go
gamelift_endpoint=wss://ap-northeast-2.api.amazongamelift.com

# start game server process
echo "Run below to start game server process"
echo "$GAMESERVER_PATH --port 4000 --endpoint $gamelift_endpoint --fleet-id $FLEET_ID  --host-id $COMPUTE_NAME"

