/**
 * Triage severity buckets, ordered from least to most urgent.
 * CRITICAL threats trigger an automated `block-ip-command`.
 */
export enum Severity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  [Severity.LOW]: 0,
  [Severity.MEDIUM]: 1,
  [Severity.HIGH]: 2,
  [Severity.CRITICAL]: 3,
};

export const isAtLeast = (value: Severity, threshold: Severity): boolean =>
  SEVERITY_ORDER[value] >= SEVERITY_ORDER[threshold];
