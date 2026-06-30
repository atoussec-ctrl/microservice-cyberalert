import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { PublishCommand } from '@aws-sdk/client-sns';

/**
 * End-to-end tests against a real PostgreSQL instance. The AWS SDK clients are
 * replaced with in-memory fakes so the worker logic, persistence, HTTP
 * endpoints and the global exception filter are all exercised together without
 * needing LocalStack.
 */

const QUEUE_URL =
  'https://sqs.us-east-1.amazonaws.com/000000000000/threat-analysis-queue';
const BLOCK_TOPIC = 'arn:aws:sns:us-east-1:000000000000:block-ip-command';

class FakeSqsClient {
  private inbox: unknown[] = [];
  public deleted: string[] = [];

  enqueue(body: object, receiptHandle: string): void {
    this.inbox.push({
      MessageId: receiptHandle,
      ReceiptHandle: receiptHandle,
      Body: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify(body),
      }),
    });
  }

  async send(command: unknown): Promise<unknown> {
    if (command instanceof ReceiveMessageCommand) {
      const Messages = this.inbox;
      this.inbox = [];
      return { Messages };
    }
    if (command instanceof DeleteMessageCommand) {
      this.deleted.push(command.input.ReceiptHandle as string);
      return {};
    }
    return {};
  }
}

class FakeSnsClient {
  public published: { topicArn?: string; message: unknown }[] = [];

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PublishCommand) {
      this.published.push({
        topicArn: command.input.TopicArn,
        message: JSON.parse(command.input.Message as string),
      });
      return { MessageId: 'fake-msg-id' };
    }
    return {};
  }
}

const criticalThreat = (threatId: string) => ({
  threatId,
  detectedAt: '2026-06-30T12:00:00.000Z',
  source: 'c2-node-7',
  sourceIp: '198.51.100.23',
  category: 'exfiltration',
  signature: 'ET TROJAN Observed Malicious SSL Cert',
  cvssScore: 9.8,
  confidence: 0.97,
  indicators: ['sha256:deadbeef', 'evil.example.com'],
});

const lowThreat = (threatId: string) => ({
  threatId,
  detectedAt: '2026-06-30T12:05:00.000Z',
  source: 'scanner-01',
  sourceIp: '203.0.113.10',
  category: 'recon',
  cvssScore: 1,
  confidence: 0.1,
});

