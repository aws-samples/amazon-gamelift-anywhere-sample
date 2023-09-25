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
https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3-readme.html
https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2-readme.html
https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam-readme.html
https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_assets-readme.html
https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html
https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_autoscaling-readme.html



