import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness and database health',
    description:
      'Uses Terminus to ping PostgreSQL. Returns 503 when the database is unreachable.',
  })
  @ApiResponse({ status: 200, description: 'All checks passed' })
  @ApiResponse({ status: 503, description: 'One or more checks failed' })
  check() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
