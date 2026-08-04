import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ListTracesResponse,
  TraceDetailResponse,
  TraceRecord,
} from '@agenttraceai/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { TraceStatus } from '../../generated/prisma/client.js';
import { toJsonInput } from '../common/json-input.util';
import { toDateOrPassthrough } from '../common/optional-date.util';
import { assertValidTimeRange } from '../common/validate-time-range.util';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { decodeCursor, encodeCursor } from './cursor.util';
import { CreateTraceDto } from './dto/create-trace.dto';
import { DEFAULT_LIMIT, ListTracesDto } from './dto/list-traces.dto';
import { toSpanRecord } from './span-record.mapper';
import { toTraceRecord } from './trace-record.mapper';

@Injectable()
export class TracesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  // installationId is only ever set on the create branches below, never
  // on update: it records who created this trace record, not who last
  // touched it. undefined (ApiKey-authenticated ingestion) writes NULL
  // on create, same Prisma undefined-vs-null behavior ADR-0008 already
  // documents for every other optional field here. See ADR-0017.
  async upsert(
    projectId: string,
    dto: CreateTraceDto,
    installationId?: string,
  ): Promise<TraceRecord> {
    const startedAt = new Date(dto.startedAt);
    const endedAt = toDateOrPassthrough(dto.endedAt);
    assertValidTimeRange(startedAt, endedAt);

    // Shared by both branches below. None of these fields have a
    // meaningful database default besides status (handled separately),
    // so a field the client omitted (undefined) is safe to pass through
    // as-is: Prisma treats undefined as "don't touch this column" on
    // update, and as "write NULL" on create, either of which is correct
    // here. An explicit null overwrites the column either way. See
    // ADR-0008.
    const sharedData = {
      name: dto.name,
      agentName: dto.agentName,
      input: toJsonInput(dto.input),
      output: toJsonInput(dto.output),
      error: dto.error,
      startedAt,
      endedAt,
      durationMs: dto.durationMs,
      totalTokens: dto.totalTokens,
      totalCostUsd: dto.totalCostUsd,
      metadata: toJsonInput(dto.metadata),
    };

    if (!dto.externalTraceId) {
      const trace = await this.prisma.trace.create({
        data: {
          projectId,
          installationId,
          status: dto.status ?? TraceStatus.RUNNING,
          ...sharedData,
        },
      });
      return toTraceRecord(trace);
    }

    const trace = await this.prisma.trace.upsert({
      where: {
        projectId_externalTraceId: {
          projectId,
          externalTraceId: dto.externalTraceId,
        },
      },
      create: {
        projectId,
        installationId,
        externalTraceId: dto.externalTraceId,
        status: dto.status ?? TraceStatus.RUNNING,
        ...sharedData,
      },
      update: {
        status: dto.status,
        ...sharedData,
      },
    });
    return toTraceRecord(trace);
  }

  // Used by SpansService to confirm a traceId in a URL actually belongs to
  // the project the caller's API key authenticates for. Same 404-not-403
  // reasoning as ProjectsService.findOwnedProject.
  async findOwnedTrace(projectId: string, traceId: string) {
    const trace = await this.prisma.trace.findUnique({
      where: { id: traceId },
    });
    if (!trace || trace.projectId !== projectId) {
      throw new NotFoundException('Trace not found');
    }
    return trace;
  }

  // Session-authenticated (a person viewing a dashboard), not API-key
  // authenticated, so projectId comes from the URL and has to be
  // checked against the caller's org, same as every other
  // /projects/:projectId/... route.
  async list(
    orgId: string,
    projectId: string,
    query: ListTracesDto,
  ): Promise<ListTracesResponse> {
    await this.projectsService.findOwnedProject(orgId, projectId);

    const limit = query.limit ?? DEFAULT_LIMIT;

    const startedAtFilter: Prisma.DateTimeFilter | undefined =
      query.from || query.to
        ? {
            gte: query.from ? new Date(query.from) : undefined,
            lte: query.to ? new Date(query.to) : undefined,
          }
        : undefined;

    const where: Prisma.TraceWhereInput = {
      projectId,
      status: query.status,
      agentName: query.agentName
        ? { contains: query.agentName, mode: 'insensitive' }
        : undefined,
      startedAt: startedAtFilter,
    };

    // Keyset pagination: "give me the next rows older than this exact
    // (startedAt, id) I already saw," expressed as an OR of two
    // conditions, since Prisma has no direct row-value comparison
    // syntax. This is ANDed with every filter above, it only narrows
    // which page we're on, it doesn't change what's being filtered for.
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      where.OR = [
        { startedAt: { lt: cursor.startedAt } },
        { startedAt: cursor.startedAt, id: { lt: cursor.id } },
      ];
    }

    // Fetch one extra row, past the page size, purely to know whether a
    // next page exists, without a separate count query.
    const rows = await this.prisma.trace.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page[page.length - 1];

    return {
      items: page.map(toTraceRecord),
      nextCursor:
        hasMore && lastRow ? encodeCursor(lastRow.startedAt, lastRow.id) : null,
    };
  }

  // Session-authenticated (a person viewing one run's detail), same org
  // scoping as list(). Spans come back flat, ordered chronologically
  // (startedAt asc, id asc, the same deterministic-tiebreaker reasoning
  // as list()'s cursor order, just ascending instead of descending: a
  // waterfall reads top to bottom in the order things happened).
  // Building the parent/child tree from parentSpanId is left to the
  // frontend, see TraceDetailResponse in packages/shared-types.
  async getDetail(
    orgId: string,
    projectId: string,
    traceId: string,
  ): Promise<TraceDetailResponse> {
    await this.projectsService.findOwnedProject(orgId, projectId);
    const trace = await this.findOwnedTrace(projectId, traceId);

    const spans = await this.prisma.span.findMany({
      where: { traceId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });

    return {
      trace: toTraceRecord(trace),
      spans: spans.map(toSpanRecord),
    };
  }
}
