# Visualizing API Gateway usage plans

Inspired by [this article](https://aws.amazon.com/blogs/compute/visualizing-amazon-api-gateway-usage-plans-using-amazon-quicksight/).

**WORK IN PROGRESS**

## Learnings

- Something changed between `aws-cdk: 2.0.0` and the `aws-cdk: 2.1.0`.

  - For some reason I was unable to bootstrap my application without upgrading (used the default `npx cdk@2.0 init` command to setup the project).

- No matter how many times I deploy the _API Gateway Mock Integration_ there is always something I forget.

  - Remember about the _Method Responses_ properties!

- _API Gateway_ (REST) can expose logs in two ways.

  - There are **execution logs** which format you CAN NOT control.

  - There are **access logs** which format you CAN control.

  - The **execution logs** can be configured by specifying the **_Logging level_** property.

  - You can learn more about [by reading this great article](https://seed.run/blog/whats-the-difference-between-access-logs-and-execution-logs-in-api-gateway.html).

- _Kinesis Data Firehose_ allows you to specify the **prefix** (suffix is not configurable) under which the data will be saved (we are talking about _S3_ here).

- To **stream _API Gateway Access Logs_ to _Firehose_** the delivery stream **must have particular name scheme**.

  - The _API Gateway_ creates a service linked role in your account. That role contains permissions for the service to be able to push records to _Firehose_.

    ```json
    {
      "Effect": "Allow",
      "Action": [
        "firehose:DescribeDeliveryStream",
        "firehose:PutRecord",
        "firehose:PutRecordBatch"
      ],
      "Resource": "arn:aws:firehose:*:*:deliverystream/amazon-apigateway-*"
    }
    ```

  - It would be pretty neat for the _API Gateway_ not to hide this fact. It seems a little bit too magical to me. Why not allow customers to create the role themselves? (or at least give that option)?

  - Learn more [here](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-logging-to-kinesis.html#set-up-kinesis-access-logging-using-console).

- The `autoDeleteObjects` on `aws_s3.Bucket` construct checks whether the `removalPolicy` is set to `DESTROY`, but the check **happens before the Aspects have a chance to run**.

- It **used to be** a thing that you had to **append newline to each _Firehose_ JSON record**. Otherwise the records would be treated as a single record.

  - You can specify the `AppendDelimiterToRecord` **processor** so that you do not have to do it!.

  - Sadly, **the `AppendDelimiterToRecord`** is **only available when _dynamic partitioning_ is turned on!**.

  - The `@aws-cdk/aws-kinesisfirehose-alpha` package does not expose the _dynamic partitioning_ options.
