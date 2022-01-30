package main

import (
	"context"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/davecgh/go-spew/spew"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.KinesisFirehoseEvent) (events.KinesisFirehoseResponse, error) {
	spew.Dump(event)

	var response events.KinesisFirehoseResponse
	for _, record := range event.Records {
		response.Records = append(response.Records, events.KinesisFirehoseResponseRecord{
			RecordID: record.RecordID,
			Result:   "Ok",
			Data:     record.Data,
		})
	}

	return response, nil
}
