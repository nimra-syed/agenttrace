import type { CliAuthorizePayload } from '@agenttrace/shared-types';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CliAuthorizeDto implements CliAuthorizePayload {
  @IsString()
  @MinLength(1)
  projectId!: string;

  @IsString()
  @MinLength(1)
  codeChallenge!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;
}
