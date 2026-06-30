import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Threat } from './entities/threat.entity';
import { SeverityAnalyzer, TriageVerdict } from './domain/severity-analyzer';
import { Severity, isAtLeast } from './domain/severity.enum';
import { ThreatDetectedEvent } from './domain/threat-detected.event';
import { BlockIpCommandEvent } from './domain/block-ip-command.event';
import { MessagingConfig } from '../config/configuration';
import { SnsPublisherService } from '../messaging/sns-publisher.service';

export interface TriageResult {
  threat: Threat;
  verdict: TriageVerdict;
  blockCommandIssued: boolean;
  /** True when the event had already been triaged (idempotent replay). */
  deduplicated: boolean;
}

/** Severity at or above which an automated block command is emitted. */
const BLOCK_THRESHOLD = Severity.CRITICAL;
/** Default lifetime of an IP block, in seconds (24h). */
const DEFAULT_BLOCK_TTL_SECONDS = 86_400;

@Injectable()
export class ThreatTriageService {
  private readonly logger = new Logger(ThreatTriageService.name);

  constructor(
    @InjectRepository(Threat)
    private readonly threats: Repository<Threat>,
    private readonly analyzer: SeverityAnalyzer,
    private readonly publisher: SnsPublisherService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Triages a single detected threat: scores it, persists the consolidated
   * record (idempotently on `threatId`), and emits a `block-ip-command` when
   * the verdict is CRITICAL.
   */
  async triage(event: ThreatDetectedEvent): Promise<TriageResult> {
    const existing = await this.threats.findOne({
      where: { threatId: event.threatId },
    });

    if (existing) {
      this.logger.debug(
        `Threat ${event.threatId} already triaged; skipping (idempotent).`,
      );
      return {
        threat: existing,
        verdict: {
          score: existing.score,
          severity: existing.severity,
          breakdown:
            (existing.scoreBreakdown as TriageVerdict['breakdown']) ?? {
              cvss: 0,
              category: 0,
              confidence: 0,
              indicatorBoost: 0,
            },
        },
        blockCommandIssued: existing.blockCommandIssued,
        deduplicated: true,
      };
    }

    const verdict = this.analyzer.analyze(event);
    const shouldBlock = isAtLeast(verdict.severity, BLOCK_THRESHOLD);

    let threat = this.threats.create({
      threatId: event.threatId,
      source: event.source,
      sourceIp: event.sourceIp,
      category: event.category,
      signature: event.signature ?? null,
      severity: verdict.severity,
      score: verdict.score,
      cvssScore: event.cvssScore ?? null,
      confidence: event.confidence ?? null,
      indicators: event.indicators ?? [],
      scoreBreakdown: verdict.breakdown,
      rawPayload: event.rawPayload ?? null,
      blockCommandIssued: false,
      detectedAt: new Date(event.detectedAt),
    });

    try {
      threat = await this.threats.save(threat);
    } catch (error) {
      // Lost a race against a concurrent delivery of the same threatId; the
      // unique constraint protected us — treat it as an idempotent replay.
      const duplicate = await this.handleDuplicate(error, event.threatId);
      if (duplicate) {
        return duplicate;
      }
      throw error;
    }

    this.logger.log(
      `Triaged threat ${event.threatId} from ${event.sourceIp}: ` +
        `${verdict.severity} (score=${verdict.score})`,
    );

    let blockCommandIssued = false;
    if (shouldBlock) {
      await this.emitBlockCommand(threat, verdict);
      threat.blockCommandIssued = true;
      threat = await this.threats.save(threat);
      blockCommandIssued = true;
    }

    return { threat, verdict, blockCommandIssued, deduplicated: false };
  }

  /**
   * If a save failed because of the `threatId` unique constraint, re-reads the
   * winning record and returns it as a deduplicated result. Returns null for
   * any other failure so the caller can rethrow.
   */
  private async handleDuplicate(
    error: unknown,
    threatId: string,
  ): Promise<TriageResult | null> {
    const isUniqueViolation =
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code === '23505';
    if (!isUniqueViolation) {
      return null;
    }

    const winner = await this.threats.findOne({ where: { threatId } });
    if (!winner) {
      return null;
    }

    this.logger.debug(
      `Concurrent duplicate for threat ${threatId} resolved idempotently.`,
    );
    return {
      threat: winner,
      verdict: {
        score: winner.score,
        severity: winner.severity,
        breakdown: (winner.scoreBreakdown as TriageVerdict['breakdown']) ?? {
          cvss: 0,
          category: 0,
          confidence: 0,
          indicatorBoost: 0,
        },
      },
      blockCommandIssued: winner.blockCommandIssued,
      deduplicated: true,
    };
  }

  private async emitBlockCommand(
    threat: Threat,
    verdict: TriageVerdict,
  ): Promise<void> {
    const { blockIpCommandTopicArn } =
      this.config.getOrThrow<MessagingConfig>('messaging');

    const command: BlockIpCommandEvent = {
      commandId: randomUUID(),
      issuedAt: new Date().toISOString(),
      threatId: threat.threatId,
      targetIp: threat.sourceIp,
      severity: verdict.severity,
      score: verdict.score,
      reason: `Automated block: ${threat.category} threat scored ${verdict.score}/100 (${verdict.severity})`,
      ttlSeconds: DEFAULT_BLOCK_TTL_SECONDS,
    };

    await this.publisher.publish(blockIpCommandTopicArn, command, {
      attributes: { severity: verdict.severity, category: threat.category },
    });

    this.logger.warn(
      `Issued block-ip-command ${command.commandId} for ${threat.sourceIp} ` +
        `(threat ${threat.threatId})`,
    );
  }
}
