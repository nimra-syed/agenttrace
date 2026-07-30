import type { CreateApiKeyPayload } from '@agenttrace/shared-types';
import { IsString, MinLength } from 'class-validator';

// `implements CreateApiKeyPayload` is a compile-time shape check only,
// same reasoning as every other DTO in this project (e.g. CreateTraceDto).
export class CreateApiKeyDto implements CreateApiKeyPayload {
  @IsString()
  @MinLength(1)
  name!: string;
}
