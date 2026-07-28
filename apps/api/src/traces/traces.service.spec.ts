import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TracesService } from './traces.service';

describe('TracesService', () => {
  let tracesService: TracesService;
  let prisma: {
    trace: { create: jest.Mock; upsert: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      trace: { create: jest.fn(), upsert: jest.fn(), findUnique: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TracesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    tracesService = moduleRef.get(TracesService);
  });

  describe('upsert', () => {
    it('always creates a new row when no externalTraceId is given', async () => {
      prisma.trace.create.mockResolvedValue({ id: 'trace-1' });

      await tracesService.upsert('project-1', {
        name: 'run',
        agentName: 'agent',
        startedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(prisma.trace.create).toHaveBeenCalled();
      expect(prisma.trace.upsert).not.toHaveBeenCalled();
    });

    it('applies the RUNNING default on the create branch when status is omitted', async () => {
      prisma.trace.upsert.mockResolvedValue({ id: 'trace-1' });

      await tracesService.upsert('project-1', {
        externalTraceId: 'run-1',
        name: 'run',
        agentName: 'agent',
        startedAt: '2026-01-01T00:00:00.000Z',
      });

      const calls = prisma.trace.upsert.mock.calls as {
        create: { status?: string };
      }[][];
      expect(calls[0][0].create.status).toBe('RUNNING');
    });

    it('does not apply a default status on the update branch, so an omitted status leaves the existing value untouched', async () => {
      prisma.trace.upsert.mockResolvedValue({ id: 'trace-1' });

      await tracesService.upsert('project-1', {
        externalTraceId: 'run-1',
        name: 'run',
        agentName: 'agent',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:05:00.000Z',
        // status intentionally omitted
      });

      const calls = prisma.trace.upsert.mock.calls as {
        update: { status?: string };
      }[][];
      expect(calls[0][0].update.status).toBeUndefined();
    });

    it('rejects an endedAt earlier than startedAt', async () => {
      await expect(
        tracesService.upsert('project-1', {
          name: 'run',
          agentName: 'agent',
          startedAt: '2026-01-01T00:05:00.000Z',
          endedAt: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.trace.create).not.toHaveBeenCalled();
    });
  });

  describe('findOwnedTrace', () => {
    it('returns the trace when it belongs to the given project', async () => {
      prisma.trace.findUnique.mockResolvedValue({
        id: 'trace-1',
        projectId: 'project-1',
      });

      const trace = await tracesService.findOwnedTrace('project-1', 'trace-1');
      expect(trace.id).toBe('trace-1');
    });

    it('rejects a trace that belongs to a different project', async () => {
      prisma.trace.findUnique.mockResolvedValue({
        id: 'trace-1',
        projectId: 'someone-elses-project',
      });

      await expect(
        tracesService.findOwnedTrace('project-1', 'trace-1'),
      ).rejects.toThrow('Trace not found');
    });
  });
});
