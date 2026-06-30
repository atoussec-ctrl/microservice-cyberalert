import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThreatTriageService } from './threat-triage.service';
import { SeverityAnalyzer } from './domain/severity-analyzer';
import { Threat } from './entities/threat.entity';
import { Severity } from './domain/severity.enum';
import { ThreatDetectedEvent } from './domain/threat-detected.event';
import { SnsPublisherService } from '../messaging/sns-publisher.service';
import { ThreatCategory as Category } from './domain/threat-category.enum';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000:block-ip-command';

const criticalEvent = (
  overrides: Partial<ThreatDetectedEvent> = {},
): ThreatDetectedEvent => ({
  threatId: '22222222-2222-2222-2222-222222222222',
  detectedAt: '2026-06-30T12:00:00.000Z',
  source: 'c2-node-7',
  sourceIp: '198.51.100.23',
  category: Category.EXFILTRATION,
  cvssScore: 9.9,
  confidence: 1,
  indicators: ['ioc-1', 'ioc-2', 'ioc-3'],
  ...overrides,
});

describe('ThreatTriageService', () => {
  let service: ThreatTriageService;
  let repo: jest.Mocked<Repository<Threat>>;
  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as Threat),
      save: jest.fn(async (entity) => entity as Threat),
    } as unknown as jest.Mocked<Repository<Threat>>;

    publisher = { publish: jest.fn().mockResolvedValue('msg-id') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ThreatTriageService,
        SeverityAnalyzer,
        { provide: getRepositoryToken(Threat), useValue: repo },
        { provide: SnsPublisherService, useValue: publisher },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => ({ blockIpCommandTopicArn: TOPIC_ARN }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ThreatTriageService);
  });

  it('persists a triaged threat and emits a block command for CRITICAL', async () => {
    repo.findOne.mockResolvedValue(null);

    const result = await service.triage(criticalEvent());

    expect(result.deduplicated).toBe(false);
    expect(result.verdict.severity).toBe(Severity.CRITICAL);
    expect(result.blockCommandIssued).toBe(true);
    expect(repo.save).toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    const [topicArn, command] = publisher.publish.mock.calls[0];
    expect(topicArn).toBe(TOPIC_ARN);
    expect(command).toMatchObject({
      targetIp: '198.51.100.23',
      severity: Severity.CRITICAL,
      threatId: '22222222-2222-2222-2222-222222222222',
    });
    expect(command.commandId).toEqual(expect.any(String));
    expect(result.threat.blockCommandIssued).toBe(true);
  });

  it('does NOT emit a block command for non-critical threats', async () => {
    repo.findOne.mockResolvedValue(null);

    const result = await service.triage(
      criticalEvent({
        category: Category.RECON,
        cvssScore: 2,
        confidence: 0.2,
        indicators: [],
      }),
    );

    expect(result.verdict.severity).not.toBe(Severity.CRITICAL);
    expect(result.blockCommandIssued).toBe(false);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('is idempotent: a previously triaged threatId is not re-processed', async () => {
    const existing: Partial<Threat> = {
      threatId: '22222222-2222-2222-2222-222222222222',
      severity: Severity.CRITICAL,
      score: 95,
      blockCommandIssued: true,
      scoreBreakdown: {
        cvss: 50,
        category: 30,
        confidence: 20,
        indicatorBoost: 15,
      },
    };
    repo.findOne.mockResolvedValue(existing as Threat);

    const result = await service.triage(criticalEvent());

    expect(result.deduplicated).toBe(true);
    expect(repo.save).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("propagates persistence errors so the message can be retried/DLQ'd", async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockRejectedValueOnce(new Error('db down'));

    await expect(service.triage(criticalEvent())).rejects.toThrow('db down');
  });
});
