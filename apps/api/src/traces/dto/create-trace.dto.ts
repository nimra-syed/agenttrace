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
import { TraceStatus } from '../../../generated/prisma/client.js';

export class CreateTraceDto {
  // The client's stable identifier for this trace, reused across calls as
  // the trace progresses (e.g. reported RUNNING, then reported again as
  // SUCCESS once it finishes). Not just a retry-safety key, see
  // ADR-0008 for why this is named externalTraceId, not idempotencyKey.
  @IsOptional()
  @IsString()
  externalTraceId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  agentName!: string;

  @IsOptional()
  @IsEnum(TraceStatus)
  status?: TraceStatus;

  @IsOptional()
  input?: unknown;

  @IsOptional()
  output?: unknown;

  @IsOptional()
  @IsString()
  error?: string;

  // Required on every call, including updates to an existing trace, since
  // it does not change over a trace's lifecycle and this avoids needing to
  // merge it with a previously stored value.
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
  @IsInt()
  @Min(0)
  totalTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalCostUsd?: number;

  @IsOptional()
  metadata?: unknown;
}
