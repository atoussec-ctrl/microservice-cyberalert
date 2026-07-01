import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Severity } from '../domain/severity.enum';
import { ThreatCategory } from '../domain/threat-category.enum';

export class ThreatResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Internal persistence id' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Business threat id from the incoming event' })
  threatId!: string;

  @ApiProperty({ example: 'scanner-01' })
  source!: string;

  @ApiProperty({ example: '198.51.100.23' })
  sourceIp!: string;

  @ApiProperty({ enum: ThreatCategory, example: ThreatCategory.EXFILTRATION })
  category!: ThreatCategory;

  @ApiPropertyOptional({ example: 'ET TROJAN Observed Malicious SSL Cert' })
  signature!: string | null;

  @ApiProperty({ enum: Severity, example: Severity.CRITICAL })
  severity!: Severity;

  @ApiProperty({ example: 100, description: 'Weighted triage score (0–100)' })
  score!: number;

  @ApiPropertyOptional({ example: 9.8 })
  cvssScore!: number | null;

  @ApiPropertyOptional({ example: 0.97 })
  confidence!: number | null;

  @ApiProperty({ type: [String], example: ['sha256:deadbeef'] })
  indicators!: string[];

  @ApiPropertyOptional({
    example: { cvss: 49, category: 30, confidence: 19, indicatorBoost: 5 },
  })
  scoreBreakdown!: Record<string, number> | null;

  @ApiProperty({ example: true, description: 'Whether a block-ip-command was emitted' })
  blockCommandIssued!: boolean;

  @ApiProperty({ format: 'date-time' })
  detectedAt!: Date;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
