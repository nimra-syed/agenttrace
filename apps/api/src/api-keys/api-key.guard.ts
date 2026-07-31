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
// header, unknown key, revoked key, unknown installation, revoked
// installation, an installation whose token was never actually minted
// because its CLI-connect flow was never completed). Never reveal which
// case it was, so a caller can't use the response to distinguish "wrong
// key" from "right key, but revoked." See ADR-0007 and ADR-0017.
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

    const tokenHash = hashToken(token);

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: tokenHash },
      include: { project: true },
    });

    if (apiKey) {
      if (apiKey.revokedAt) {
        throw new UnauthorizedException(INVALID_API_KEY_MESSAGE);
      }
      if (this.isLastUsedStale(apiKey.lastUsedAt)) {
        const now = new Date();
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

    // A row whose tokenHash is still null (never exchanged, ADR-0017)
    // can never be found here: tokenHash is a hash of some real
    // submitted token, and Prisma's findUnique on a nullable unique
    // column never matches a row where that column is actually null, no
    // special-casing needed.
    const installation = await this.prisma.installation.findUnique({
      where: { tokenHash },
      include: { project: true },
    });

    if (!installation || installation.revokedAt) {
      throw new UnauthorizedException(INVALID_API_KEY_MESSAGE);
    }
    if (this.isLastUsedStale(installation.lastUsedAt)) {
      const now = new Date();
      void this.prisma.installation
        .update({ where: { id: installation.id }, data: { lastUsedAt: now } })
        .catch(() => undefined);
    }

    const apiKeyContext: ApiKeyContext = {
      installationId: installation.id,
      projectId: installation.project.id,
      orgId: installation.project.orgId,
    };
    (request as Request & { apiKeyContext: ApiKeyContext }).apiKeyContext =
      apiKeyContext;
    return true;
  }

  // lastUsedAt reflects successful authentication, not whether the
  // request that follows also succeeds: a credential that's always
  // presented correctly but whose requests happen to fail validation is
  // still "in use," and should not look stale. Throttled to at most one
  // write per credential per hour, regardless of request volume, so
  // this never becomes a write-amplification problem on the ingestion
  // path. Shared by both credential types, same reasoning either way.
  // See ADR-0007, ADR-0008, ADR-0017.
  private isLastUsedStale(lastUsedAt: Date | null): boolean {
    return (
      !lastUsedAt || Date.now() - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
    );
  }
}
