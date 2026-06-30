import { ThreatCategory } from './threat-category.enum';

/**
 * Contract of a message published to the `threat-detected` SNS topic by a
 * network scanner or a C2 (Command & Control) node. This is the shape the
 * worker expects to find inside each SQS message body.
 */
export interface ThreatDetectedEvent {
  /** Stable identifier of the detection, used for idempotency. */
  threatId: string;
  /** ISO-8601 timestamp of when the anomaly was observed. */
  detectedAt: string;
  /** Identifier of the emitting sensor / scanner / C2 node. */
  source: string;
  /** Offending IP address (the candidate to be blocked). */
  sourceIp: string;
  /** Coarse classification of the threat. */
  category: ThreatCategory;
  /** Optional rule / IDS signature that fired. */
  signature?: string;
  /** CVSS base score (0-10), when the detection maps to a known CVE. */
  cvssScore?: number;
  /** Detector confidence in the range 0..1. */
  confidence?: number;
  /** Indicators of Compromise (hashes, domains, URLs, ...). */
  indicators?: string[];
  /** Free-form sensor payload kept for audit purposes. */
  rawPayload?: Record<string, unknown>;
}
