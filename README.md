# Visualizing API Gateway usage plans

Inspired by [this article](https://aws.amazon.com/blogs/compute/visualizing-amazon-api-gateway-usage-plans-using-amazon-quicksight/).

## Learnings

- Something changed between `aws-cdk: 2.0.0` and the `aws-cdk: 2.1.0`.

  - For some reason, I could not bootstrap my application without upgrading (used the default `npx cdk@2.0 init` command to set up the project).

No matter how many times I deploy the _API Gateway Mock Integration_, I always forget something.

- Remember about the _Method Responses_ properties!

- _API Gateway_ (REST) can expose logs in two ways.

  - There are **execution logs** which format you CAN NOT control.

  - There are **access logs** which format you CAN control.

  - The **execution logs** can be configured by specifying the **_Logging level_** property.

  - You can learn more about [by reading this fantastic article](https://seed.run/blog/whats-the-difference-between-access-logs-and-execution-logs-in-api-gateway.html).

- _Kinesis Data Firehose_ allows you to specify the **prefix** (the suffix is not configurable) under which _Kinesis Data Firehose_ will save the data (we are talking about _S3_ here).

- To **stream _API Gateway Access Logs_ to _Firehose_**, the delivery stream **must have a particular name scheme**.

  - The _API Gateway_ creates a service-linked role in your account. The role allows the service to push records to _Firehose_.

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

- It **used to be** a thing that you had to **append a newline to each _Firehose_ JSON record**. Otherwise, the records would be treated as a single record.

  - You can specify the `AppendDelimiterToRecord` **processor** so that you do not have to do it!.

  - Sadly, **the `AppendDelimiterToRecord`** is **only available when _dynamic partitioning_ is turned on!**.

  - The `@aws-cdk/aws-kinesisfirehose-alpha` package does not expose the _dynamic partitioning_ options.

- By **using _dynamic partitioning_**, you **lose the ability to use the built-in variables like `!{timestamp:XXX}` and others**.

  - You have to provide them by yourself. You can either do that **within the processor Lambda** or **inline using `jq`**.

  - Remember that **you pay an additional fee for using the _dynamic partitioning_** feature.

  Interestingly, **the rule does not apply to `ErrorOutputPrefix` property**.

  > You cannot use partitionKeyFromLambda and partitionKeyFromQuery namespaces when creating ErrorOutputPrefix expressions.

- The **_dynamic partitioning_ feature is excellent!**, but I feel like using it only for the newline case is quite a considerable overhead.

- If you want to use _API Gateway API Keys_, you **have to associate the API Key with a usage plan**.

  - If you do not, the _API Gateway_ will reject the request.

    > API Key ... not authorized because method 'GET /' requires API Key and API Key is not associated with a Usage Plan for API Stage zsuvlqr7nb/prod: No Usage Plan found for key and API Stage

  - The **_usage plan_ has to be associated with API stage**. Otherwise, _API Gateway_ will reject the request (the same error as above).

- The **access logs** are **produced before the execution logs**. Makes sense.

- _API Gateway_ has weird _IAM actions_ scheme.

  - To retrieve information about an API Key, the `apigateway:GET` action is used on the API Key resource, weird.

  - Refer to [this question](https://repost.aws/questions/QUbbuJnHDORfKRjquIsCWfug/api-gateway-iam-actions-permissions-definition).

- The `Lazy` exported from _AWS CDK_ is not for circular reference resolution.

  - The only reliable way to resolve circular references is to **split resources that cause the circular reference**.

- We went through all that _Firehose_ partitioning problems so that, when we query the data using _Athena_, the query is fast and cost-efficient.

  - If we did not, _Athena_ would be forced to scan **all of our objects in the bucket**. Not ideal.

  - If you do not partition, you might also have problems with throttling on the _S3_ level. [Refer to this documentation page](https://docs.aws.amazon.com/athena/latest/ug/partitions.html#partitions-considerations-limitations).

    > If you issue queries against Amazon S3 buckets with many objects and the data is not partitioned, such queries may affect the GET request rate limits in Amazon S3 and lead to Amazon S3 exceptions.

- _Athena_ needs a _table_ to run the queries. To **create a table, you can either do it manually via _Athena_ SDL, _Glue_ or using _Glue_ crawler**.

  - Using the crawler is pretty nice as it also detects the partitions for you!

- The example for the [`AWS::Glue::Crawler` resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-glue-crawler.html) is not valid. The **`name` property on the `AWS::Glue::Database.DatabaseInput` cannot contain uppercase characters**.

Before running any kind of _Athena_ queries, you have to set the location where _Athena_ will store the query output and metadata. [Documentation link](https://docs.aws.amazon.com/athena/latest/ug/querying.html).

- This setting is set **on the workgroup level**.

- Workgroup is **a way to control query access and costs**. [Documentation link](https://docs.aws.amazon.com/athena/latest/ug/manage-queries-control-costs-with-workgroups.html).

- The "primary" (default) workgroup is already created for you. I could not find a way to update it via IaC. I had to create a separate workgroup.

- It seems that _Athena_ uses [_service-linked role_](https://docs.aws.amazon.com/IAM/latest/UserGuide/using-service-linked-roles.html) to save the query results onto _S3_.

- The _custom resources_ framework that _AWS CDK_ exposes is great!

  - The `isCompleteHandler` property and the whole concept of _waiters_ is advantageous, especially for asynchronous jobs.

Initially, I thought it would be good to wait for the _Glue crawler_ to finish during the deployment (`isCompleteHandler` that checks the crawler state). After trying it, I concluded it might not be the best idea.

- One of the reasons is the _cold start_ of the _Glue crawler_. It takes a significant amount of time to start the crawler and even more time to wait for it to finish.

- The `startCrawler` API seems to be synchronous. If the crawler switches from "starting" to "running", it will respond successfully.

- All this waiting would significantly slow down the deployment pipeline.

- Instead of using the `startCrawler` API to start the _Glue crawler_, one might use a _Glue trigger_.

  - The _Glue trigger_ is an asynchronous API as opposed to `startCrawler` API (the `startCrawler` API waits for the crawler status to flip from "starting" to "running").

- TODO: `arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole` in `Policies` tab in _IAM_.

  - WTF?
  - Is this policy related to service-linked roles?
