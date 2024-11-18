# Amazon EC2-based IDE

This is an Amazon CloudFormation template which provisions a Amazon EC2-based VSCode server to provide a consistent environment for workshop or tutorial purpose.

The IDE envrionment is consist of Amazon EC2 where VSCode server is installed, AWS Secrets Manager to store a password for authentication and AWS CloudFront to access the web-based IDE.

Web-based IDE is bootstraped via AWS Systems Manager with all necessary languages and tooling such as docker to run this sample. 

## Deploying VSCode 
1. Open AWS CloudShell and run the following commands to download and deploy Amazon CloudFormation stack. 
```
# Downlaod Amazon CloudFormation template file
curl -OL https://raw.githubusercontent.com/aws-sample/amazon-gamelift-anywhere-sample/master/gamelift-ide/cfn/vscode-server.yaml

# Deploy Amazon CloudFormation Stack
aws cloudformation deploy --stack-name gamelift-ide \
    --template-file ./vscode-server.yaml \
    --capabilities CAPABILITY_NAMED_IAM
```
2. After succefsul deployment, retrieve Amazon CloudFront URL and credentials. 
```
aws cloudformation describe-stacks --stack-name gamelift-ide \
    --query 'Stacks[0].Outputs[?OutputKey==`VSCodeServerURL`].OutputValue' --output text
aws cloudformation describe-stacks --stack-name gamelift-ide \
    --query 'Stacks[0].Outputs[?OutputKey==`Password`].OutputValue' --output text
```

3. Open a browser and access the web-based ide using information in step2. 