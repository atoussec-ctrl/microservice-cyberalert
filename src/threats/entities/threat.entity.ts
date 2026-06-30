import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Severity } from '../domain/severity.enum';
import { ThreatCategory } from '../domain/threat-category.enum';

/**
 * Consolidated, persisted record of a triaged threat. `threatId` carries a
 * unique constraint so that at-least-once SQS redeliveries are idempotent.
 */
@Entity({ name: 'threats' })
@Index(['sourceIp'])
@Index(['severity'])
export class Threat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  @Index()
  threatId: string;

  @Column({ type: 'varchar', length: 255 })
  source: string;

  @Column({ type: 'varchar', length: 45 })
  sourceIp: string;

  @Column({
    type: 'enum',
    enum: ThreatCategory,
    default: ThreatCategory.UNKNOWN,
  })
  category: ThreatCategory;

  @Column({ type: 'varchar', length: 255, nullable: true })
  signature: string | null;

  @Column({ type: 'enum', enum: Severity })
  severity: Severity;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'real', nullable: true })
  cvssScore: number | null;

  @Column({ type: 'real', nullable: true })
  confidence: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  indicators: string[];

  @Column({ type: 'jsonb', nullable: true })
  scoreBreakdown: Record<string, number> | null;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  blockCommandIssued: boolean;

  @Column({ type: 'timestamptz' })
  detectedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
