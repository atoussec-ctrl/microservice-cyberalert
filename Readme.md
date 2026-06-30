# Threat Triage & Alerts Engine

An **event-driven cybersecurity worker** built with **NestJS + TypeScript**, backed by **PostgreSQL** and **AWS SNS/SQS**. It is the *Motor de Triagem e Alertas de Ameaças* — a Threat Intelligence microservice designed for autonomous-defense pipelines.

## What it does

```
 scanner / C2 node          SNS topic            SQS queue              NestJS worker                 SNS topic
┌──────────────────┐   ┌──────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐  ┌────────────────────┐
│ anomaly / payload│──▶│  threat-detected │─▶│ threat-analysis-queue│─▶│  ThreatConsumerService │─▶│  block-ip-command  │
│   detected       │   │     (fan-out)    │  │   (+ DLQ redrive)    │  │  → score → persist     │  │  (critical only)   │
└──────────────────┘   └──────────────────┘  └──────────────────────┘  └───────────┬────────────┘  └────────────────────┘
                                                                                    │
                                                                                    ▼
                                                                              PostgreSQL
                                                                       (consolidated intel)
```

1. A scanner or C2 node publishes a `threat-detected` event to an **SNS topic**.
2. The `threat-analysis-queue` **SQS queue** is subscribed to that topic, absorbing spikes from mass scans/attacks so the worker is never overwhelmed.
3. The **NestJS worker** consumes messages, **scores severity** with a transparent weighted-sum model, **cross-references** indicators, and **persists** the consolidated record to **PostgreSQL** (idempotently).
4. If the threat is **CRITICAL**, the worker emits a `block-ip-command` event to a second SNS topic for a downstream firewall/EDR service to act on.

### Why this stack

Security demands **rigorous auditability and low data loss**. SNS/SQS guarantees that no alert is dropped: failures (poison payloads *and* transient errors) are never silently deleted — they are left on the queue and, after `maxReceiveCount` retries, redriven to a **Dead Letter Queue (DLQ)** for inspection.

## Severity model

The verdict is a deterministic, reproducible weighted sum (0–100):

| Factor      | Weight | Source                              |
| ----------- | ------ | ----------------------------------- |
| CVSS        | 0.50   | `cvssScore` (0–10), normalized      |
| Category    | 0.30   | intrinsic weight per `category`     |
| Confidence  | 0.20   | detector `confidence` (0–1)         |
| Indicators  | +0.20 max | `+0.05` per IoC, capped          |

Buckets: `>=85 CRITICAL`, `>=60 HIGH`, `>=35 MEDIUM`, else `LOW`. Only **CRITICAL** triggers a `block-ip-command`. See `src/threats/domain/severity-analyzer.ts`.

## Event contracts

`threat-detected` (consumed) and `block-ip-command` (produced) are defined in
`src/threats/domain/threat-detected.event.ts` and
`src/threats/domain/block-ip-command.event.ts`. Incoming events are validated at
the boundary (`src/threats/dto/threat-detected.dto.ts`) so malformed messages
fail fast into the DLQ.

## Project layout

```
src/
├── common/            # cross-cutting: global exception filter, error envelope
├── config/            # typed configuration loader + startup env validation
├── messaging/         # AWS SNS/SQS clients, publisher, SNS-envelope unwrapping
├── threats/
│   ├── domain/        # pure logic: severity analyzer, enums, event contracts
│   ├── dto/           # class-validator boundary validation
│   ├── entities/      # TypeORM Threat entity
│   ├── threat-triage.service.ts    # score → persist (idempotent) → emit
│   ├── threat-consumer.service.ts  # long-polling SQS worker
│   └── threats.controller.ts       # read-only query API
├── health/            # /health (Terminus + DB ping)
├── app.module.ts
└── main.ts
```

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Boot PostgreSQL + LocalStack (SNS/SQS + DLQ topology auto-provisioned)
docker compose up -d

# 3. Configure env
cp .env.example .env

# 4. Run the worker
npm run start:dev

# 5. In another shell, fire a sample CRITICAL threat and watch it get triaged
bash scripts/publish-sample-threat.sh
```

### Read the consolidated intelligence

```bash
curl 'http://localhost:3000/threats?severity=CRITICAL'
curl 'http://localhost:3000/health'
```

## Error handling

A platform-agnostic catch-all filter (`src/common/filters/all-exceptions.filter.ts`,
registered via `APP_FILTER`) turns every failure into a consistent envelope:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Threat <id> not found",
  "timestamp": "2026-06-30T19:24:50.813Z",
  "path": "/threats/<id>"
}
```

- Validation errors (`class-validator`, `ParseUUIDPipe`, `ParseEnumPipe`, `ParseIntPipe`) → **400** with the failing field message(s).
- Missing resource → **404** (`NotFoundException`).
- TypeORM `EntityNotFoundError` → **404**; unique-constraint `QueryFailedError` → **409**.
- Unexpected errors → **500**, with internal details **redacted in production** (`NODE_ENV=production`) and full stack traces logged server-side.

Configuration is validated at boot (`src/config/env.validation.ts`): malformed
numeric vars and out-of-range SQS settings fail fast, and the critical
DB/messaging vars are required in production — the service never starts in a
silently-broken state.

## Testing

Unit tests (no external services required):

```bash
npm test          # run the unit suite
npm run test:cov  # with coverage
```

End-to-end tests run the full app (HTTP endpoints, global exception filter, the
SQS worker, triage and persistence) against a **real PostgreSQL** instance, with
the AWS SDK clients replaced by in-memory fakes:

```bash
# Requires a reachable Postgres; defaults to localhost:5432 / db `threat_intelligence_test`.
# Override via DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME.
createdb threat_intelligence_test   # once
npm run test:e2e
```

Covered behaviours include: severity scoring & thresholds, SNS-envelope
unwrapping, idempotent triage (including concurrent-duplicate races), CRITICAL →
`block-ip-command` emission, the consumer's DLQ-safe delete semantics (delete
only on success), the standardized error envelope, and every HTTP endpoint
(health, list with filters, fetch-by-id, 400/404 paths).

## Production notes

- Set `DB_SYNCHRONIZE=false` and manage schema via TypeORM migrations.
- Use IAM roles instead of static keys; drop `AWS_ENDPOINT_URL` to target real AWS.
- Tune `SQS_VISIBILITY_TIMEOUT` to exceed worst-case processing time and the DLQ
  `maxReceiveCount` to your retry budget.
