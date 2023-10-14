import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from 'aws-cdk-lib/aws-ec2';

interface StackProps extends cdk.StackProps {
    vpc: ec2.Vpc;
}

export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = props.vpc;

    const repository = new ecr.Repository(this, 'Repo', {
        repositoryName: 'gomoku-goa2023',
        removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    
    this.repository = repository;
    
    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
        value: repository.repositoryUri
    });
  };


}
