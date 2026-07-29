import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/current-user.decorator';
import { ListTracesDto } from './dto/list-traces.dto';
import { TracesService } from './traces.service';

// Separate from TracesController on purpose: that one is API-key
// authenticated (a script reporting a trace), this one is
// session-authenticated (a person viewing the dashboard), same split as
// ApiKeysController vs ApiKeyAuthController in the api-keys module.
// SessionGuard applies by default here (no @Public()), since a browser
// session, not an API key, is exactly who this route is for.
@Controller('projects/:projectId/traces')
export class ProjectTracesController {
  constructor(private readonly tracesService: TracesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query() query: ListTracesDto,
  ) {
    return this.tracesService.list(user.orgId, projectId, query);
  }
}
