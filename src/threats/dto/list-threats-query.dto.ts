import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Severity } from '../domain/severity.enum';

export class ListThreatsQueryDto {
  @ApiPropertyOptional({
    enum: Severity,
    description: 'Filter by triage severity bucket',
  })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({
    example: '198.51.100.23',
    description: 'Filter by attacker source IP',
  })
  @IsOptional()
  @IsString()
  sourceIp?: string;

  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 200,
    default: 50,
    description: 'Maximum number of records to return',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
