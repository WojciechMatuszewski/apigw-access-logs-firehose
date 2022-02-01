package main

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigateway"
)

type InData struct {
	RequestID        string `json:"requestId"`
	APIID            string `json:"apiId"`
	IdentityAPIKeyID string `json:"identity.apiKeyId"`
	Stage            string `json:"stage"`
}

type OutData struct {
	InData

	IdentityAPIKeyName        string `json:"identity.apiKeyName"`
	IdentityAPIKeyDescription string `json:"identity.apiKeyDescription"`
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.KinesisFirehoseEvent) (events.KinesisFirehoseResponse, error) {
	// spew.Dump(event)

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}

	apigw := apigateway.NewFromConfig(cfg)

	var response events.KinesisFirehoseResponse
	for _, record := range event.Records {

		var inData InData
		err := json.Unmarshal(record.Data, &inData)
		if err != nil {
			return events.KinesisFirehoseResponse{}, err
		}

		apiKeyData, err := apigw.GetApiKey(ctx, &apigateway.GetApiKeyInput{
			ApiKey: aws.String(inData.IdentityAPIKeyID),
		})
		if err != nil {
			panic(err)
		}

		if apiKeyData == nil {
			return events.KinesisFirehoseResponse{}, errors.New("apiKeyData is nil")
		}

		outData := OutData{
			InData: inData,
		}
		outData.IdentityAPIKeyName = *apiKeyData.Name
		outData.IdentityAPIKeyDescription = *apiKeyData.Description

		outDataB, err := json.Marshal(outData)
		if err != nil {
			return events.KinesisFirehoseResponse{}, err
		}

		partitionKeys := make(map[string]string)
		currentTime := time.Now()

		partitionKeys["year"] = strconv.Itoa(currentTime.Year())
		partitionKeys["month"] = strconv.Itoa(int(currentTime.Month()))
		partitionKeys["day"] = strconv.Itoa(currentTime.Day())
		partitionKeys["hour"] = strconv.Itoa(currentTime.Hour())

		response.Records = append(response.Records, events.KinesisFirehoseResponseRecord{
			RecordID: record.RecordID,
			Result:   "Ok",
			Data:     outDataB,
			Metadata: events.KinesisFirehoseResponseRecordMetadata{
				PartitionKeys: partitionKeys,
			},
		})
	}

	return response, nil
}
