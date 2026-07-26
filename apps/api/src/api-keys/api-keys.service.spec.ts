import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  let apiKeysService: ApiKeysService;
  let prisma: {
    apiKey: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let projectsService: { findOwnedProject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    projectsService = { findOwnedProject: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projectsService },
      ],
    }).compile();

    apiKeysService = moduleRef.get(ApiKeysService);
  });

  describe('create', () => {
    it('checks project ownership before creating a key, and stores only the hash', async () => {
      projectsService.findOwnedProject.mockResolvedValue({
        id: 'project-1',
        orgId: 'org-1',
      });
      prisma.apiKey.create.mockImplementation(
        ({ data }: { data: { keyHash: string; keyPrefix: string } }) => {
          expect(data.keyHash).not.toMatch(/^atr_/);
          return Promise.resolve({
            id: 'key-1',
            name: 'local dev',
            keyPrefix: data.keyPrefix,
            createdAt: new Date(),
          });
        },
      );

      const result = await apiKeysService.create(
        'org-1',
        'project-1',
        'local dev',
      );

      expect(projectsService.findOwnedProject).toHaveBeenCalledWith(
        'org-1',
        'project-1',
      );
      expect(result.key).toMatch(/^atr_/);
      expect(result.keyPrefix).toBe(result.key.slice(0, 12));
    });

    it("rejects creating a key for a project that does not belong to the caller's org", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        apiKeysService.create('org-1', 'someone-elses-project', 'x'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('revokes a key that belongs to the project', async () => {
      projectsService.findOwnedProject.mockResolvedValue({
        id: 'project-1',
        orgId: 'org-1',
      });
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        projectId: 'project-1',
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});

      const result = await apiKeysService.revoke('org-1', 'project-1', 'key-1');

      expect(result).toEqual({ success: true });
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('is idempotent: revoking an already-revoked key succeeds without touching the row', async () => {
      const originalRevokedAt = new Date('2026-01-01T00:00:00.000Z');
      projectsService.findOwnedProject.mockResolvedValue({
        id: 'project-1',
        orgId: 'org-1',
      });
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        projectId: 'project-1',
        revokedAt: originalRevokedAt,
      });

      const result = await apiKeysService.revoke('org-1', 'project-1', 'key-1');

      expect(result).toEqual({ success: true });
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('rejects revoking a key that belongs to a different project, even in the same org', async () => {
      projectsService.findOwnedProject.mockResolvedValue({
        id: 'project-1',
        orgId: 'org-1',
      });
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        projectId: 'a-different-project',
      });

      await expect(
        apiKeysService.revoke('org-1', 'project-1', 'key-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it("rejects revoking a key for a project outside the caller's org before ever looking at the key", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        apiKeysService.revoke('org-1', 'someone-elses-project', 'key-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });
  });
});
