import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { SNS_CLIENT, SQS_CLIENT } from './aws.tokens';
import { SnsPublisherService } from './sns-publisher.service';
import { AwsConfig } from '../config/configuration';

const buildClientConfig = (aws: AwsConfig) => {
  const credentials =
    aws.accessKeyId && aws.secretAccessKey
      ? {
          accessKeyId: aws.accessKeyId,
          secretAccessKey: aws.secretAccessKey,
        }
      : undefined;

  return {
    region: aws.region,
    ...(aws.endpoint ? { endpoint: aws.endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  };
};

@Global()
@Module({
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SQSClient(buildClientConfig(config.getOrThrow<AwsConfig>('aws'))),
    },
    {
      provide: SNS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SNSClient(buildClientConfig(config.getOrThrow<AwsConfig>('aws'))),
    },
    SnsPublisherService,
  ],
  exports: [SQS_CLIENT, SNS_CLIENT, SnsPublisherService],
})
export class MessagingModule {}
