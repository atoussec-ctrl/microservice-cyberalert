import { SeverityAnalyzer, scoreToSeverity } from './severity-analyzer';
import { Severity } from './severity.enum';
import { ThreatCategory } from './threat-category.enum';
import { ThreatDetectedEvent } from './threat-detected.event';

const baseEvent = (
  overrides: Partial<ThreatDetectedEvent> = {},
): ThreatDetectedEvent => ({
  threatId: '11111111-1111-1111-1111-111111111111',
  detectedAt: '2026-06-30T12:00:00.000Z',
  source: 'scanner-01',
  sourceIp: '203.0.113.10',
  category: ThreatCategory.UNKNOWN,
  ...overrides,
});

describe('SeverityAnalyzer', () => {
  let analyzer: SeverityAnalyzer;

  beforeEach(() => {
    analyzer = new SeverityAnalyzer();
  });

  it('scores a benign low-confidence recon event as LOW', () => {
    const verdict = analyzer.analyze(
      baseEvent({
        category: ThreatCategory.RECON,
        cvssScore: 1,
        confidence: 0.1,
      }),
    );

    expect(verdict.severity).toBe(Severity.LOW);
    expect(verdict.score).toBeLessThan(35);
  });

  it('escalates a high-CVSS, high-confidence exfiltration to CRITICAL', () => {
    const verdict = analyzer.analyze(
      baseEvent({
        category: ThreatCategory.EXFILTRATION,
        cvssScore: 9.8,
        confidence: 0.99,
        indicators: ['hash-a', 'domain-b', 'url-c', 'ip-d', 'extra-e'],
      }),
    );

    expect(verdict.severity).toBe(Severity.CRITICAL);
    expect(verdict.score).toBeGreaterThanOrEqual(85);
  });

  it('treats missing optional fields as zero contributions', () => {
    const verdict = analyzer.analyze(
      baseEvent({ category: ThreatCategory.POLICY_VIOLATION }),
    );

    expect(verdict.breakdown.cvss).toBe(0);
    expect(verdict.breakdown.confidence).toBe(0);
    expect(verdict.breakdown.indicatorBoost).toBe(0);
    expect(verdict.score).toBeGreaterThan(0); // category still contributes
  });

  it('caps the indicator boost regardless of indicator count', () => {
    const few = analyzer.analyze(
      baseEvent({ category: ThreatCategory.MALWARE, indicators: ['a', 'b'] }),
    );
    const many = analyzer.analyze(
      baseEvent({
        category: ThreatCategory.MALWARE,
        indicators: Array.from({ length: 50 }, (_, i) => `ioc-${i}`),
      }),
    );

    expect(many.breakdown.indicatorBoost).toBeLessThanOrEqual(20);
    expect(many.score).toBeGreaterThanOrEqual(few.score);
  });

  it('clamps out-of-range CVSS scores into 0..100', () => {
    const verdict = analyzer.analyze(
      baseEvent({ category: ThreatCategory.INTRUSION, cvssScore: 99 }),
    );
    expect(verdict.score).toBeLessThanOrEqual(100);
    expect(verdict.breakdown.cvss).toBeLessThanOrEqual(50);
  });

  it('produces deterministic, reproducible verdicts', () => {
    const event = baseEvent({
      category: ThreatCategory.DDOS,
      cvssScore: 7.5,
      confidence: 0.8,
      indicators: ['x'],
    });
    expect(analyzer.analyze(event)).toEqual(analyzer.analyze(event));
  });
});

describe('scoreToSeverity', () => {
  it.each([
    [0, Severity.LOW],
    [34, Severity.LOW],
    [35, Severity.MEDIUM],
    [59, Severity.MEDIUM],
    [60, Severity.HIGH],
    [84, Severity.HIGH],
    [85, Severity.CRITICAL],
    [100, Severity.CRITICAL],
  ])('maps score %i to %s', (score, expected) => {
    expect(scoreToSeverity(score)).toBe(expected);
  });

  it('falls back to LOW when the score cannot be matched to a bucket', () => {
    expect(scoreToSeverity(Number.NaN)).toBe(Severity.LOW);
  });
});
