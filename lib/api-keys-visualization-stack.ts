import {
  aws_apigateway,
  aws_lambda,
  aws_logs,
  aws_s3,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_kinesisfirehose as aws_kinesisfirehose_vanilla
} from "aws-cdk-lib";
import * as aws_kinesisfirehose from "@aws-cdk/aws-kinesisfirehose-alpha";
import * as aws_kinesisfirehose_destinations from "@aws-cdk/aws-kinesisfirehose-destinations-alpha";
import * as aws_lambda_go from "@aws-cdk/aws-lambda-go-alpha";
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

    // const kinesisAPILogsDeliveryStream =
    //   new aws_kinesisfirehose.CfnDeliveryStream(
    //     this,
    //     "KinesisAPILogsDeliveryStream",
    //     {
    //       s3DestinationConfiguration: {
    //         bucketArn: APILogsBucket.bucketArn,
    //         roleArn: ""
    //       },
    //       extendedS3DestinationConfiguration: {
    //         dataFormatConversionConfiguration: {},
    //         processingConfiguration: {
    //           processors: [
    //             {
    //               type: "AppendDelimiterToRecord",
    //               parameters: [
    //                 { parameterName: "Delimiter", parameterValue: "\\n" }
    //               ]
    //             }
    //           ]
    //         },
    //         dynamicPartitioningConfiguration: {
    //           enabled: true
    //         }
    //       }
    //     }
    //   );

    const APILogsProcessor = new aws_lambda_go.GoFunction(
      this,
      "APILogsProcessor",
      {
        entry: join(__dirname, "../src"),
        runtime: aws_lambda.Runtime.PROVIDED_AL2
      }
    );

    const kinesisAPILogsDeliveryStream = new aws_kinesisfirehose.DeliveryStream(
      this,
      "kinesisAPILogsDeliveryStream",
      {
        deliveryStreamName: "amazon-apigateway-access-logs",
        destinations: [
          new aws_kinesisfirehose_destinations.S3Bucket(APILogsBucket, {
            logging: true,
            /**
             * The `!{...}` expressions are evaluated by Firehose @delivery-time.
             */
            dataOutputPrefix:
              "logs/year=!{timestamp:YYYY}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/",
            errorOutputPrefix:
              "errors/!{firehose:random-string}/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/",
            bufferingInterval: Duration.seconds(60),
            processor: new aws_kinesisfirehose.LambdaFunctionProcessor(
              APILogsProcessor
            )
          })
        ]
      }
    );

    const cfnKinesisAPILogsDeliveryStream = kinesisAPILogsDeliveryStream.node
      .defaultChild as aws_kinesisfirehose_vanilla.CfnDeliveryStream;

    cfnKinesisAPILogsDeliveryStream.addPropertyOverride(
      "ExtendedS3DestinationConfiguration.ProcessingConfiguration.Processors.1",
      {
        Type: "AppendDelimiterToRecord",
        Parameters: [
          {
            ParameterName: "Delimiter",
            ParameterValue: "\\n"
          }
        ]
      }
    );

    const api = new aws_apigateway.RestApi(this, "api", {
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
          kinesisAPILogsDeliveryStream
        )
      }
    });

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
    private readonly deliveryStream: aws_kinesisfirehose.DeliveryStream
  ) {}

  public bind(
    stage: aws_apigateway.IStage
  ): aws_apigateway.AccessLogDestinationConfig {
    return { destinationArn: this.deliveryStream.deliveryStreamArn };
  }
}
