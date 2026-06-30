import { Severity } from './severity.enum';

/**
 * Contract of the command emitted to the `block-ip-command` SNS topic whenever
 * a triaged threat reaches CRITICAL severity. A downstream firewall / EDR
 * service is expected to consume this and enforce the block.
 */
export interface BlockIpCommandEvent {
  /** Unique id of this command (idempotency key for the consumer). */
  commandId: string;
  /** ISO-8601 timestamp of when the command was issued. */
  issuedAt: string;
  /** The originating threat that justified the block. */
  threatId: string;
  /** IP address to block. */
  targetIp: string;
  /** Severity that triggered the command (always CRITICAL today). */
  severity: Severity;
  /** Normalized triage score, 0-100. */
  score: number;
  /** Human-readable justification, useful for audit trails. */
  reason: string;
  /** How long the block should remain in force, in seconds. */
  ttlSeconds: number;
}
