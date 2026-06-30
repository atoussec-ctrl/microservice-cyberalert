import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { ThreatConsumerService } from './threat-consumer.service';
import { MessagingConfig } from '../config/configuration';
import { ThreatCategory } from './domain/threat-category.enum';

const QUEUE_URL =
  'https://sqs.us-east-1.amazonaws.com/000/threat-analysis-queue';

const messagingConfig: MessagingConfig = {
  threatAnalysisQueueUrl: QUEUE_URL,
  blockIpCommandTopicArn: 'arn:aws:sns:us-east-1:000:block-ip-command',
  waitTimeSeconds: 0,
  maxMessages: 10,
  visibilityTimeoutSeconds: 60,
  pollingEnabled: false,
};

const validBody = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    Type: 'Notification',
    Message: JSON.stringify({
      threatId: '33333333-3333-4333-8333-333333333333',
      detectedAt: '2026-06-30T12:00:00.000Z',
      source: 'scanner-01',
      sourceIp: '203.0.113.55',
      category: ThreatCategory.MALWARE,
      cvssScore: 8,
      confidence: 0.9,
      ...overrides,
    }),
  });

describe('ThreatConsumerService', () => {
  let sqs: { send: jest.Mock };
  let triage: { triage: jest.Mock };
  let consumer: ThreatConsumerService;

  const build = () => {
    const configService = {
      getOrThrow: () => messagingConfig,
    } as never;
    return new ThreatConsumerService(
      sqs as never,
      triage as never,
      configService,
    );
  };

  beforeEach(() => {
    sqs = { send: jest.fn() };
    triage = { triage: jest.fn().mockResolvedValue(undefined) };
    consumer = build();
  });

  it('triages a valid message and deletes it from the queue', async () => {
    sqs.send
      .mockResolvedValueOnce({
        Messages: [
          { MessageId: 'm1', ReceiptHandle: 'rh1', Body: validBody() },
        ],
      })
      .mockResolvedValueOnce({}); // delete

    const processed = await consumer.pollOnce();

    expect(processed).toBe(1);
    expect(triage.triage).toHaveBeenCalledTimes(1);

    const commands = sqs.send.mock.calls.map((c) => c[0]);
    expect(commands[0]).toBeInstanceOf(ReceiveMessageCommand);
    expect(commands[1]).toBeInstanceOf(DeleteMessageCommand);
  });

  it('does NOT delete (routes to DLQ) when the payload is invalid', async () => {
    const badBody = validBody({ sourceIp: 'not-an-ip', threatId: 'nope' });
    sqs.send.mockResolvedValueOnce({
      Messages: [{ MessageId: 'm2', ReceiptHandle: 'rh2', Body: badBody }],
    });

    const ok = await consumer.handleMessage({
      MessageId: 'm2',
      ReceiptHandle: 'rh2',
      Body: badBody,
    });

    expect(ok).toBe(false);
    expect(triage.triage).not.toHaveBeenCalled();
    // Only the receive call happened (in pollOnce); no delete here.
    expect(
      sqs.send.mock.calls.some(([cmd]) => cmd instanceof DeleteMessageCommand),
    ).toBe(false);
  });

  it('does NOT delete when triage throws (leaves message for retry/DLQ)', async () => {
    triage.triage.mockRejectedValueOnce(new Error('db down'));

    const ok = await consumer.handleMessage({
      MessageId: 'm3',
      ReceiptHandle: 'rh3',
      Body: validBody(),
    });

    expect(ok).toBe(false);
    expect(
      sqs.send.mock.calls.some(([cmd]) => cmd instanceof DeleteMessageCommand),
    ).toBe(false);
  });

  it('returns 0 when the queue is empty', async () => {
    sqs.send.mockResolvedValueOnce({});
    expect(await consumer.pollOnce()).toBe(0);
    expect(triage.triage).not.toHaveBeenCalled();
  });

  it('ignores messages with an empty body', async () => {
    const ok = await consumer.handleMessage({
      MessageId: 'm4',
      ReceiptHandle: 'rh4',
    });
    expect(ok).toBe(false);
  });
});
