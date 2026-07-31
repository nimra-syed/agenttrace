import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/current-user.decorator';
import { EvaluationThrottlerGuard } from './evaluation-throttler.guard';
import { EvaluationsService } from './evaluations.service';

// A separate controller, not folded into ProjectTracesController, same
// pattern as ApiKeysController/SpansController being their own
// controllers despite nesting under a parent resource's URL. See
// ADR-0016.
const EVALUATE_THROTTLE = { evaluate: { limit: 10, ttl: 60000 } };

@Controller('projects/:projectId/traces/:traceId')
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  // ThrottlerGuard applies every named throttler registered in
  // AppModule's ThrottlerModule.forRoot() to any route it guards, not
  // just the one named in @Throttle() -- confirmed by reading
  // ThrottlerGuard.canActivate, which loops over all of them. Without
  // this, the route was also being checked against the 'auth' config's
  // limit: 5 (using this guard's own tracker), tripping five requests
  // early instead of at the intended 10. See ADR-0016. 'cli-token'
  // (ADR-0017) is skipped for the same reason, applied proactively this
  // time instead of found live.
  @Post('evaluate')
  @UseGuards(EvaluationThrottlerGuard)
  @Throttle(EVALUATE_THROTTLE)
  @SkipThrottle({ auth: true, 'cli-token': true })
  evaluate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('traceId') traceId: string,
  ) {
    return this.evaluationsService.evaluate(user.orgId, projectId, traceId);
  }

  @Get('evaluations')
  listEvaluations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('traceId') traceId: string,
  ) {
    return this.evaluationsService.listForTrace(user.orgId, projectId, traceId);
  }
}
