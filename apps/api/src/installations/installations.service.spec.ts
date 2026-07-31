import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashToken } from '../common/hash-token.util';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { computeCodeChallenge } from './pkce.util';
import { InstallationsService } from './installations.service';

function fakeAuthCodeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'code-1',
    codeHash: hashToken('the-raw-code'),
    installationId: 'installation-1',
    codeChallenge: computeCodeChallenge('the-real-verifier'),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
    installation: { projectId: 'project-1' },
    ...overrides,
  };
}

describe('InstallationsService', () => {
  let service: InstallationsService;
  let prisma: {
    installation: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    cliAuthorizationCode: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let projectsService: { findOwnedProject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      installation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      cliAuthorizationCode: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      // Stands in for a real transaction: invokes the callback with the
      // same mocked client, since every mocked method here is already
      // a plain jest.fn() regardless of which "client" calls it.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    projectsService = { findOwnedProject: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstallationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projectsService },
      ],
    }).compile();

    service = moduleRef.get(InstallationsService);
  });

  describe('authorize', () => {
    it("rejects a project outside the caller's org before creating anything", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        service.authorize(
          'org-1',
          'user-1',
          'someone-elses-project',
          'challenge',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.installation.create).not.toHaveBeenCalled();
    });

    it('creates an Installation with a null tokenHash and a matching authorization code', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.installation.create.mockResolvedValue({ id: 'installation-1' });
      prisma.cliAuthorizationCode.create.mockResolvedValue({});

      const result = await service.authorize(
        'org-1',
        'user-1',
        'project-1',
        'a-challenge-value',
        'BeautyLab',
      );

      expect(prisma.installation.create).toHaveBeenCalledWith({
        data: {
          projectId: 'project-1',
          createdByUserId: 'user-1',
          label: 'BeautyLab',
        },
      });
      // tokenHash is deliberately absent from the create call entirely
      // (not even null), the column defaults to null until exchange.
      const installationCreateCalls = prisma.installation.create.mock.calls as {
        data: Record<string, unknown>;
      }[][];
      expect(installationCreateCalls[0][0].data.tokenHash).toBeUndefined();

      expect(prisma.cliAuthorizationCode.create).toHaveBeenCalledTimes(1);
      const codeCreateCalls = prisma.cliAuthorizationCode.create.mock.calls as {
        data: Record<string, unknown>;
      }[][];
      expect(codeCreateCalls[0][0].data.installationId).toBe('installation-1');
      expect(codeCreateCalls[0][0].data.codeChallenge).toBe(
        'a-challenge-value',
      );

      expect(result.installationId).toBe('installation-1');
      expect(typeof result.code).toBe('string');
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('falls back to a generated label when none is supplied', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.installation.create.mockResolvedValue({ id: 'installation-1' });
      prisma.cliAuthorizationCode.create.mockResolvedValue({});

      await service.authorize('org-1', 'user-1', 'project-1', 'challenge');

      const installationCreateCalls = prisma.installation.create.mock.calls as {
        data: Record<string, unknown>;
      }[][];
      const { label } = installationCreateCalls[0][0].data;
      expect(typeof label).toBe('string');
      expect((label as string).length).toBeGreaterThan(0);
    });
  });

  describe('exchangeToken', () => {
    it('rejects an unknown code', async () => {
      prisma.cliAuthorizationCode.findUnique.mockResolvedValue(null);

      await expect(
        service.exchangeToken('bogus-code', 'the-real-verifier'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired code', async () => {
      prisma.cliAuthorizationCode.findUnique.mockResolvedValue(
        fakeAuthCodeRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.exchangeToken('the-raw-code', 'the-real-verifier'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already-used code', async () => {
      prisma.cliAuthorizationCode.findUnique.mockResolvedValue(
        fakeAuthCodeRow({ usedAt: new Date() }),
      );

      await expect(
        service.exchangeToken('the-raw-code', 'the-real-verifier'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a mismatched PKCE verifier', async () => {
      prisma.cliAuthorizationCode.findUnique.mockResolvedValue(
        fakeAuthCodeRow(),
      );

      await expect(
        service.exchangeToken('the-raw-code', 'a-wrong-verifier'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when a concurrent exchange already claimed the code (race lost)', async () => {
      prisma.cliAuthorizationCode.findUnique.mockResolvedValue(
        fakeAuthCodeRow(),
      );
      prisma.cliAuthorizationCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.exchangeToken('the-raw-code', 'the-real-verifier'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.installation.update).not.toHaveBeenCalled();
    });

    it('succeeds for a valid, unexpired, unused code with a matching verifier, and mints a real token', async () => {
      prisma.cliAuthorizationCode.findUnique.mockResolvedValue(
        fakeAuthCodeRow(),
      );
      prisma.cliAuthorizationCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.installation.update.mockResolvedValue({});

      const result = await service.exchangeToken(
        'the-raw-code',
        'the-real-verifier',
      );

      expect(result.installationId).toBe('installation-1');
      expect(result.projectId).toBe('project-1');
      expect(result.token.startsWith('atc_')).toBe(true);

      expect(prisma.cliAuthorizationCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'code-1', usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      const installationUpdateCalls = prisma.installation.update.mock.calls as {
        where: { id: string };
        data: { tokenHash: string; tokenPrefix: string };
      }[][];
      expect(installationUpdateCalls[0][0].where).toEqual({
        id: 'installation-1',
      });
      expect(installationUpdateCalls[0][0].data.tokenHash).toBe(
        hashToken(result.token),
      );
    });
  });

  describe('findAllForProject', () => {
    it("rejects a project outside the caller's org", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        service.findAllForProject('org-1', 'someone-elses-project'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.installation.findMany).not.toHaveBeenCalled();
    });

    it('returns installations including still-pending ones (null lastUsedAt)', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.installation.findMany.mockResolvedValue([
        {
          id: 'installation-1',
          projectId: 'project-1',
          label: 'BeautyLab',
          createdByUserId: 'user-1',
          lastUsedAt: null,
          revokedAt: null,
          revokedByUserId: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.findAllForProject('org-1', 'project-1');

      expect(result).toHaveLength(1);
      expect(result[0].lastUsedAt).toBeNull();
    });
  });

  describe('revoke', () => {
    it('rejects an installation belonging to a different project', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.installation.findUnique.mockResolvedValue({
        id: 'installation-1',
        projectId: 'a-different-project',
      });

      await expect(
        service.revoke('org-1', 'project-1', 'user-1', 'installation-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets revokedAt and revokedByUserId', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.installation.findUnique.mockResolvedValue({
        id: 'installation-1',
        projectId: 'project-1',
        revokedAt: null,
      });

      const result = await service.revoke(
        'org-1',
        'project-1',
        'user-1',
        'installation-1',
      );

      expect(result).toEqual({ success: true });
      expect(prisma.installation.update).toHaveBeenCalledWith({
        where: { id: 'installation-1' },
        data: {
          revokedAt: expect.any(Date) as Date,
          revokedByUserId: 'user-1',
        },
      });
    });

    it('is idempotent: revoking an already-revoked installation does not overwrite revokedAt', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.installation.findUnique.mockResolvedValue({
        id: 'installation-1',
        projectId: 'project-1',
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.revoke(
        'org-1',
        'project-1',
        'user-1',
        'installation-1',
      );

      expect(result).toEqual({ success: true });
      expect(prisma.installation.update).not.toHaveBeenCalled();
    });
  });
});
