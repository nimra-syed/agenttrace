import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ApiKeyGuard } from './api-key.guard';
import {
  CurrentApiKeyContext,
  type ApiKeyContext,
} from './current-api-key.decorator';

// Temporary development/diagnostic endpoint for M3, to prove the
// ApiKeyGuard works end to end before there is a real API-key-authenticated
// endpoint to test against. Not meant to be a permanent public surface.
// Revisit once M4's ingestion endpoint exists: either remove this, gate it
// behind a dev-only flag, or keep it deliberately as a supported "check my
// key" endpoint for SDK authors. See ADR-0007.
@Controller('api-keys')
export class ApiKeyAuthController {
  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('verify')
  verify(@CurrentApiKeyContext() context: ApiKeyContext) {
    return context;
  }
}
