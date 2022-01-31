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

- By **using _dynamic partitioning_** you **loose the ability to use the build-in variables like `!{timestamp:XXX}` and others**.

  - You have to provide them by yourself. You can either do that **within the processor Lambda** or **inline using `jq`**.

  - Remember that **you pay additional fee for using the _dynamic partitioning_** feature.

  - What is interesting that **the rule does not apply to `ErrorOutputPrefix` property**.
    > You cannot use partitionKeyFromLambda and partitionKeyFromQuery namespaces when creating ErrorOutputPrefix expressions.

- The **_dynamic partitioning_ feature is great!**, but I feel like using it only for the newline case is quite a big overhead.

- If you want to use _API Gateway API Keys_ you **have to associate the API Key with an usage plan**.

  - If you do not, the _API Gateway_ will reject the request.

    > API Key ... not authorized because method 'GET /' requires API Key and API Key is not associated with a Usage Plan for API Stage zsuvlqr7nb/prod: No Usage Plan found for key and API Stage

  - The **_usage plan_ has to be associated with API stage**. Otherwise, _API Gateway_ will reject the request (the same error as above).

- The **access logs** are **produced before the execution logs**. Makes sense.

- _API Gateway_ has weird _IAM actions_ scheme.

  - To retrieve information about an API Key, the `apigateway:GET` action is used on the API Key resource, weird.

  - Refer to [this question](https://repost.aws/questions/QUbbuJnHDORfKRjquIsCWfug/api-gateway-iam-actions-permissions-definition).

- The `Lazy` exported from _AWS CDK_ is not for circular reference resolution.

  - The only reliable way to resolve circular references is to **split resources that cause the circular reference**.

- We went through all that _Firehose_ partitioning problems so that, when we query the data using _Athena_, the query is fast and cost efficient.

  - If we did not, _Athena_ would be forced to scan **all of our objects in the bucket**. Not ideal.

  - If you do not partition, you might also have problems with throttling on _S3_ level. [Refer to this documentation page](https://docs.aws.amazon.com/athena/latest/ug/partitions.html#partitions-considerations-limitations).

    > If you issue queries against Amazon S3 buckets with a large number of objects and the data is not partitioned, such queries may affect the GET request rate limits in Amazon S3 and lead to Amazon S3 exceptions.

- _Athena_ needs a _table_ to run the queries. To **create a table, you can either do it manually via _Athena_ SDL, _Glue_ or using _Glue_ crawler**.

  - Using the crawler is pretty nice as it also detects the partitions for you!

- The example for the [`AWS::Glue::Crawler` resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-glue-crawler.html) is not valid. The **`name` property on the `AWS::Glue::Database.DatabaseInput` cannot contain uppercase characters**.

- TODO: `arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole` in `Policies` tab in _IAM_.

  - WTF?
  - Is this policy related to service-linked roles?

- TODO: Why do we need to partition the data. Is it for Glue or Athena?
