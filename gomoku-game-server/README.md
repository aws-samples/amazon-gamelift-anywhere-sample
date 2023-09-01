# Sample Gomoku gameserver integrated with Amazon GameLift SDK 5.0 
Gomoku-in-go game server for Amazon GameLift SDK 5.0.

## Building gomoku game server
Frist you will need to build a game server.

1. Download GameLift SDK from the link below and unzip it.

```
cd amazon-gamelift-anywhere-sample
wget https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/go/GameLift-Go-ServerSDK-5.0.0.zip
unzip GameLift-SDK-Release-5.0.0.zip
```

2. Go to gomoku-game-server folder, copy GameLift-SDK for Go language, and build an executable. (Install golang if not yet installed)

```
cd gomoku-game-server/
cp -R ../GameLift-SDK-Release-5.0.0/GameLift-Go-ServerSDK-5.0.0 ./
sudo yum install golang -y
go mod tidy
go build .
```

## Running game server
Since the gomoku game server is integrated with GameLift SDK, you will need to create a GameLift Anywhere Fleet to test the game server. This sample provides a full Amazon GameLift environment provising with [AWS CDK](https://github.com/aws-samples/amazon-gamelift-anywhere-sample/tree/main/gamelift-anywhere-with-autoscaling-group/cdk). 

If you want to test the game server integration with Amazon GameLift by yourself, please follow the step below. 

1. Prerequistie 
- GameLift Anywhere Fleet and custom location
- Server to run the game server such as your laptop or Amazon EC2
- Open port (default:4000) for game server acess from the client
- AWS CLI

2. Register your server

```
aws gamelift register-compute --compute-name {compute-name} --fleet-id {fleet-id}  --ip-address {server-ip-address} --location {your-custom-location}
```

3. Get authentication token from Amazon GameLift to communication

```
aws gamelift get-compute-auth-token --fleet-id {fleet-id} --compute-name {instance-id}
```

4. Run game server with the AuthToken returned by Amazon GameLift

```
./gomoku-in-go --auth-token {AuthToken} --port 4000 --endpoint wss://{gamelift-endpoint} --fleet-id {fleet-id} --host-id {instance-id}
```

Refer to [GameLift endpoint](https://docs.aws.amazon.com/general/latest/gr/gamelift.html).