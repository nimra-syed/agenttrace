import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { hashToken } from '../common/hash-token.util';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiKeyContext } from './current-api-key.decorator';

const BEARER_PREFIX = 'Bearer ';
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

// One generic message for every failure mode (missing header, malformed
// header, unknown key, revoked key). Never reveal which case it was, so a
// caller can't use the response to distinguish "wrong key" from "right
// key, but revoked."
const INVALID_API_KEY_MESSAGE = 'Invalid API key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException(INVALID_API_KEY_MESSAGE);
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      throw new UnauthorizedException(INVALID_API_KEY_MESSAGE);
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashToken(token) },
      include: { project: true },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException(INVALID_API_KEY_MESSAGE);
    }

    // lastUsedAt reflects successful authentication, not whether the
    // request that follows also succeeds, a key that's always presented
    // correctly but whose requests happen to fail validation is still
    // "in use," and should not look stale. Throttled to at most one write
    // per key per hour, regardless of request volume, so this never
    // becomes a write-amplification problem on the ingestion path. Not
    // awaited, and failure here must never block or fail an otherwise
    // valid authenticated request. See ADR-0007 and ADR-0008.
    const now = new Date();
    const lastUsedIsStale =
      !apiKey.lastUsedAt ||
      now.getTime() - apiKey.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;

    if (lastUsedIsStale) {
      void this.prisma.apiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: now } })
        .catch(() => undefined);
    }

    const apiKeyContext: ApiKeyContext = {
      apiKeyId: apiKey.id,
      projectId: apiKey.project.id,
      orgId: apiKey.project.orgId,
    };

    (request as Request & { apiKeyContext: ApiKeyContext }).apiKeyContext =
      apiKeyContext;
    return true;
  }
}
