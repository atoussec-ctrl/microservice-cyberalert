import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Threat } from './entities/threat.entity';
import { ThreatTriageService } from './threat-triage.service';
import { ThreatConsumerService } from './threat-consumer.service';
import { ThreatsController } from './threats.controller';
import { SeverityAnalyzer } from './domain/severity-analyzer';

@Module({
  imports: [TypeOrmModule.forFeature([Threat])],
  controllers: [ThreatsController],
  providers: [SeverityAnalyzer, ThreatTriageService, ThreatConsumerService],
  exports: [ThreatTriageService],
})
export class ThreatsModule {}
