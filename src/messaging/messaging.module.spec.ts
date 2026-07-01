import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { MessagingModule } from './messaging.module';
import { SQS_CLIENT, SNS_CLIENT } from './aws.tokens';
import { SnsPublisherService } from './sns-publisher.service';

const buildFakeConfigModule = (aws: Record<string, unknown>) => {
  @Global()
  @Module({
    providers: [
      { provide: ConfigService, useValue: { getOrThrow: () => aws } },
    ],
    exports: [ConfigService],
  })
  class FakeConfigModule {}
  return FakeConfigModule;
};

describe('MessagingModule', () => {
  const buildModule = async (aws: Record<string, unknown>) =>
    Test.createTestingModule({
      imports: [buildFakeConfigModule(aws), MessagingModule],
    }).compile();

  it('builds AWS clients without static credentials or endpoint override', async () => {
    const moduleRef = await buildModule({ region: 'us-east-1' });

    expect(moduleRef.get(SQS_CLIENT)).toBeInstanceOf(SQSClient);
    expect(moduleRef.get(SNS_CLIENT)).toBeInstanceOf(SNSClient);
    expect(moduleRef.get(SnsPublisherService)).toBeInstanceOf(
      SnsPublisherService,
    );
  });

  it('builds AWS clients with a LocalStack endpoint and static credentials', async () => {
    const moduleRef = await buildModule({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    });

    expect(moduleRef.get(SQS_CLIENT)).toBeInstanceOf(SQSClient);
    expect(moduleRef.get(SNS_CLIENT)).toBeInstanceOf(SNSClient);
  });
});
