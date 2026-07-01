import { PublishCommand } from '@aws-sdk/client-sns';
import { SnsPublisherService } from './sns-publisher.service';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000:block-ip-command';

describe('SnsPublisherService', () => {
  let sns: { send: jest.Mock };
  let service: SnsPublisherService;

  beforeEach(() => {
    sns = { send: jest.fn() };
    service = new SnsPublisherService(sns as never);
  });

  it('publishes a JSON payload and returns the MessageId', async () => {
    sns.send.mockResolvedValue({ MessageId: 'msg-1' });

    const messageId = await service.publish(
      TOPIC_ARN,
      { foo: 'bar' },
      { attributes: { severity: 'CRITICAL' } },
    );

    expect(messageId).toBe('msg-1');
    const [command] = sns.send.mock.calls[0];
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command.input).toMatchObject({
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify({ foo: 'bar' }),
      MessageAttributes: {
        severity: { DataType: 'String', StringValue: 'CRITICAL' },
      },
    });
  });

  it('publishes without attributes when none are provided', async () => {
    sns.send.mockResolvedValue({});

    const messageId = await service.publish(TOPIC_ARN, { foo: 'bar' });

    expect(messageId).toBeUndefined();
    const [command] = sns.send.mock.calls[0];
    expect(command.input.MessageAttributes).toEqual({});
  });

  it('throws when the topic ARN is not configured', async () => {
    await expect(service.publish('', { foo: 'bar' })).rejects.toThrow(
      'Cannot publish to SNS: topic ARN is not configured',
    );
    expect(sns.send).not.toHaveBeenCalled();
  });

  it('propagates errors from the SNS client', async () => {
    sns.send.mockRejectedValue(new Error('network down'));

    await expect(service.publish(TOPIC_ARN, {})).rejects.toThrow(
      'network down',
    );
  });
});
