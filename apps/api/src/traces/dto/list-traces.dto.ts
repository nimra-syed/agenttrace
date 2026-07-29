import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { ListTracesQuery } from '@agenttrace/shared-types';
import { TraceStatus } from '../../../generated/prisma/client.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class ListTracesDto implements ListTracesQuery {
  @IsOptional()
  @IsEnum(TraceStatus)
  status?: TraceStatus;

  @IsOptional()
  @IsString()
  agentName?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  // Query params arrive as strings; class-transformer's @Type coerces
  // this to a number before @IsInt validates it (the global
  // ValidationPipe has transform: true, so this actually runs).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

export { DEFAULT_LIMIT };
