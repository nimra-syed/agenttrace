import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApiKeyRecord,
  CreateApiKeyResponse,
} from '@agenttrace/shared-types';
import { hashToken } from '../common/hash-token.util';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { generateApiKey } from './api-key.util';
import { toApiKeyRecord } from './api-key-record.mapper';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  async create(
    orgId: string,
    projectId: string,
    name: string,
  ): Promise<CreateApiKeyResponse> {
    await this.projectsService.findOwnedProject(orgId, projectId);

    const { fullKey, keyPrefix } = generateApiKey();
    const keyHash = hashToken(fullKey);

    const apiKey = await this.prisma.apiKey.create({
      data: { projectId, name, keyPrefix, keyHash },
    });

    // The only point in this key's lifetime where the raw value is ever
    // available. It is not stored anywhere; the caller must save it now.
    return {
      ...toApiKeyRecord(apiKey),
      key: fullKey,
    };
  }

  async findAllForProject(
    orgId: string,
    projectId: string,
  ): Promise<ApiKeyRecord[]> {
    await this.projectsService.findOwnedProject(orgId, projectId);

    const rows = await this.prisma.apiKey.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toApiKeyRecord);
  }

  async revoke(orgId: string, projectId: string, keyId: string) {
    // Two separate checks: the project must belong to the caller's org,
    // and the key must belong to that project. Neither one alone is
    // enough; skipping either would let a caller revoke a key that isn't
    // theirs as long as they could guess a valid-looking id.
    await this.projectsService.findOwnedProject(orgId, projectId);

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });
    if (!apiKey || apiKey.projectId !== projectId) {
      throw new NotFoundException('API key not found');
    }

    // Idempotent: revoking an already-revoked key succeeds without
    // touching the row, so the original revokedAt timestamp (the actual
    // moment of revocation) is never overwritten by a later, redundant
    // call.
    if (apiKey.revokedAt) {
      return { success: true };
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }
}
