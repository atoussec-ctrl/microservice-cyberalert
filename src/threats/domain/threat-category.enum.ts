/**
 * High-level classification of a detected threat. Categories carry an intrinsic
 * weight used by the severity analyzer (see `severity-analyzer.ts`).
 */
export enum ThreatCategory {
  MALWARE = 'malware',
  INTRUSION = 'intrusion',
  EXFILTRATION = 'exfiltration',
  DDOS = 'ddos',
  RECON = 'recon',
  VULNERABILITY = 'vulnerability',
  POLICY_VIOLATION = 'policy_violation',
  UNKNOWN = 'unknown',
}

/**
 * Intrinsic danger weight per category, normalized to the 0..1 range.
 * Categories that imply active compromise (exfiltration, intrusion, malware)
 * weigh heavier than reconnaissance or policy noise.
 */
export const CATEGORY_WEIGHT: Record<ThreatCategory, number> = {
  [ThreatCategory.EXFILTRATION]: 1.0,
  [ThreatCategory.INTRUSION]: 0.95,
  [ThreatCategory.MALWARE]: 0.9,
  [ThreatCategory.DDOS]: 0.75,
  [ThreatCategory.VULNERABILITY]: 0.6,
  [ThreatCategory.RECON]: 0.4,
  [ThreatCategory.POLICY_VIOLATION]: 0.3,
  [ThreatCategory.UNKNOWN]: 0.5,
};
