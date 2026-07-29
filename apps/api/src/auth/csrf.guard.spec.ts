import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { computeCsrfToken } from './csrf.util';
import { CsrfGuard } from './csrf.guard';
import type { AuthenticatedUser } from './current-user.decorator';

const VALID_SECRET = 'a'.repeat(63) + 'b';

type FakeRequest = Request & {
  user?: AuthenticatedUser;
  sessionId?: string;
  apiKeyContext?: unknown;
};

function contextFor(request: Partial<FakeRequest>): ExecutionContext {
  const fullRequest = { headers: {}, ...request } as FakeRequest;
  return {
    switchToHttp: () => ({ getRequest: () => fullRequest }),
  } as unknown as ExecutionContext;
}

const AUTHENTICATED_USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'demo@agenttrace.dev',
  name: 'Demo User',
  orgId: 'org-1',
  role: 'OWNER',
};

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  const originalSecret = process.env.CSRF_SECRET;

  beforeEach(() => {
    process.env.CSRF_SECRET = VALID_SECRET;
    guard = new CsrfGuard();
  });

  afterAll(() => {
    process.env.CSRF_SECRET = originalSecret;
  });

  it('skips GET requests, even with no session and no header', () => {
    const context = contextFor({ method: 'GET' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('skips HEAD and OPTIONS the same way', () => {
    expect(guard.canActivate(contextFor({ method: 'HEAD' }))).toBe(true);
    expect(guard.canActivate(contextFor({ method: 'OPTIONS' }))).toBe(true);
  });

  it('skips a mutating request that no session authenticated (e.g. login, signup, logout, health)', () => {
    const context = contextFor({ method: 'POST', user: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('skips a mutating request authenticated via an API key, by mechanism, not by @Public()', () => {
    // Explicitly sets both user and apiKeyContext to prove the check is
    // "was this an API-key request," not merely "request.user happens
    // to be unset" -- today the two guards never both populate the
    // request, but the check should be robust to that changing later.
    // See ADR-0013.
    const context = contextFor({
      method: 'POST',
      user: AUTHENTICATED_USER,
      apiKeyContext: { apiKeyId: 'key-1', projectId: 'p1', orgId: 'org-1' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a session-authenticated mutating request with no CSRF header', () => {
    const context = contextFor({
      method: 'POST',
      user: AUTHENTICATED_USER,
      sessionId: 'session-1',
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a session-authenticated mutating request with a wrong CSRF header', () => {
    const context = contextFor({
      method: 'POST',
      user: AUTHENTICATED_USER,
      sessionId: 'session-1',
      headers: { 'x-csrf-token': 'not-the-right-token' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('accepts a session-authenticated mutating request with the correct CSRF header', () => {
    const token = computeCsrfToken('session-1');
    const context = contextFor({
      method: 'POST',
      user: AUTHENTICATED_USER,
      sessionId: 'session-1',
      headers: { 'x-csrf-token': token },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a token that is valid for a different session', () => {
    // Proves session-binding end to end through the guard, not just in
    // computeCsrfToken's own unit tests.
    const tokenForAnotherSession = computeCsrfToken('someone-elses-session');
    const context = contextFor({
      method: 'POST',
      user: AUTHENTICATED_USER,
      sessionId: 'session-1',
      headers: { 'x-csrf-token': tokenForAnotherSession },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
