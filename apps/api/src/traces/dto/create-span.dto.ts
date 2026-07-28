import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { SpanStatus, SpanType } from '../../../generated/prisma/client.js';

export class CreateSpanDto {
  // The client's stable identifier for this span, same reasoning as
  // externalTraceId. See ADR-0008.
  @IsOptional()
  @IsString()
  externalSpanId?: string;

  // Must reference an already-ingested span's server-assigned id, in the
  // same trace. Parent-first ingestion only for M4, see ADR-0008.
  @IsOptional()
  @IsString()
  parentSpanId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(SpanType)
  type!: SpanType;

  @IsOptional()
  @IsEnum(SpanStatus)
  status?: SpanStatus;

  @IsOptional()
  input?: unknown;

  @IsOptional()
  output?: unknown;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  promptTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  completionTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costUsd?: number;

  @IsOptional()
  @IsString()
  error?: string;

  @IsISO8601()
  startedAt!: string;

  @IsOptional()
  @IsISO8601()
  endedAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  metadata?: unknown;
}
