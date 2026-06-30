import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { SQS_CLIENT } from '../messaging/aws.tokens';
import { unwrapSnsMessage } from '../messaging/sns-envelope';
import { ThreatDetectedDto } from './dto/threat-detected.dto';
import { ThreatTriageService } from './threat-triage.service';
import { MessagingConfig } from '../config/configuration';

/**
 * Long-polling SQS worker for the `threat-analysis-queue`. Each message is
 * unwrapped, validated and triaged; only successfully processed messages are
 * deleted. Anything that throws is left on the queue so that, after the
 * configured `maxReceiveCount`, SQS redrives it to the Dead Letter Queue —
 * guaranteeing no silent data loss.
 */
@Injectable()
export class ThreatConsumerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ThreatConsumerService.name);
  private readonly config: MessagingConfig;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly triage: ThreatTriageService,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<MessagingConfig>('messaging');
  }

  onApplicationBootstrap(): void {
    if (!this.config.pollingEnabled) {
      this.logger.warn('SQS polling disabled (SQS_POLLING_ENABLED=false).');
      return;
    }
    if (!this.config.threatAnalysisQueueUrl) {
      this.logger.error(
        'THREAT_ANALYSIS_QUEUE_URL is not set; consumer will not start.',
      );
      return;
    }
    this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.logger.log(
      `Starting SQS consumer on ${this.config.threatAnalysisQueueUrl}`,
    );
    this.loopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.logger.log('Stopping SQS consumer...');
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger.error(`Polling cycle failed: ${this.describeError(error)}`);
        // Back off briefly so a persistent failure does not hot-loop.
        await this.delay(1000);
      }
    }
  }

  /** Performs a single receive→process→delete cycle. Returns processed count. */
  async pollOnce(): Promise<number> {
    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.config.threatAnalysisQueueUrl,
        MaxNumberOfMessages: this.config.maxMessages,
        WaitTimeSeconds: this.config.waitTimeSeconds,
        VisibilityTimeout: this.config.visibilityTimeoutSeconds,
        MessageAttributeNames: ['All'],
      }),
    );

    const messages = response.Messages ?? [];
    let processed = 0;
    for (const message of messages) {
      const ok = await this.handleMessage(message);
      if (ok) {
        processed += 1;
      }
    }
    return processed;
  }

  /**
   * Processes one message. Returns true when the message was handled and
   * deleted; returns false (without deleting) when it must be retried/DLQ'd.
   */
  async handleMessage(message: Message): Promise<boolean> {
    if (!message.Body) {
      this.logger.warn(
        `Received message ${message.MessageId ?? '?'} with empty body.`,
      );
      return false;
    }

    let dto: ThreatDetectedDto;
    try {
      const payload = unwrapSnsMessage(message.Body);
      dto = plainToInstance(ThreatDetectedDto, payload);
      await validateOrReject(dto, {
        whitelist: true,
        forbidUnknownValues: true,
      });
    } catch (error) {
      // Poison message: keep it on the queue so it lands in the DLQ for audit
      // instead of being silently dropped.
      this.logger.error(
        `Discarding invalid message ${message.MessageId ?? '?'} to DLQ: ` +
          this.describeError(error),
      );
      return false;
    }

    try {
      await this.triage.triage(dto);
    } catch (error) {
      this.logger.error(
        `Failed to triage threat ${dto.threatId}; leaving on queue for retry: ` +
          this.describeError(error),
      );
      return false;
    }

    await this.deleteMessage(message);
    return true;
  }

  private async deleteMessage(message: Message): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.threatAnalysisQueueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  private describeError(error: unknown): string {
    if (Array.isArray(error)) {
      return error.map((e) => this.describeError(e)).join('; ');
    }
    if (error instanceof Error) {
      return error.message;
    }
    return JSON.stringify(error);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
