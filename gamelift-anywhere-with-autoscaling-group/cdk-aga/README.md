# CDK project for Gamelift Anywhere Autoscaling Demo

This is CDK project for deploying Gamelift Anywhere Autoscaling Demo environment.

## Pre-requisite

 * Make sure that you have built game server binary (gomoku-in-go)
 * Copy game server binary to ./gamebinaries/
 * You need a EC2 key pair to create autoscaling group with EC2 instances. Update the key pair name to 'keyPairName' value in cdk.json file.
 * Set CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION environmental variables

 ```
 cp ../gomoku-in-go ./gamebinaries/
 export CDK_DEFAULT_REGION=ap-northeast-2
 export CDK_DEFAULT_ACCOUNT='your account ID here'
 ```


## How to deploy

 * `cdk synth`       emits the synthesized CloudFormation template
 * `cdk deploy`      deploy this stack to your default AWS account/region

## Ref
https://pkg.go.dev/github.com/aws/aws-cdk-go/awscdk/v2/awss3
https://pkg.go.dev/github.com/aws/aws-cdk-go/awscdk/v2@v2.83.0/awsec2
https://pkg.go.dev/github.com/aws/aws-cdk-go/awscdk/v2/awsiam
https://pkg.go.dev/github.com/aws/aws-cdk-go/awscdk/v2@v2.87.0/awss3assets
https://pkg.go.dev/github.com/aws/aws-cdk-go/awscdk/v2/awss3deployment
https://pkg.go.dev/github.com/aws/aws-cdk-go/awscdk/v2/awsautoscaling



