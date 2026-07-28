import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  CurrentApiKeyContext,
  type ApiKeyContext,
} from '../api-keys/current-api-key.decorator';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { Public } from '../auth/public.decorator';
import { CreateTraceDto } from './dto/create-trace.dto';
import { TracesService } from './traces.service';

@Controller('traces')
export class TracesController {
  constructor(private readonly tracesService: TracesService) {}

  @Public()
  @UseGuards(ApiKeyGuard)
  @Post()
  create(
    @CurrentApiKeyContext() apiKeyContext: ApiKeyContext,
    @Body() dto: CreateTraceDto,
  ) {
    return this.tracesService.upsert(apiKeyContext.projectId, dto);
  }
}
