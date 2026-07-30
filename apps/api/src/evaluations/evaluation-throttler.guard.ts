import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Keyed on the authenticated user + the project being evaluated, not
// email (there is no email in this request body, unlike
// AuthThrottlerGuard, ADR-0014) and not IP (same reasoning as
// AuthThrottlerGuard: no trustworthy X-Forwarded-For hop exists in this
// project's current topology). request.user is already populated by
// SessionGuard, which runs before any method-level guard (ADR-0014's
// APP_GUARD ordering), so it's reliably available here.
//
// This endpoint triggers a real, paid LLM call per request, so the goal
// is cost containment, not brute-force prevention -- keying on
// (user, project) means one person hammering "Evaluate" on one project
// can't run up unbounded cost, without blocking a different person, or
// the same person working in a different project. See ADR-0016.
@Injectable()
export class EvaluationThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    const params = req.params as { projectId?: string } | undefined;
    const userId = typeof user?.id === 'string' ? user.id : 'unknown-user';
    const projectId =
      typeof params?.projectId === 'string'
        ? params.projectId
        : 'unknown-project';
    return Promise.resolve(`${userId}:${projectId}`);
  }
}
