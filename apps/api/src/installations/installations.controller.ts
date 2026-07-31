import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/current-user.decorator';
import { InstallationsService } from './installations.service';

// Session-authenticated (no @Public(), no special guard beyond the
// global SessionGuard/CsrfGuard) -- listing and revoking are dashboard
// actions a signed-in person takes, same shape as ApiKeysController.
// Creation isn't here: it only ever happens via the browser-approval
// step in CliAuthController, not a direct "create installation" call.
@Controller('projects/:projectId/installations')
export class InstallationsController {
  constructor(private readonly installationsService: InstallationsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.installationsService.findAllForProject(user.orgId, projectId);
  }

  @Delete(':installationId')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('installationId') installationId: string,
  ) {
    return this.installationsService.revoke(
      user.orgId,
      projectId,
      user.id,
      installationId,
    );
  }
}
