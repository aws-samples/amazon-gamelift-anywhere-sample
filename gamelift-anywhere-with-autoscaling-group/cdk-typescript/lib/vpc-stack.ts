/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// Specific availability zones to use.
// For example ap-northeast-2 region recommened to use ap-northeast-2a and ap-northeast-2c az for service availability
const availabilityZonesForRegion = new Map<string, string[]>([
  [ 'ap-northeast-2', [ 'ap-northeast-2a', 'ap-northeast-2c' ] ],
  [ 'ap-northeast-1', [ 'ap-northeast-1a', 'ap-northeast-1c' ] ],
  [ 'us-east-1', [ 'us-east-1a', 'us-east-1b' ] ],
  [ 'us-west-2', [ 'us-west-2a', 'us-west-2b' ] ],
  [ 'eu-central-1', [ 'eu-central-1a', 'eu-central-1b' ] ],
]);

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC for Gamelift anywhere fleet
    const vpc = new ec2.Vpc(this, 'VPC', {
      availabilityZones: availabilityZonesForRegion.get(this.region)
    });
    this.vpc = vpc;
  }
}
