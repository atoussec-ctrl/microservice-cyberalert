import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThreatsController } from './threats.controller';
import { Threat } from './entities/threat.entity';
import { Severity } from './domain/severity.enum';
import { ThreatCategory } from './domain/threat-category.enum';

const buildThreat = (overrides: Partial<Threat> = {}): Threat =>
  ({
    id: 'id-1',
    threatId: '44444444-4444-4444-8444-444444444444',
    source: 'scanner-01',
    sourceIp: '203.0.113.10',
    category: ThreatCategory.MALWARE,
    signature: null,
    severity: Severity.HIGH,
    score: 70,
    cvssScore: 7,
    confidence: 0.8,
    indicators: [],
    scoreBreakdown: null,
    rawPayload: null,
    blockCommandIssued: false,
    detectedAt: new Date('2026-06-30T12:00:00.000Z'),
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
    ...overrides,
  }) as Threat;

describe('ThreatsController', () => {
  let controller: ThreatsController;
  let repo: jest.Mocked<Repository<Threat>>;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Threat>>;

    const moduleRef = await Test.createTestingModule({
      controllers: [ThreatsController],
      providers: [{ provide: getRepositoryToken(Threat), useValue: repo }],
    }).compile();

    controller = moduleRef.get(ThreatsController);
  });

  describe('list', () => {
    it('lists threats with no filters using the default limit', async () => {
      const threats = [buildThreat()];
      repo.find.mockResolvedValue(threats);

      const result = await controller.list({});

      expect(result).toBe(threats);
      expect(repo.find).toHaveBeenCalledWith({
        where: {},
        order: { detectedAt: 'DESC' },
        take: 50,
      });
    });

    it('filters by severity', async () => {
      repo.find.mockResolvedValue([]);

      await controller.list({ severity: Severity.CRITICAL });

      expect(repo.find).toHaveBeenCalledWith({
        where: { severity: Severity.CRITICAL },
        order: { detectedAt: 'DESC' },
        take: 50,
      });
    });

    it('filters by sourceIp', async () => {
      repo.find.mockResolvedValue([]);

      await controller.list({ sourceIp: '198.51.100.23' });

      expect(repo.find).toHaveBeenCalledWith({
        where: { sourceIp: '198.51.100.23' },
        order: { detectedAt: 'DESC' },
        take: 50,
      });
    });

    it('filters by severity and sourceIp together with a custom limit', async () => {
      repo.find.mockResolvedValue([]);

      await controller.list({
        severity: Severity.LOW,
        sourceIp: '10.0.0.1',
        limit: 5,
      });

      expect(repo.find).toHaveBeenCalledWith({
        where: { severity: Severity.LOW, sourceIp: '10.0.0.1' },
        order: { detectedAt: 'DESC' },
        take: 5,
      });
    });
  });

  describe('findOne', () => {
    it('returns the threat when found', async () => {
      const threat = buildThreat();
      repo.findOne.mockResolvedValue(threat);

      const result = await controller.findOne(threat.threatId);

      expect(result).toBe(threat);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { threatId: threat.threatId },
      });
    });

    it('returns null when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await controller.findOne(
        '55555555-5555-4555-8555-555555555555',
      );

      expect(result).toBeNull();
    });
  });
});
