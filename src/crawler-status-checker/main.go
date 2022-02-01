package main

import (
	"context"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/davecgh/go-spew/spew"
)

func main() {
	lambda.Start(handler)
}

type Output struct {
	IsComplete bool `json:"IsComplete"`
}

func handler(ctx context.Context, event interface{}) (Output, error) {
	spew.Dump(event)

	return Output{IsComplete: true}, nil
}
