#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ApiKeysVisualizationStack } from "../lib/api-keys-visualization-stack";
import { Aspects, IAspect } from "aws-cdk-lib";
import { IConstruct } from "constructs";

const app = new cdk.App();
new ApiKeysVisualizationStack(app, "ApiKeysVisualizationStack", {
  synthesizer: new cdk.DefaultStackSynthesizer({
    qualifier: "apikeys"
  })
});

class RemovalPolicyAll implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof cdk.aws_s3.CfnBucket) {
      console.log("S# bucket");
    }

    if (node instanceof cdk.CfnResource) {
      node.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    }
  }
}

Aspects.of(app).add(new RemovalPolicyAll());
