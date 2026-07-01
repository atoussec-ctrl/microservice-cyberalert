import { Test } from '@nestjs/testing';
import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import request from 'supertest';
import { ThreatsModule } from '../src/threats/threats.module';
import { HealthModule } from '../src/health/health.module';
import { Threat } from '../src/threats/entities/threat.entity';
import { Severity } from '../src/threats/domain/severity.enum';
import { ThreatCategory } from '../src/threats/domain/threat-category.enum';
import { SnsPublisherService } from '../src/messaging/sns-publisher.service';
import { SQS_CLIENT } from '../src/messaging/aws.tokens';

const messagingConfig = {
  threatAnalysisQueueUrl: '',
  blockIpCommandTopicArn: 'arn:aws:sns:us-east-1:000:block-ip-command',
  waitTimeSeconds: 20,
  maxMessages: 10,
  visibilityTimeoutSeconds: 60,
  pollingEnabled: false,
};

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: { getOrThrow: () => messagingConfig },
    },
    { provide: SnsPublisherService, useValue: { publish: jest.fn() } },
    { provide: SQS_CLIENT, useValue: { send: jest.fn() } },
  ],
  exports: [ConfigService, SnsPublisherService, SQS_CLIENT],
})
class FakeDepsModule {}

interface FindOptions {
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  take?: number;
}

class InMemoryThreatRepository {
  constructor(private readonly rows: Threat[]) {}

  async find(options: FindOptions = {}): Promise<Threat[]> {
    let result = [...this.rows];
    const where = options.where ?? {};
    for (const [key, value] of Object.entries(where)) {
      result = result.filter(
        (row) => (row as unknown as Record<string, unknown>)[key] === value,
      );
    }
    if (options.order?.detectedAt === 'DESC') {
      result.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    }
    if (options.take !== undefined) {
      result = result.slice(0, options.take);
    }
    return result;
  }

  async findOne(options: {
    where: { threatId: string };
  }): Promise<Threat | null> {
    return (
      this.rows.find((row) => row.threatId === options.where.threatId) ?? null
    );
  }
}

const buildThreat = (overrides: Partial<Threat>): Threat =>
  ({
    id: overrides.threatId,
    source: 'scanner-01',
    sourceIp: '203.0.113.10',
    category: ThreatCategory.MALWARE,
    signature: null,
    severity: Severity.LOW,
    score: 10,
    cvssScore: 1,
    confidence: 0.1,
    indicators: [],
    scoreBreakdown: null,
    rawPayload: null,
    blockCommandIssued: false,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }) as Threat;

const THREAT_1 = buildThreat({
  threatId: '11111111-1111-4111-8111-111111111111',
  sourceIp: '198.51.100.1',
  severity: Severity.LOW,
  detectedAt: new Date('2026-06-01T00:00:00.000Z'),
});

const THREAT_2 = buildThreat({
  threatId: '22222222-2222-4222-8222-222222222222',
  sourceIp: '198.51.100.2',
  severity: Severity.CRITICAL,
  detectedAt: new Date('2026-06-03T00:00:00.000Z'),
  blockCommandIssued: true,
});

const THREAT_3 = buildThreat({
  threatId: '33333333-3333-4333-8333-333333333333',
  sourceIp: '198.51.100.1',
  severity: Severity.HIGH,
  detectedAt: new Date('2026-06-02T00:00:00.000Z'),
});

describe('Threats (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const repo = new InMemoryThreatRepository([THREAT_1, THREAT_2, THREAT_3]);
    const health = {
      check: jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
        for (const indicator of indicators) {
          await indicator();
        }
        return { status: 'ok', info: {}, error: {}, details: {} };
      }),
    };
    const db = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [FakeDepsModule, ThreatsModule, HealthModule],
    })
      .overrideProvider(getRepositoryToken(Threat))
      .useValue(repo)
      .overrideProvider(HealthCheckService)
      .useValue(health)
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /threats returns seeded threats ordered by detectedAt desc', async () => {
    const res = await request(app.getHttpServer()).get('/threats').expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body.map((t: Threat) => t.threatId)).toEqual([
      THREAT_2.threatId,
      THREAT_3.threatId,
      THREAT_1.threatId,
    ]);
  });

  it('GET /threats?severity=CRITICAL filters correctly', async () => {
    const res = await request(app.getHttpServer())
      .get('/threats')
      .query({ severity: Severity.CRITICAL })
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].threatId).toBe(THREAT_2.threatId);
  });

  it('GET /threats?sourceIp=... filters correctly', async () => {
    const res = await request(app.getHttpServer())
      .get('/threats')
      .query({ sourceIp: '198.51.100.1' })
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((t: Threat) => t.threatId).sort()).toEqual(
      [THREAT_1.threatId, THREAT_3.threatId].sort(),
    );
  });

  it('GET /threats/:threatId returns the matching threat', async () => {
    const res = await request(app.getHttpServer())
      .get(`/threats/${THREAT_1.threatId}`)
      .expect(200);

    expect(res.body.threatId).toBe(THREAT_1.threatId);
    expect(res.body.sourceIp).toBe(THREAT_1.sourceIp);
  });

  it('GET /threats/:threatId returns null body with 200 when not found', async () => {
    const res = await request(app.getHttpServer())
      .get('/threats/99999999-9999-4999-8999-999999999999')
      .expect(200);

    expect(res.body).toEqual({});
    expect(res.text).toBe('');
  });

  it('GET /threats/not-a-uuid returns 400', async () => {
    await request(app.getHttpServer()).get('/threats/not-a-uuid').expect(400);
  });

  it('GET /health returns 200 with a healthy database indicator', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
  });
});
