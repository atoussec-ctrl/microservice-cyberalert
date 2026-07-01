import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Threat Triage & Alerts Engine')
    .setDescription(
      [
        'Event-driven cybersecurity worker — **NestJS + PostgreSQL + SNS/SQS**.',
        '',
        '## Write path (async)',
        '1. Scanners publish `threat-detected` events to SNS.',
        '2. `threat-analysis-queue` (SQS) buffers spikes.',
        '3. The NestJS worker scores severity, persists idempotently, and emits `block-ip-command` for **CRITICAL** threats.',
        '',
        '## Read path (sync REST)',
        'Use the endpoints below for dashboards and audits. Use the Postman collection in `docs/postman/` to publish sample events via LocalStack.',
        '',
        '### Severity buckets',
        '| Score | Bucket | Action |',
        '|-------|--------|--------|',
        '| ≥ 85 | CRITICAL | `block-ip-command` emitted |',
        '| ≥ 60 | HIGH | Persist only |',
        '| ≥ 35 | MEDIUM | Persist only |',
        '| < 35 | LOW | Persist only |',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addTag('Health', 'Dependency health checks')
    .addTag('Threats', 'Consolidated threat intelligence (read-only)')
    .addServer('http://localhost:3001', 'Local development')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Threat Triage Engine — OpenAPI',
    swaggerOptions: { persistAuthorization: true },
  });
}
