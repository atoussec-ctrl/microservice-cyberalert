import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Threat } from './entities/threat.entity';
import { Severity } from './domain/severity.enum';

/**
 * Read-only API over the consolidated threat intelligence store. The write path
 * is fully event-driven (SQS worker), so this controller only exposes queries
 * useful for dashboards and audits.
 */
@Controller('threats')
export class ThreatsController {
  constructor(
    @InjectRepository(Threat)
    private readonly threats: Repository<Threat>,
  ) {}

  @Get()
  async list(
    @Query('severity') severity?: Severity,
    @Query('sourceIp') sourceIp?: string,
    @Query('limit') limit = '50',
  ): Promise<Threat[]> {
    const take = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return this.threats.find({
      where: {
        ...(severity ? { severity } : {}),
        ...(sourceIp ? { sourceIp } : {}),
      },
      order: { detectedAt: 'DESC' },
      take,
    });
  }

  @Get(':threatId')
  async findOne(
    @Param('threatId', new ParseUUIDPipe()) threatId: string,
  ): Promise<Threat | null> {
    return this.threats.findOne({ where: { threatId } });
  }
}
