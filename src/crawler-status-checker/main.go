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
	gluetypes "github.com/aws/aws-sdk-go-v2/service/glue/types"
	"github.com/davecgh/go-spew/spew"
)

func main() {
	lambda.Start(handler)
}

type Output struct {
	IsComplete bool `json:"IsComplete"`
}

func handler(ctx context.Context, event cfn.Event) (Output, error) {
	spew.Dump(event)

	fmt.Println("Retrieving crawler name")

	crawlerName, found := event.ResourceProperties["CrawlerName"].(string)
	if !found {
		return Output{}, errors.New("CrawlerName is required")
	}

	fmt.Println("Initializing the client")

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}

	glueClient := glue.NewFromConfig(cfg)

	fmt.Println("Checking crawler", crawlerName, "status")

	out, err := glueClient.GetCrawler(ctx, &glue.GetCrawlerInput{
		Name: aws.String(crawlerName),
	})
	if err != nil {
		return Output{}, fmt.Errorf("failed to get crawler: %w", err)
	}

	fmt.Println("Crawler", crawlerName, "state:", out.Crawler.State)

	if out.Crawler.State == gluetypes.CrawlerStateStopping {
		return Output{IsComplete: true}, nil
	}

	return Output{IsComplete: false}, nil
}
