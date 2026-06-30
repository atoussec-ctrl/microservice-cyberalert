import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
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
    @Query('severity', new ParseEnumPipe(Severity, { optional: true }))
    severity?: Severity,
    @Query('sourceIp') sourceIp?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<Threat[]> {
    const take = Math.min(Math.max(limit, 1), 200);
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
  ): Promise<Threat> {
    const threat = await this.threats.findOne({ where: { threatId } });
    if (!threat) {
      throw new NotFoundException(`Threat ${threatId} not found`);
    }
    return threat;
  }
}
