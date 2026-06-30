import {
  IsArray,
  IsEnum,
  IsIP,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ThreatCategory } from '../domain/threat-category.enum';
import { ThreatDetectedEvent } from '../domain/threat-detected.event';

/**
 * Runtime-validated representation of a `threat-detected` event. Validating at
 * the boundary guarantees that malformed messages fail fast and land in the
 * DLQ instead of corrupting the intelligence store.
 */
export class ThreatDetectedDto implements ThreatDetectedEvent {
  @IsUUID()
  threatId: string;

  @IsISO8601()
  detectedAt: string;

  @IsString()
  source: string;

  @IsIP()
  sourceIp: string;

  @IsEnum(ThreatCategory)
  category: ThreatCategory;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  cvssScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  indicators?: string[];

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}
