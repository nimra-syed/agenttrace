import { Injectable } from '@nestjs/common';
import type { EvalResultRecord } from '@agenttraceai/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { TracesService } from '../traces/traces.service';
import { toEvalResultRecord } from './eval-result-record.mapper';
import { buildEvaluationSnapshot } from './evaluation-snapshot.builder';
import { EvaluationWorkerClient } from './evaluation-worker.client';

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly tracesService: TracesService,
    private readonly evaluationWorkerClient: EvaluationWorkerClient,
  ) {}

  // Session-authenticated (a dashboard user triggering a real, paid LLM
  // call), same org/project/trace ownership chain as
  // TracesService.getDetail. See ADR-0016.
  async evaluate(
    orgId: string,
    projectId: string,
    traceId: string,
  ): Promise<EvalResultRecord> {
    await this.projectsService.findOwnedProject(orgId, projectId);
    const trace = await this.tracesService.findOwnedTrace(projectId, traceId);

    const spans = await this.prisma.span.findMany({
      where: { traceId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });

    const snapshot = buildEvaluationSnapshot(trace, spans);
    const judgment = await this.evaluationWorkerClient.evaluate(snapshot);

    // Known, accepted gap for this first slice (no queue, no outbox): if
    // the LLM call above succeeded but this write fails (a transient DB
    // error, the process crashing mid-request), the paid call is lost --
    // not persisted, not shown to the user, and not automatically
    // retried (see EvaluationWorkerClient's no-retry reasoning). A
    // person can just click "Evaluate" again; fixing this properly would
    // need a queue or outbox pattern, deliberately deferred. See
    // ADR-0016.
    const evalResult = await this.prisma.evalResult.create({
      data: {
        traceId,
        score: judgment.score,
        rationale: judgment.rationale,
        judgeModel: judgment.judgeModel,
        evaluatorVersion: judgment.evaluatorVersion,
        evaluationInput: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    return toEvalResultRecord(evalResult);
  }

  async listForTrace(
    orgId: string,
    projectId: string,
    traceId: string,
  ): Promise<EvalResultRecord[]> {
    await this.projectsService.findOwnedProject(orgId, projectId);
    await this.tracesService.findOwnedTrace(projectId, traceId);

    const rows = await this.prisma.evalResult.findMany({
      where: { traceId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toEvalResultRecord);
  }
}