describe('Threat Triage Engine (e2e)', () => {
  let app: INestApplication;
  let sqs: FakeSqsClient;
  let sns: FakeSnsClient;
  let dataSource: DataSource;
  let consumer: { pollOnce: () => Promise<number> };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = process.env.DB_HOST ?? 'localhost';
    process.env.DB_PORT = process.env.DB_PORT ?? '5432';
    process.env.DB_USERNAME = process.env.DB_USERNAME ?? 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? 'postgres';
    process.env.DB_NAME = process.env.DB_NAME ?? 'threat_intelligence_test';
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.THREAT_ANALYSIS_QUEUE_URL = QUEUE_URL;
    process.env.BLOCK_IP_COMMAND_TOPIC_ARN = BLOCK_TOPIC;
    process.env.SQS_POLLING_ENABLED = 'false';
    process.env.SQS_WAIT_TIME_SECONDS = '0';

    // Import after env is configured so the config factory reads the test values.
    const { AppModule } = await import('../src/app.module');
    const { SQS_CLIENT, SNS_CLIENT } =
      await import('../src/messaging/aws.tokens');
    const { ThreatConsumerService } =
      await import('../src/threats/threat-consumer.service');

    sqs = new FakeSqsClient();
    sns = new FakeSnsClient();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SQS_CLIENT)
      .useValue(sqs)
      .overrideProvider(SNS_CLIENT)
      .useValue(sns)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    consumer = app.get(ThreatConsumerService);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE threats RESTART IDENTITY CASCADE');
    sns.published = [];
    sqs.deleted = [];
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /health', () => {
    it('reports the service and database as healthy', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.info.database.status).toBe('up');
    });
  });

  describe('GET /threats', () => {
    it('returns an empty array when there is no data', async () => {
      const res = await request(app.getHttpServer())
        .get('/threats')
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('rejects an invalid severity filter with a standardized 400 error', async () => {
      const res = await request(app.getHttpServer())
        .get('/threats?severity=BOGUS')
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: expect.any(String),
        path: '/threats?severity=BOGUS',
      });
      expect(res.body.timestamp).toEqual(expect.any(String));
    });

    it('rejects a non-numeric limit with a 400 error', async () => {
      await request(app.getHttpServer()).get('/threats?limit=abc').expect(400);
    });
  });

  describe('GET /threats/:threatId', () => {
    it('returns 400 for a malformed UUID', async () => {
      const res = await request(app.getHttpServer())
        .get('/threats/not-a-uuid')
        .expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    it('returns a standardized 404 when the threat does not exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/threats/11111111-1111-4111-8111-111111111111')
        .expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });
  });

  describe('worker → triage → persistence → SNS', () => {
    it('triages a CRITICAL threat, persists it, deletes the message and emits block-ip-command', async () => {
      const threatId = '22222222-2222-4222-8222-222222222222';
      sqs.enqueue(criticalThreat(threatId), 'rh-critical');

      const processed = await consumer.pollOnce();
      expect(processed).toBe(1);
      expect(sqs.deleted).toContain('rh-critical');

      // Persisted and queryable via the API
      const list = await request(app.getHttpServer())
        .get('/threats?severity=CRITICAL')
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        threatId,
        severity: 'CRITICAL',
        sourceIp: '198.51.100.23',
        blockCommandIssued: true,
      });

      const detail = await request(app.getHttpServer())
        .get(`/threats/${threatId}`)
        .expect(200);
      expect(detail.body.threatId).toBe(threatId);

      // Emitted a block-ip-command to the correct topic
      expect(sns.published).toHaveLength(1);
      expect(sns.published[0].topicArn).toBe(BLOCK_TOPIC);
      expect(sns.published[0].message).toMatchObject({
        targetIp: '198.51.100.23',
        severity: 'CRITICAL',
        threatId,
      });
    });

    it('does NOT emit a block-ip-command for a LOW severity threat', async () => {
      const threatId = '33333333-3333-4333-8333-333333333333';
      sqs.enqueue(lowThreat(threatId), 'rh-low');

      await consumer.pollOnce();

      const detail = await request(app.getHttpServer())
        .get(`/threats/${threatId}`)
        .expect(200);
      expect(detail.body.severity).toBe('LOW');
      expect(detail.body.blockCommandIssued).toBe(false);
      expect(sns.published).toHaveLength(0);
    });

    it('is idempotent across redeliveries of the same threatId', async () => {
      const threatId = '44444444-4444-4444-8444-444444444444';
      sqs.enqueue(criticalThreat(threatId), 'rh-1');
      await consumer.pollOnce();

      sqs.enqueue(criticalThreat(threatId), 'rh-2');
      await consumer.pollOnce();

      const list = await request(app.getHttpServer())
        .get('/threats')
        .expect(200);
      expect(list.body).toHaveLength(1);
      // Only the first delivery should have emitted a command.
      expect(sns.published).toHaveLength(1);
    });

    it('routes a poison (invalid) message to the DLQ by not deleting it', async () => {
      sqs.enqueue(
        { ...criticalThreat('not-a-uuid'), sourceIp: 'bad-ip' },
        'rh-poison',
      );

      const processed = await consumer.pollOnce();
      expect(processed).toBe(0);
      expect(sqs.deleted).not.toContain('rh-poison');

      const list = await request(app.getHttpServer())
        .get('/threats')
        .expect(200);
      expect(list.body).toEqual([]);
    });
  });
});
