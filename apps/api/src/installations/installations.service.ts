import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  CliAuthorizeResponse,
  CliTokenExchangeResponse,
  InstallationRecord,
} from '@agenttrace/shared-types';
import { hashToken } from '../common/hash-token.util';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { toInstallationRecord } from './installation-record.mapper';
import {
  generateInstallationToken,
  generateOpaqueToken,
} from './installation.util';
import { codeChallengesMatch, computeCodeChallenge } from './pkce.util';

// Codes are single-use and hashed, high-entropy random tokens, so a
// brief lifetime isn't the primary defense (brute-forcing a 32-byte
// random value in under a minute isn't feasible either way) -- it
// bounds how long a code that was somehow intercepted mid-flight
// (e.g. a browser crash between authorize and the CLI's redirect)
// stays claimable at all.
const CODE_TTL_MS = 60 * 1000;

// One generic message for every exchange failure (unknown code, expired,
// already used, PKCE mismatch, lost the race to claim it) -- same
// don't-distinguish-failure-reasons discipline as ApiKeyGuard's
// INVALID_API_KEY_MESSAGE. See ADR-0017.
const INVALID_CODE_MESSAGE = 'Invalid or expired authorization code';

function fallbackLabel(): string {
  return `New connection - ${new Date().toISOString()}`;
}

@Injectable()
export class InstallationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  // Session-authenticated (a signed-in person approving a new
  // connection in the browser). Creates the Installation row with
  // tokenHash still null -- the raw secret isn't generated until
  // exchangeToken succeeds, so nothing is ever persisted that this
  // process doesn't immediately hash away. See ADR-0017.
  async authorize(
    orgId: string,
    userId: string,
    projectId: string,
    codeChallenge: string,
    label?: string,
  ): Promise<CliAuthorizeResponse> {
    await this.projectsService.findOwnedProject(orgId, projectId);

    const installation = await this.prisma.installation.create({
      data: {
        projectId,
        createdByUserId: userId,
        label: label ?? fallbackLabel(),
      },
    });

    const rawCode = generateOpaqueToken();
    await this.prisma.cliAuthorizationCode.create({
      data: {
        codeHash: hashToken(rawCode),
        installationId: installation.id,
        codeChallenge,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    return { code: rawCode, installationId: installation.id };
  }

  // Public (no session): this is the CLI itself calling, directly, not
  // through a browser. Mirrors an OAuth authorization-code exchange:
  // the code proves "a human approved this in the browser a moment
  // ago," the PKCE verifier proves "this exchange request came from the
  // same process that started the flow," and only both together mint a
  // real credential. See ADR-0017.
  async exchangeToken(
    code: string,
    codeVerifier: string,
  ): Promise<CliTokenExchangeResponse> {
    const authCode = await this.prisma.cliAuthorizationCode.findUnique({
      where: { codeHash: hashToken(code) },
      include: { installation: true },
    });

    if (
      !authCode ||
      authCode.usedAt ||
      authCode.expiresAt.getTime() < Date.now() ||
      !codeChallengesMatch(
        computeCodeChallenge(codeVerifier),
        authCode.codeChallenge,
      )
    ) {
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const { fullToken, tokenPrefix } = generateInstallationToken();

    return this.prisma.$transaction(async (tx) => {
      // Atomically claim the code: a where-clause that also requires
      // usedAt to still be null, checked via the write's own affected
      // row count, closes the race window between two concurrent
      // exchange attempts for the same code (only one can ever succeed,
      // regardless of how the read above was interleaved).
      const claim = await tx.cliAuthorizationCode.updateMany({
        where: { id: authCode.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new UnauthorizedException(INVALID_CODE_MESSAGE);
      }

      await tx.installation.update({
        where: { id: authCode.installationId },
        data: { tokenHash: hashToken(fullToken), tokenPrefix },
      });

      return {
        token: fullToken,
        installationId: authCode.installationId,
        projectId: authCode.installation.projectId,
      };
    });
  }

  async findAllForProject(
    orgId: string,
    projectId: string,
  ): Promise<InstallationRecord[]> {
    await this.projectsService.findOwnedProject(orgId, projectId);

    const rows = await this.prisma.installation.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        label: true,
        createdByUserId: true,
        lastUsedAt: true,
        revokedAt: true,
        revokedByUserId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toInstallationRecord);
  }

  async revoke(
    orgId: string,
    projectId: string,
    userId: string,
    installationId: string,
  ) {
    // Same two-check reasoning as ApiKeysService.revoke: the project
    // must belong to the caller's org, and the installation must
    // belong to that project. Neither check alone is sufficient.
    await this.projectsService.findOwnedProject(orgId, projectId);

    const installation = await this.prisma.installation.findUnique({
      where: { id: installationId },
    });
    if (!installation || installation.projectId !== projectId) {
      throw new NotFoundException('Installation not found');
    }

    // Idempotent: revoking an already-revoked installation succeeds
    // without touching the row, so the original revokedAt/revokedByUserId
    // (who actually revoked it, and when) is never overwritten by a
    // later, redundant call.
    if (installation.revokedAt) {
      return { success: true };
    }

    await this.prisma.installation.update({
      where: { id: installationId },
      data: { revokedAt: new Date(), revokedByUserId: userId },
    });

    return { success: true };
  }
}
