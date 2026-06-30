#!/usr/bin/env bash
# Publishes a sample `threat-detected` event to the SNS topic so you can watch
# the worker triage it end-to-end against LocalStack.
set -euo pipefail

ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
TOPIC_ARN="arn:aws:sns:${REGION}:000000000000:threat-detected"
THREAT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

MESSAGE=$(cat <<JSON
{
  "threatId": "${THREAT_ID}",
  "detectedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "source": "c2-node-7",
  "sourceIp": "198.51.100.23",
  "category": "exfiltration",
  "signature": "ET TROJAN Observed Malicious SSL Cert",
  "cvssScore": 9.8,
  "confidence": 0.97,
  "indicators": ["sha256:deadbeef", "evil.example.com", "198.51.100.23"]
}
JSON
)

aws --endpoint-url "$ENDPOINT" --region "$REGION" sns publish \
  --topic-arn "$TOPIC_ARN" \
  --message "$MESSAGE"

echo "Published threat ${THREAT_ID} to ${TOPIC_ARN}"
