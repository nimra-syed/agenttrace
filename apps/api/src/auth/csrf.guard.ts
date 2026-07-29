import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './current-user.decorator';
import {
  computeCsrfToken,
  csrfTokensMatch,
  CSRF_HEADER_NAME,
} from './csrf.util';

type CsrfRelevantRequest = Request & {
  user?: AuthenticatedUser;
  sessionId?: string;
  apiKeyContext?: unknown;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Runs after SessionGuard (registered second in AuthModule's providers,
// see ADR-0014 on APP_GUARD ordering), so request.user/request.sessionId
// are already populated when this executes, if a session authenticated
// the request at all.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CsrfRelevantRequest>();

    if (SAFE_METHODS.has(request.method)) return true;

    // Enforcement is keyed on the authentication mechanism this specific
    // request actually used, not on @Public(). Only a request
    // SessionGuard authenticated via a cookie carries CSRF risk: a
    // cross-site page can make the browser send that cookie
    // automatically, but it can't attach a header value it was never
    // given. An API-key request authenticates via an explicit
    // Authorization header the browser never attaches on its own, so
    // there's nothing for CSRF to exploit there, regardless of why the
    // route happens to be @Public() (that decorator also covers
    // genuinely anonymous routes for an unrelated reason: skipping
    // SessionGuard, not skipping CSRF). See ADR-0014.
    if (!request.user || request.apiKeyContext) return true;

    const header = request.headers[CSRF_HEADER_NAME];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (!headerValue || !request.sessionId) {
      throw new ForbiddenException('Missing CSRF token');
    }

    const expected = computeCsrfToken(request.sessionId);
    if (!csrfTokensMatch(headerValue, expected)) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }
}
