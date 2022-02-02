package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-lambda-go/cfn"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/glue"
	"github.com/davecgh/go-spew/spew"
)

func main() {
	lambda.Start(cfn.LambdaWrap(handler))
}

func handler(ctx context.Context, event cfn.Event) (physicalResourceID string, data map[string]interface{}, err error) {
	spew.Dump(event)

	if event.RequestType == cfn.RequestDelete {
		fmt.Println("Delete event type, skipping")
		return
	}

	fmt.Println("Retrieving trigger name")

	triggerName, found := event.ResourceProperties["TriggerName"].(string)
	if !found {
		return physicalResourceID, data, errors.New("TriggerName is required")
	}

	fmt.Println("Initializing the client")

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}

	glueClient := glue.NewFromConfig(cfg)

	fmt.Println("Activating the trigger", triggerName)

	_, err = glueClient.StartTrigger(ctx, &glue.StartTriggerInput{
		Name: aws.String(triggerName),
	})
	if err != nil {
		return physicalResourceID, data, fmt.Errorf("failed to activate the trigger: %w", err)
	}

	fmt.Println("Trigger", triggerName, "activated")

	return
}
