import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { TracesService } from '../traces/traces.service';
import { EvaluationWorkerClient } from './evaluation-worker.client';
import { EvaluationsService } from './evaluations.service';

function fakeTraceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trace-1',
    projectId: 'project-1',
    name: 'run',
    agentName: 'agent',
    status: 'SUCCESS',
    input: { question: 'why' },
    output: { answer: 'because' },
    error: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeEvalResultRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eval-1',
    traceId: 'trace-1',
    score: 4,
    rationale: 'Looks correct.',
    judgeModel: 'gemini-3-flash-preview',
    evaluatorVersion: 'judge-v1',
    evaluationInput: { trace: {}, spans: [] },
    createdAt: new Date('2026-01-01T00:05:00.000Z'),
    ...overrides,
  };
}

describe('EvaluationsService', () => {
  let evaluationsService: EvaluationsService;
  let prisma: {
    span: { findMany: jest.Mock };
    evalResult: { create: jest.Mock; findMany: jest.Mock };
  };
  let projectsService: { findOwnedProject: jest.Mock };
  let tracesService: { findOwnedTrace: jest.Mock };
  let evaluationWorkerClient: { evaluate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      span: { findMany: jest.fn() },
      evalResult: { create: jest.fn(), findMany: jest.fn() },
    };
    projectsService = { findOwnedProject: jest.fn() };
    tracesService = { findOwnedTrace: jest.fn() };
    evaluationWorkerClient = { evaluate: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projectsService },
        { provide: TracesService, useValue: tracesService },
        { provide: EvaluationWorkerClient, useValue: evaluationWorkerClient },
      ],
    }).compile();

    evaluationsService = moduleRef.get(EvaluationsService);
  });

  describe('evaluate', () => {
    it("rejects a project outside the caller's org, before ever loading the trace", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        evaluationsService.evaluate(
          'org-1',
          'someone-elses-project',
          'trace-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(tracesService.findOwnedTrace).not.toHaveBeenCalled();
      expect(evaluationWorkerClient.evaluate).not.toHaveBeenCalled();
    });

    it('rejects a trace that belongs to a different project', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      tracesService.findOwnedTrace.mockRejectedValue(
        new NotFoundException('Trace not found'),
      );

      await expect(
        evaluationsService.evaluate('org-1', 'project-1', 'trace-1'),
      ).rejects.toThrow(NotFoundException);
      expect(evaluationWorkerClient.evaluate).not.toHaveBeenCalled();
    });

    it('builds a snapshot from the trace and its spans, sends it to the worker, and persists the result', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      tracesService.findOwnedTrace.mockResolvedValue(fakeTraceRow());
      prisma.span.findMany.mockResolvedValue([]);
      evaluationWorkerClient.evaluate.mockResolvedValue({
        score: 4,
        rationale: 'Looks correct.',
        judgeModel: 'gemini-3-flash-preview',
        evaluatorVersion: 'judge-v1',
      });
      prisma.evalResult.create.mockResolvedValue(fakeEvalResultRow());

      const result = await evaluationsService.evaluate(
        'org-1',
        'project-1',
        'trace-1',
      );

      expect(evaluationWorkerClient.evaluate).toHaveBeenCalledTimes(1);
      const calls = evaluationWorkerClient.evaluate.mock.calls as {
        trace: { name: string };
      }[][];
      const snapshotSentToWorker = calls[0][0];
      expect(snapshotSentToWorker.trace.name).toBe('run');

      expect(prisma.evalResult.create).toHaveBeenCalledWith({
        data: {
          traceId: 'trace-1',
          score: 4,
          rationale: 'Looks correct.',
          judgeModel: 'gemini-3-flash-preview',
          evaluatorVersion: 'judge-v1',
          evaluationInput: snapshotSentToWorker,
        },
      });

      expect(result.id).toBe('eval-1');
      expect(result.score).toBe(4);
      // Date fields mapped to ISO strings, same discipline as every
      // other record type (ADR-0011).
      expect(result.createdAt).toBe('2026-01-01T00:05:00.000Z');
      expect(typeof result.createdAt).toBe('string');
    });

    it('does not persist anything if the worker call fails', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      tracesService.findOwnedTrace.mockResolvedValue(fakeTraceRow());
      prisma.span.findMany.mockResolvedValue([]);
      evaluationWorkerClient.evaluate.mockRejectedValue(
        new Error('worker unreachable'),
      );

      await expect(
        evaluationsService.evaluate('org-1', 'project-1', 'trace-1'),
      ).rejects.toThrow('worker unreachable');
      expect(prisma.evalResult.create).not.toHaveBeenCalled();
    });
  });

  describe('listForTrace', () => {
    it("rejects a project outside the caller's org", async () => {
      projectsService.findOwnedProject.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        evaluationsService.listForTrace(
          'org-1',
          'someone-elses-project',
          'trace-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.evalResult.findMany).not.toHaveBeenCalled();
    });

    it('returns evaluation history newest first, mapped to ISO strings', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      tracesService.findOwnedTrace.mockResolvedValue(fakeTraceRow());
      prisma.evalResult.findMany.mockResolvedValue([
        fakeEvalResultRow({ id: 'eval-2' }),
        fakeEvalResultRow({ id: 'eval-1' }),
      ]);

      const result = await evaluationsService.listForTrace(
        'org-1',
        'project-1',
        'trace-1',
      );

      expect(result.map((r) => r.id)).toEqual(['eval-2', 'eval-1']);
      expect(prisma.evalResult.findMany).toHaveBeenCalledWith({
        where: { traceId: 'trace-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns an empty array for a trace with no evaluations yet', async () => {
      projectsService.findOwnedProject.mockResolvedValue({ id: 'project-1' });
      tracesService.findOwnedTrace.mockResolvedValue(fakeTraceRow());
      prisma.evalResult.findMany.mockResolvedValue([]);

      const result = await evaluationsService.listForTrace(
        'org-1',
        'project-1',
        'trace-1',
      );

      expect(result).toEqual([]);
    });
  });
});
