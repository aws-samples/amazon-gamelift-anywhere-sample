# Amazon GameLift Anywhere Demo - Gomoku-in-go

Amazon GameLift Anywhere extends your game server compute choices for GameLift fleet from GameLift managed instances while still leveraing key GameLift features like matchmaking and game session placement queue. You can create a GameLift Anywhere fleet and add your on-premises servers to leverage your exsiting on-premises investment, EC2 instances or ECS tasks in your AWS account to have more control over the management, or your development machines to the fleet for easier game server development and debugging.

This repo contains source codes for a sample game server application, gomoku-in-go, which is re-written in golang from the original Visual C++ [GomokuServer](https://github.com/aws-samples/aws-gamelift-sample/tree/master/GomokuServer) for GameLift SDK 5.0 demo purpose and removing dependencies on Visual Studio and Windows server. 

Also this repo contains AWS CDK codes, also written in golang, which deploys AWS resources required for running GameLift Anywhere fleet and demonstration scenarios.


## Building gomoku game server
Frist you will need to build a game server.

1. Clone this repo

```
git clone https://github.com/aws-samples/amazon-gamelift-anywhere-sample.git
```

2. Download GameLift SDK from the link below and unzip it.

```
cd amazon-gamelift-anywhere-sample
wget https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/go/GameLift-Go-ServerSDK-5.0.0.zip
unzip GameLift-SDK-Release-5.0.0.zip
```

3. Go to gomoku-game-server folder, copy GameLift-SDK for Go language, and build an executable. (Install golang if not yet installed)

```
cd gomoku-game-server/
cp -R ../GameLift-SDK-Release-5.0.0/GameLift-Go-ServerSDK-5.0.0 ./
sudo yum install golang -y
go mod tidy
go build .

```
## Deploy AWS resources
Frist you will need to build a game server.

1. Update the `context` section in gamelift-anywhere-with-autoscaling-group/cdk/cdk.json accordingly. 

```
{
  ...
  "context": {
    ... 
    "GameLiftEndpoint": "wss://ap-northeast-2.api.amazongamelift.com", 
    "deploymentRegion": "ap-northeast-2",
    "keyPairName": "enterYourKey"
  }
}

```
   `GameLiftEndpoint` : GameLift endpoint where you want to deploy GameLift Anywhere fleet. [GameLift endpoints](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)
   `deploymentRegion` : Target region where you want to deploy GameLift Anywhere fleet.
   `keyPairName` : Your ssh key pair name

2. Copy game server binary and deploy AWS resources for Amazon GameLift Anywhere sample with following CDK command.

```
# Move to cdk directory
cd ../gamelift-anywhere-with-autoscaling-group/cdk/

# Copy game server binary to ./gamebinaries/ folder
cp ../../gomoku-game-server/gomoku-in-go gamebinaries/

# Generate and check CloudFormation template 
cdk synth

# Deploy AWS resrouces
cdk deploy

```
You will need to manually approve the cdk deployment after `cdk deploy` command

## Demo scenarios

1. Pre-requisites
 - Complete `Deploy AWS resources` step.


2. Then register your server using aws gamelift register-compute command

```
 aws gamelift register-compute --compute-name i-045ecf04dc879df0f --fleet-id {fleet-id}  --ip-address {server-ip-address} --location custom-location1

```

4. Then get authentication token for communication with gamelift endpoint

```
$ aws gamelift get-compute-auth-token --fleet-id {fleet-id} --compute-name {instance-id}
```

5. Run using the AuthToken returned

```
./gomoku-in-go --auth-token d79ac2c1-0f1f-4472-98a8-bdc17fafdef9 --port 4000 --endpoint wss://ap-northeast-2.api.amazongamelift.com --fleet-id {fleet-id} --host-id {instance-id}
```

6. Open another terminal and run python test client script. 

```
% ./testclient/demo-matchmaking-test.py
[player 0 ] start_matchmaking sent to Client Backend Service.
[player 1 ] start_matchmaking sent to Client Backend Service.
[player 0 ][score: 1000 ] matchmaking status:  PLACING
[player 1 ][score: 1000 ] matchmaking status:  PLACING
[player 0 ][score: 1000 ] matchmaking status:  PLACING
[player 1 ][score: 1000 ] matchmaking status:  PLACING
[player 0 ][score: 1000 ] matchmaking status:  PLACING
[player 1 ][score: 1000 ] matchmaking status:  PLACING
[player 0 ][score: 1000 ] matchmaking status:  PLACING
[player 1 ][score: 1000 ] matchmaking status:  PLACING
[player 0 ][score: 1000 ] matchmaking status:  PLACING
[player 1 ][score: 1000 ] matchmaking status:  PLACING
[player 0 ][score: 1000 ] matchmaking status:  PLACING
[player 1 ][score: 1000 ] matchmaking status:  PLACING
[player 0 ][score: 1000 ] match created:  1.1.1.1 : 4000
[player 0 ][score: 1000 ] match created:  1.1.1.1 : 4000
[player 1 ][score: 1000 ] match created:  1.1.1.1 : 4000
[player 1 ][score: 1000 ] match created:  1.1.1.1 : 4000
[player 0 ] connected to game server
[player 0 ] StartRequest sent to game server
[player 1 ] connected to game server
[player 1 ] StartRequest sent to game server
Please enter any key to terminate game sessions:

```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

