import type { CliTokenExchangePayload } from '@agenttraceai/shared-types';
import { IsString, MinLength } from 'class-validator';

export class CliTokenExchangeDto implements CliTokenExchangePayload {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  codeVerifier!: string;
}
