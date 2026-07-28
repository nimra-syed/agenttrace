import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyGuard } from './api-key.guard';
import type { ApiKeyContext } from './current-api-key.decorator';

type FakeRequest = Request & { apiKeyContext?: ApiKeyContext };

function contextWithHeaders(headers: Record<string, string>): {
  context: ExecutionContext;
  request: FakeRequest;
} {
  const request = { headers } as unknown as FakeRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: {
    apiKey: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      apiKey: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    guard = new ApiKeyGuard(prisma as unknown as PrismaService);
  });

  it('rejects a request with no Authorization header', async () => {
    const { context } = contextWithHeaders({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a malformed Authorization header', async () => {
    const { context } = contextWithHeaders({
      authorization: 'not-bearer-format',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unknown key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);
    const { context } = contextWithHeaders({
      authorization: 'Bearer atr_doesnotexist',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a revoked key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: new Date(),
      project: { id: 'project-1', orgId: 'org-1' },
    });
    const { context } = contextWithHeaders({
      authorization: 'Bearer atr_revokedkey',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid, unrevoked key and attaches the api key context to the request', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: null,
      project: { id: 'project-1', orgId: 'org-1' },
    });

    const { context, request } = contextWithHeaders({
      authorization: 'Bearer atr_validkey',
    });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.apiKeyContext).toEqual({
      apiKeyId: 'key-1',
      projectId: 'project-1',
      orgId: 'org-1',
    });
  });

  it('updates lastUsedAt when it has never been set', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: null,
      lastUsedAt: null,
      project: { id: 'project-1', orgId: 'org-1' },
    });

    const { context } = contextWithHeaders({ authorization: 'Bearer atr_x' });
    await guard.canActivate(context);

    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) as Date },
    });
  });

  it('does not update lastUsedAt when it was set recently', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: null,
      lastUsedAt: fiveMinutesAgo,
      project: { id: 'project-1', orgId: 'org-1' },
    });

    const { context } = contextWithHeaders({ authorization: 'Bearer atr_x' });
    await guard.canActivate(context);

    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('updates lastUsedAt again once the stored value is more than an hour old', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: null,
      lastUsedAt: twoHoursAgo,
      project: { id: 'project-1', orgId: 'org-1' },
    });

    const { context } = contextWithHeaders({ authorization: 'Bearer atr_x' });
    await guard.canActivate(context);

    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) as Date },
    });
  });

  it('gives the exact same error message for every rejection case', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    const cases = [
      contextWithHeaders({}).context,
      contextWithHeaders({ authorization: 'garbage' }).context,
      contextWithHeaders({ authorization: 'Bearer atr_unknown' }).context,
    ];

    const messages = await Promise.all(
      cases.map((ctx) =>
        guard
          .canActivate(ctx)
          .catch((error: unknown) =>
            error instanceof UnauthorizedException
              ? error.message
              : 'not-unauthorized',
          ),
      ),
    );

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toBe('not-unauthorized');
  });
});
