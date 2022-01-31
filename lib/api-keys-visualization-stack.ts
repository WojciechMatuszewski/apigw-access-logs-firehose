import * as aws_lambda_go from "@aws-cdk/aws-lambda-go-alpha";
import {
  Aws,
  aws_apigateway,
  aws_glue,
  aws_iam,
  aws_kinesisfirehose,
  aws_lambda,
  aws_logs,
  aws_s3,
  Lazy,
  RemovalPolicy,
  Stack,
  StackProps
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { join } from "path";

export class ApiKeysVisualizationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const APILogsBucket = new aws_s3.Bucket(this, "APILogsBucket", {
      objectOwnership: aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      // The `autoDeleteObjects` check happens before the Aspect has a chance to run.
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const APILogsProcessor = new aws_lambda_go.GoFunction(
      this,
      "APILogsProcessor",
      {
        entry: join(__dirname, "../src"),
        runtime: aws_lambda.Runtime.PROVIDED_AL2
      }
    );

    /**
     * Using `api.addApiKey` would cause a circular reference in CloudFormation.
     * Thankfully, the `ApiKey` resource is a standalone resource.
     */
    const firstAPIKey = new aws_apigateway.ApiKey(this, "FirstAPIKey", {});
    const secondAPIKey = new aws_apigateway.ApiKey(this, "SecondAPIKey", {});

    APILogsProcessor.addToRolePolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: ["apigateway:GET"],
        // resources: [`arn:${Aws.PARTITION}:apigateway:${Aws.REGION}::/apikeys/*`]
        resources: [firstAPIKey.keyArn, secondAPIKey.keyArn]
      })
    );

    const firehoseAPIDeliveryStreamLogGroup = new aws_logs.LogGroup(
      this,
      "KinesisAPIDeliveryStreamLogGroup",
      {}
    );

    const firehoseAPIDeliveryStreamLogStream = new aws_logs.LogStream(
      this,
      "KinesisAPIDeliveryStreamLogStream",
      {
        logGroup: firehoseAPIDeliveryStreamLogGroup,
        logStreamName: "firehose-api-delivery-stream"
      }
    );

    const firehoseAPIDeliveryStreamRole = new aws_iam.Role(
      this,
      "KinesisAPIDeliveryStreamRole",
      {
        assumedBy: new aws_iam.ServicePrincipal("firehose.amazonaws.com")
      }
    );

    firehoseAPIDeliveryStreamLogGroup.grantWrite(firehoseAPIDeliveryStreamRole);
    APILogsBucket.grantReadWrite(firehoseAPIDeliveryStreamRole);
    APILogsProcessor.grantInvoke(firehoseAPIDeliveryStreamRole);

    const firehoseAPILogsDeliveryStream =
      new aws_kinesisfirehose.CfnDeliveryStream(
        this,
        "KinesisAPILogsDeliveryStream",
        {
          deliveryStreamName: "amazon-apigateway-logs-delivery-stream",
          extendedS3DestinationConfiguration: {
            bucketArn: APILogsBucket.bucketArn,
            cloudWatchLoggingOptions: {
              enabled: true,
              logGroupName: firehoseAPIDeliveryStreamLogGroup.logGroupName,
              logStreamName: firehoseAPIDeliveryStreamLogStream.logStreamName
            },
            roleArn: firehoseAPIDeliveryStreamRole.roleArn,
            prefix:
              "logs/year=!{partitionKeyFromLambda:year}/month=!{partitionKeyFromLambda:month}/day=!{partitionKeyFromLambda:day}/hour=!{partitionKeyFromLambda:hour}/",
            errorOutputPrefix:
              "errors/!{firehose:random-string}/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/",
            processingConfiguration: {
              enabled: true,
              processors: [
                {
                  type: "Lambda",
                  parameters: [
                    {
                      parameterName: "LambdaArn",
                      parameterValue: APILogsProcessor.functionArn
                    }
                  ]
                },
                {
                  type: "AppendDelimiterToRecord",
                  parameters: [
                    { parameterName: "Delimiter", parameterValue: "\\n" }
                  ]
                }
              ]
            },
            dynamicPartitioningConfiguration: {
              enabled: true
            },
            bufferingHints: {
              intervalInSeconds: 60
            }
          }
        }
      );

    const api = new aws_apigateway.RestApi(this, "api", {
      defaultMethodOptions: {
        apiKeyRequired: true
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ["*"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowHeaders: ["*"]
      },
      deployOptions: {
        accessLogFormat: aws_apigateway.AccessLogFormat.custom(
          this.accessLogFormat
        ),
        loggingLevel: aws_apigateway.MethodLoggingLevel.INFO,
        accessLogDestination: new FirehoseAccessLogsDestination(
          firehoseAPILogsDeliveryStream
        )
      }
    });

    const APIUsagePlan = api.addUsagePlan("APIUsagePlan", {
      name: "ForAPIKeys",
      apiStages: [
        {
          api,
          stage: api.deploymentStage
        }
      ]
    });
    APIUsagePlan.addApiKey(firstAPIKey);
    APIUsagePlan.addApiKey(secondAPIKey);

    const helloIntegration = new aws_apigateway.MockIntegration({
      passthroughBehavior: aws_apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        "application/json": '{"statusCode": 200}'
      },
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Headers": "'*'",
            "method.response.header.Access-Control-Allow-Methods":
              "'OPTIONS,GET'",
            "method.response.header.Access-Control-Allow-Origin": "'*'"
          },
          responseTemplates: {
            "application/json": '{"message": "Hi there!"}'
          }
        }
      ]
    });

    const helloMethod = api.root.addMethod("GET", helloIntegration, {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Methods": true,
            "method.response.header.Access-Control-Allow-Origin": true
          }
        }
      ]
    });

    const glueDatabase = new aws_glue.CfnDatabase(this, "GlueDatabase", {
      catalogId: Aws.ACCOUNT_ID,
      databaseInput: {
        name: "apilogscrawlerdb"
      }
    });

    /**
     * https://docs.aws.amazon.com/glue/latest/dg/create-an-iam-role.html
     */
    const crawlerRole = new aws_iam.Role(this, "GlueCrawlerRole", {
      assumedBy: new aws_iam.ServicePrincipal("glue.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSGlueServiceRole"
        )
      ],
      inlinePolicies: {
        allowAPILogsBucketAccess: new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              actions: ["s3:*"],
              resources: [
                APILogsBucket.bucketArn,
                APILogsBucket.arnForObjects("*")
              ]
            })
          ]
        })
      }
    });

    const glueCrawler = new aws_glue.CfnCrawler(this, "GlueCrawler", {
      role: crawlerRole.roleArn,
      targets: {
        s3Targets: [
          {
            path: `${APILogsBucket.bucketName}/logs/`
          }
        ]
      },
      databaseName: glueDatabase.ref
    });
  }

  private accessLogFormat = JSON.stringify({
    requestId: aws_apigateway.AccessLogField.contextRequestId(),
    apiId: aws_apigateway.AccessLogField.contextApiId(),
    "identity.apiKeyId":
      aws_apigateway.AccessLogField.contextIdentityApiKeyId(),
    stage: aws_apigateway.AccessLogField.contextStage()
  });
}

class FirehoseAccessLogsDestination
  implements aws_apigateway.IAccessLogDestination
{
  constructor(
    private readonly deliveryStream: aws_kinesisfirehose.CfnDeliveryStream
  ) {}

  public bind(
    stage: aws_apigateway.IStage
  ): aws_apigateway.AccessLogDestinationConfig {
    return { destinationArn: this.deliveryStream.attrArn };
  }
}
