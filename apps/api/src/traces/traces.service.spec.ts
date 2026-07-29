import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { encodeCursor } from './cursor.util';
import { TracesService } from './traces.service';

describe('TracesService', () => {
  let tracesService: TracesService;
  let prisma: {
    trace: {
      create: jest.Mock;
      upsert: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    span: {
      findMany: jest.Mock;
    };
  };
  let projectsService: { findOwnedProject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      trace: {
        create: jest.fn(),
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      span: {
        findMany: jest.fn(),
      },
    };
    projectsService = { findOwnedProject: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TracesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projectsService },
      ],
    }).compile();

    tracesService = moduleRef.get(TracesService);
  });

  function fakeTraceRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'trace-1',
      projectId: 'project-1',
      externalTraceId: null,
      name: 'run',
      agentName: 'agent',
      status: 'SUCCESS',
      input: null,
      output: null,
      error: null,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: new Date('2026-01-01T00:01:00.000Z'),
      durationMs: 60000,
      totalTokens: 100,
      totalCostUsd: null,
      metadata: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function fakeSpanRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'span-1',
      traceId: 'trace-1',
      externalSpanId: null,
      parentSpanId: null,
      name: 'call-llm',
      type: 'LLM',
      status: 'SUCCESS',
      input: null,
      output: null,
      model: null,
      provider: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      error: null,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: new Date('2026-01-01T00:01:00.000Z'),
      durationMs: 60000,
      metadata: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  describe('upsert', () => {
    it('always creates a new row when no externalTraceId is given', async () => {
      prisma.trace.create.mockResolvedValue(fakeTraceRow());

      await tracesService.upsert('project-1', {
        name: 'run',
        agentName: 'agent',
        startedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(prisma.trace.create).toHaveBeenCalled();
      expect(prisma.trace.upsert).not.toHaveBeenCalled();
    });

    it('applies the RUNNING default on the create branch when status is omitted', async () => {
      prisma.trace.upsert.mockResolvedValue(fakeTraceRow());

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
      prisma.trace.upsert.mockResolvedValue(fakeTraceRow());

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

  describe('list', () => {
    it("rejects listing traces for a project outside the caller's org, before ever querying traces", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        tracesService.list('org-1', 'someone-elses-project', {}),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.trace.findMany).not.toHaveBeenCalled();
    });

    it('always orders by (startedAt desc, id desc), the deterministic tiebreaker', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([fakeTraceRow()]);

      await tracesService.list('org-1', 'project-1', {});

      const calls = prisma.trace.findMany.mock.calls as {
        orderBy: unknown;
      }[][];
      expect(calls[0][0].orderBy).toEqual([
        { startedAt: 'desc' },
        { id: 'desc' },
      ]);
    });

    it('requests one row past the page size, to detect a next page without a separate count query', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([fakeTraceRow()]);

      await tracesService.list('org-1', 'project-1', { limit: 20 });

      const calls = prisma.trace.findMany.mock.calls as { take: number }[][];
      expect(calls[0][0].take).toBe(21);
    });

    it('returns nextCursor as null when there is no next page', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([fakeTraceRow()]);

      const result = await tracesService.list('org-1', 'project-1', {
        limit: 20,
      });

      expect(result.nextCursor).toBeNull();
      expect(result.items).toHaveLength(1);
    });

    it('returns a decodable nextCursor built from the last row on the page when more rows exist', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      const rows = [
        fakeTraceRow({ id: 'trace-1' }),
        fakeTraceRow({ id: 'trace-2' }),
        fakeTraceRow({ id: 'trace-3' }), // the "one extra" row past the limit
      ];
      prisma.trace.findMany.mockResolvedValue(rows);

      const result = await tracesService.list('org-1', 'project-1', {
        limit: 2,
      });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
      // The cursor is derived from the last row actually returned
      // (trace-2), not the extra lookahead row (trace-3).
      const expectedCursor = encodeCursor(rows[1].startedAt, rows[1].id);
      expect(result.nextCursor).toBe(expectedCursor);
    });

    it('translates a cursor into a deterministic (startedAt, id) OR condition', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([]);

      const cursorTimestamp = new Date('2026-01-01T00:00:00.000Z');
      const cursor = encodeCursor(cursorTimestamp, 'trace-5');

      await tracesService.list('org-1', 'project-1', { cursor });

      const calls = prisma.trace.findMany.mock.calls as {
        where: { OR?: unknown };
      }[][];
      expect(calls[0][0].where.OR).toEqual([
        { startedAt: { lt: cursorTimestamp } },
        { startedAt: cursorTimestamp, id: { lt: 'trace-5' } },
      ]);
    });

    it('rejects an invalid cursor without querying the database', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });

      await expect(
        tracesService.list('org-1', 'project-1', {
          cursor: 'not-valid-base64!',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.trace.findMany).not.toHaveBeenCalled();
    });

    it('applies status, a case-insensitive agentName filter, and a date range together', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([]);

      await tracesService.list('org-1', 'project-1', {
        status: 'ERROR',
        agentName: 'GitHub',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      });

      const calls = prisma.trace.findMany.mock.calls as {
        where: {
          status?: string;
          agentName?: { contains: string; mode: string };
          startedAt?: { gte?: Date; lte?: Date };
        };
      }[][];
      expect(calls[0][0].where.status).toBe('ERROR');
      expect(calls[0][0].where.agentName).toEqual({
        contains: 'GitHub',
        mode: 'insensitive',
      });
      expect(calls[0][0].where.startedAt?.gte).toEqual(
        new Date('2026-01-01T00:00:00.000Z'),
      );
      expect(calls[0][0].where.startedAt?.lte).toEqual(
        new Date('2026-01-02T00:00:00.000Z'),
      );
    });

    it('omits the startedAt filter entirely when no date range is given', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([]);

      await tracesService.list('org-1', 'project-1', {});

      const calls = prisma.trace.findMany.mock.calls as {
        where: { startedAt?: unknown };
      }[][];
      expect(calls[0][0].where.startedAt).toBeUndefined();
    });

    it('maps a real Prisma Decimal cost to a plain JS number, not a string', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([
        fakeTraceRow({ totalCostUsd: new Prisma.Decimal('12.340000') }),
      ]);

      const result = await tracesService.list('org-1', 'project-1', {});

      expect(result.items[0].totalCostUsd).toBe(12.34);
      expect(typeof result.items[0].totalCostUsd).toBe('number');
    });

    it('maps Date fields to ISO strings, matching the wire format contract', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findMany.mockResolvedValue([fakeTraceRow()]);

      const result = await tracesService.list('org-1', 'project-1', {});

      expect(result.items[0].startedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(typeof result.items[0].startedAt).toBe('string');
    });
  });

  describe('getDetail', () => {
    it("rejects a project outside the caller's org, before ever querying the trace", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        tracesService.getDetail('org-1', 'someone-elses-project', 'trace-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.trace.findUnique).not.toHaveBeenCalled();
      expect(prisma.span.findMany).not.toHaveBeenCalled();
    });

    it('rejects a trace that belongs to a different project than the one in the URL', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findUnique.mockResolvedValue(
        fakeTraceRow({ id: 'trace-1', projectId: 'someone-elses-project' }),
      );

      await expect(
        tracesService.getDetail('org-1', 'project-1', 'trace-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.span.findMany).not.toHaveBeenCalled();
    });

    it('rejects a nonexistent trace id', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findUnique.mockResolvedValue(null);

      await expect(
        tracesService.getDetail('org-1', 'project-1', 'no-such-trace'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.span.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty spans array for a trace with no spans yet', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findUnique.mockResolvedValue(fakeTraceRow());
      prisma.span.findMany.mockResolvedValue([]);

      const result = await tracesService.getDetail(
        'org-1',
        'project-1',
        'trace-1',
      );

      expect(result.spans).toEqual([]);
      expect(result.trace.id).toBe('trace-1');
    });

    it('always orders spans by (startedAt asc, id asc), the deterministic tiebreaker', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findUnique.mockResolvedValue(fakeTraceRow());
      prisma.span.findMany.mockResolvedValue([fakeSpanRow()]);

      await tracesService.getDetail('org-1', 'project-1', 'trace-1');

      const calls = prisma.span.findMany.mock.calls as {
        where: { traceId: string };
        orderBy: unknown;
      }[][];
      expect(calls[0][0].where).toEqual({ traceId: 'trace-1' });
      expect(calls[0][0].orderBy).toEqual([
        { startedAt: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('maps a real Prisma Decimal span cost to a plain JS number, not a string', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findUnique.mockResolvedValue(
        fakeTraceRow({ totalCostUsd: new Prisma.Decimal('9.870000') }),
      );
      prisma.span.findMany.mockResolvedValue([
        fakeSpanRow({ costUsd: new Prisma.Decimal('3.210000') }),
      ]);

      const result = await tracesService.getDetail(
        'org-1',
        'project-1',
        'trace-1',
      );

      expect(result.trace.totalCostUsd).toBe(9.87);
      expect(typeof result.trace.totalCostUsd).toBe('number');
      expect(result.spans[0].costUsd).toBe(3.21);
      expect(typeof result.spans[0].costUsd).toBe('number');
    });

    it('maps trace and span Date fields to ISO strings, matching the wire format contract', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      prisma.trace.findUnique.mockResolvedValue(fakeTraceRow());
      prisma.span.findMany.mockResolvedValue([fakeSpanRow()]);

      const result = await tracesService.getDetail(
        'org-1',
        'project-1',
        'trace-1',
      );

      expect(result.trace.startedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(typeof result.trace.startedAt).toBe('string');
      expect(result.spans[0].startedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(typeof result.spans[0].startedAt).toBe('string');
    });
  });
});
