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

    // lastUsedAt is intentionally not updated here. Writing it on every
    // authenticated request would add a database write to every future
    // ingestion call (M4), which is the highest-volume path in this
    // system. Revisit with a throttled or async update (e.g. only write
    // when the stored value is more than an hour old) once ingestion
    // exists and this actually matters.

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
