import { Injectable, NotFoundException } from '@nestjs/common';
import { TraceStatus } from '../../generated/prisma/client.js';
import { toJsonInput } from '../common/json-input.util';
import { toDateOrPassthrough } from '../common/optional-date.util';
import { assertValidTimeRange } from '../common/validate-time-range.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTraceDto } from './dto/create-trace.dto';

@Injectable()
export class TracesService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(projectId: string, dto: CreateTraceDto) {
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
      return this.prisma.trace.create({
        data: {
          projectId,
          status: dto.status ?? TraceStatus.RUNNING,
          ...sharedData,
        },
      });
    }

    return this.prisma.trace.upsert({
      where: {
        projectId_externalTraceId: {
          projectId,
          externalTraceId: dto.externalTraceId,
        },
      },
      create: {
        projectId,
        externalTraceId: dto.externalTraceId,
        status: dto.status ?? TraceStatus.RUNNING,
        ...sharedData,
      },
      update: {
        status: dto.status,
        ...sharedData,
      },
    });
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
}
