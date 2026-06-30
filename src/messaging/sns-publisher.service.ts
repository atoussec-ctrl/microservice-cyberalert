import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SNS_CLIENT } from './aws.tokens';

export interface PublishOptions {
  /** Message attributes forwarded to SNS (e.g. for subscription filtering). */
  attributes?: Record<string, string>;
}

@Injectable()
export class SnsPublisherService {
  private readonly logger = new Logger(SnsPublisherService.name);

  constructor(@Inject(SNS_CLIENT) private readonly sns: SNSClient) {}

  /**
   * Publishes a JSON-serializable payload to the given SNS topic and returns
   * the resulting SNS MessageId.
   */
  async publish<T>(
    topicArn: string,
    payload: T,
    options: PublishOptions = {},
  ): Promise<string | undefined> {
    if (!topicArn) {
      throw new Error('Cannot publish to SNS: topic ARN is not configured');
    }

    const messageAttributes = Object.fromEntries(
      Object.entries(options.attributes ?? {}).map(([key, value]) => [
        key,
        { DataType: 'String', StringValue: value },
      ]),
    );

    const result = await this.sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(payload),
        MessageAttributes: messageAttributes,
      }),
    );

    this.logger.debug(
      `Published message ${result.MessageId ?? '<unknown>'} to ${topicArn}`,
    );

    return result.MessageId;
  }
}
