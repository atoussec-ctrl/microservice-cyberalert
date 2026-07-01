import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThreatsModule } from './threats.module';
import { ThreatsController } from './threats.controller';
import { ThreatTriageService } from './threat-triage.service';
import { Threat } from './entities/threat.entity';
import { SnsPublisherService } from '../messaging/sns-publisher.service';
import { SQS_CLIENT } from '../messaging/aws.tokens';

const messagingConfig = {
  threatAnalysisQueueUrl: '',
  blockIpCommandTopicArn: 'arn:aws:sns:us-east-1:000:block-ip-command',
  waitTimeSeconds: 20,
  maxMessages: 10,
  visibilityTimeoutSeconds: 60,
  pollingEnabled: false,
};

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: { getOrThrow: () => messagingConfig } },
    { provide: SnsPublisherService, useValue: { publish: jest.fn() } },
    { provide: SQS_CLIENT, useValue: { send: jest.fn() } },
  ],
  exports: [ConfigService, SnsPublisherService, SQS_CLIENT],
})
class FakeDepsModule {}

describe('ThreatsModule', () => {
  it('compiles and resolves its controller and providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDepsModule, ThreatsModule],
    })
      .overrideProvider(getRepositoryToken(Threat))
      .useValue({
        find: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      })
      .compile();

    expect(moduleRef.get(ThreatsController)).toBeInstanceOf(ThreatsController);
    expect(moduleRef.get(ThreatTriageService)).toBeInstanceOf(
      ThreatTriageService,
    );
  });
});
