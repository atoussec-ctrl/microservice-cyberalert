#!/usr/bin/env bash
# Provisions the SNS topics, SQS queues (with a Dead Letter Queue + redrive
# policy) and the topic->queue subscription used by the Threat Triage Engine.
# Executed automatically by LocalStack on startup.
set -euo pipefail

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENDPOINT="http://localhost:4566"
ACCOUNT_ID="000000000000"

aws() { command aws --endpoint-url "$ENDPOINT" "$@"; }

echo "[init] Creating SNS topics..."
aws sns create-topic --name threat-detected >/dev/null
aws sns create-topic --name block-ip-command >/dev/null

echo "[init] Creating SQS Dead Letter Queue..."
aws sqs create-queue --queue-name threat-analysis-dlq >/dev/null

DLQ_ARN="arn:aws:sqs:${AWS_DEFAULT_REGION}:${ACCOUNT_ID}:threat-analysis-dlq"

echo "[init] Creating SQS analysis queue with redrive policy (maxReceiveCount=5)..."
aws sqs create-queue \
  --queue-name threat-analysis-queue \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\",\"VisibilityTimeout\":\"60\"}" \
  >/dev/null

QUEUE_ARN="arn:aws:sqs:${AWS_DEFAULT_REGION}:${ACCOUNT_ID}:threat-analysis-queue"
TOPIC_ARN="arn:aws:sns:${AWS_DEFAULT_REGION}:${ACCOUNT_ID}:threat-detected"

echo "[init] Subscribing threat-analysis-queue to threat-detected (raw delivery)..."
aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol sqs \
  --notification-endpoint "$QUEUE_ARN" \
  --attributes '{"RawMessageDelivery":"true"}' \
  >/dev/null

echo "[init] Threat Triage Engine messaging topology ready."
