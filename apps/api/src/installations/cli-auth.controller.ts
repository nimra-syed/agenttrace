import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { CliTokenThrottlerGuard } from './cli-token-throttler.guard';
import { CliAuthorizeDto } from './dto/cli-authorize.dto';
import { CliTokenExchangeDto } from './dto/cli-token-exchange.dto';
import { InstallationsService } from './installations.service';

// This endpoint's own rate limit, registered centrally in AppModule
// alongside 'auth' and 'evaluate'. See ADR-0016 and ADR-0017: adding a
// new named throttler here means every OTHER route already guarded by
// a ThrottlerGuard subclass needs a matching @SkipThrottle() for this
// name, or it silently also becomes subject to this limit too --
// applied to AuthController and EvaluationsController below, not just
// remembered here.
const CLI_TOKEN_THROTTLE = { 'cli-token': { limit: 20, ttl: 60000 } };

@Controller('cli')
export class CliAuthController {
  constructor(private readonly installationsService: InstallationsService) {}

  // Session-authenticated (a signed-in person approving a new
  // connection in the browser), CSRF-protected automatically (same as
  // every other mutating dashboard action, ADR-0014). Not throttled by
  // its own named config: this is a project-scoped resource-creation
  // action taken by an already-authenticated person, the same as
  // ApiKeysController.create, which has never needed one either.
  @Post('authorize')
  authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CliAuthorizeDto,
  ) {
    return this.installationsService.authorize(
      user.orgId,
      user.id,
      dto.projectId,
      dto.codeChallenge,
      dto.label,
    );
  }

  // Public: this is the CLI calling directly, not a browser, so there is
  // no session to require. Protected instead by the code+PKCE exchange
  // itself and this route's own throttle.
  @Public()
  @UseGuards(CliTokenThrottlerGuard)
  @Throttle(CLI_TOKEN_THROTTLE)
  @SkipThrottle({ auth: true, evaluate: true })
  @Post('token')
  token(@Body() dto: CliTokenExchangeDto) {
    return this.installationsService.exchangeToken(dto.code, dto.codeVerifier);
  }
}
