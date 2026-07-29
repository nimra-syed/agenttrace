import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './current-user.decorator';
import { SessionGuard } from './session.guard';

type FakeRequest = Request & {
  user?: AuthenticatedUser;
  sessionId?: string;
};

function contextWithCookie(cookies: Record<string, string>): {
  context: ExecutionContext;
  request: FakeRequest;
} {
  const request = { cookies } as unknown as FakeRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    // No @Public() metadata on either, so getAllAndOverride resolves to
    // undefined (falsy): every test here exercises the protected path,
    // which is all this file's new behavior (sessionId attachment)
    // needs.
    getHandler: () => (() => undefined) as unknown,
    getClass: () => class {} as unknown,
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('SessionGuard', () => {
  let guard: SessionGuard;
  let prisma: { session: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { session: { findUnique: jest.fn() } };
    guard = new SessionGuard(
      new Reflector(),
      prisma as unknown as PrismaService,
    );
  });

  it('rejects a request with no session cookie', async () => {
    const { context } = contextWithCookie({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unknown or expired session', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    const { context } = contextWithCookie({ agenttrace_session: 'x' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches both user and sessionId for a valid session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-1',
        email: 'demo@agenttrace.dev',
        name: 'Demo User',
        memberships: [{ orgId: 'org-1', role: 'OWNER' }],
      },
    });

    const { context, request } = contextWithCookie({
      agenttrace_session: 'valid-token',
    });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user?.id).toBe('user-1');
    // sessionId is the session row's own id, not the raw cookie token:
    // CsrfGuard needs this specific value to recompute the expected
    // CSRF token. See csrf.util.ts and ADR-0013.
    expect(request.sessionId).toBe('session-1');
  });
});
