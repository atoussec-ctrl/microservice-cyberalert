/**
 * When an SNS topic fans out to an SQS queue *without* raw message delivery,
 * the original payload is wrapped in a JSON envelope. This helper transparently
 * unwraps that envelope, while also supporting raw delivery (where the SQS body
 * already is the original payload).
 */

interface SnsEnvelope {
  Type?: string;
  Message?: string;
  TopicArn?: string;
  MessageId?: string;
}

const looksLikeSnsEnvelope = (value: unknown): value is SnsEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as SnsEnvelope).Type === 'Notification' &&
  typeof (value as SnsEnvelope).Message === 'string';

/**
 * Parses an SQS message body into the inner application payload object.
 *
 * @throws SyntaxError when the body (or the unwrapped message) is not valid JSON.
 */
export const unwrapSnsMessage = (body: string): unknown => {
  const parsed: unknown = JSON.parse(body);

  if (looksLikeSnsEnvelope(parsed)) {
    return JSON.parse(parsed.Message as string);
  }

  return parsed;
};
