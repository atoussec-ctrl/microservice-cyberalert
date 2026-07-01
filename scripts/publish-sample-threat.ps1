# Publishes a sample CRITICAL threat to LocalStack SNS for end-to-end triage testing.
param(
  [string]$Endpoint = $(if ($env:AWS_ENDPOINT_URL) { $env:AWS_ENDPOINT_URL } else { "http://localhost:4566" }),
  [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" })
)

$ErrorActionPreference = "Stop"
$ThreatId = [guid]::NewGuid().ToString()
$TopicArn = "arn:aws:sns:${Region}:000000000000:threat-detected"
$MessagePath = Join-Path $PSScriptRoot "sample-threat.json"

$payload = @{
  threatId = $ThreatId
  detectedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  source = "c2-node-7"
  sourceIp = "198.51.100.23"
  category = "exfiltration"
  signature = "ET TROJAN Observed Malicious SSL Cert"
  cvssScore = 9.8
  confidence = 0.97
  indicators = @("sha256:deadbeef", "evil.example.com", "198.51.100.23")
} | ConvertTo-Json -Compress

Set-Content -Path $MessagePath -Value $payload -NoNewline -Encoding utf8
docker cp $MessagePath threat-localstack:/tmp/sample-threat.json | Out-Null
docker exec threat-localstack awslocal sns publish `
  --topic-arn $TopicArn `
  --message file:///tmp/sample-threat.json | Out-Null

Write-Host "Published threat $ThreatId to $TopicArn"
