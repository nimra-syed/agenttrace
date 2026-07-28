import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentApiKeyContext,
  type ApiKeyContext,
} from '../api-keys/current-api-key.decorator';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { Public } from '../auth/public.decorator';
import { CreateSpanDto } from './dto/create-span.dto';
import { SpansService } from './spans.service';

@Controller('traces/:traceId/spans')
export class SpansController {
  constructor(private readonly spansService: SpansService) {}

  @Public()
  @UseGuards(ApiKeyGuard)
  @Post()
  create(
    @CurrentApiKeyContext() apiKeyContext: ApiKeyContext,
    @Param('traceId') traceId: string,
    @Body() dto: CreateSpanDto,
  ) {
    return this.spansService.upsert(apiKeyContext.projectId, traceId, dto);
  }
}
