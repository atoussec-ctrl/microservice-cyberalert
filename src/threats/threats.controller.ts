import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Threat } from './entities/threat.entity';
import { ListThreatsQueryDto } from './dto/list-threats-query.dto';
import { ThreatResponseDto } from './dto/threat-response.dto';

@ApiTags('Threats')
@Controller('threats')
export class ThreatsController {
  constructor(
    @InjectRepository(Threat)
    private readonly threats: Repository<Threat>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List triaged threats',
    description:
      'Returns consolidated threat intelligence ordered by `detectedAt` descending. The write path is fully event-driven (SQS worker).',
  })
  @ApiOkResponse({ type: ThreatResponseDto, isArray: true })
  async list(@Query() query: ListThreatsQueryDto): Promise<Threat[]> {
    const take = query.limit ?? 50;
    return this.threats.find({
      where: {
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.sourceIp ? { sourceIp: query.sourceIp } : {}),
      },
      order: { detectedAt: 'DESC' },
      take,
    });
  }

  @Get(':threatId')
  @ApiOperation({ summary: 'Get a threat by business id' })
  @ApiParam({ name: 'threatId', format: 'uuid', description: 'Threat id from the original event' })
  @ApiOkResponse({ type: ThreatResponseDto })
  @ApiNotFoundResponse({ description: 'Threat not found (returns null body with 200)' })
  async findOne(
    @Param('threatId', new ParseUUIDPipe()) threatId: string,
  ): Promise<Threat | null> {
    return this.threats.findOne({ where: { threatId } });
  }
}
