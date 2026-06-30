import { unwrapSnsMessage } from './sns-envelope';

describe('unwrapSnsMessage', () => {
  it('unwraps a standard SNS->SQS notification envelope', () => {
    const inner = { threatId: 'abc', sourceIp: '1.2.3.4' };
    const envelope = JSON.stringify({
      Type: 'Notification',
      MessageId: 'mid',
      TopicArn: 'arn:aws:sns:us-east-1:000:threat-detected',
      Message: JSON.stringify(inner),
    });

    expect(unwrapSnsMessage(envelope)).toEqual(inner);
  });

  it('returns the body as-is for raw message delivery', () => {
    const inner = { threatId: 'abc', sourceIp: '1.2.3.4' };
    expect(unwrapSnsMessage(JSON.stringify(inner))).toEqual(inner);
  });

  it('throws on non-JSON bodies', () => {
    expect(() => unwrapSnsMessage('not-json')).toThrow();
  });
});
