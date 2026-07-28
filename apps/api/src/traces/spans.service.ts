import { BadRequestException, Injectable } from '@nestjs/common';
import { SpanStatus } from '../../generated/prisma/client.js';
import { toJsonInput } from '../common/json-input.util';
import { toDateOrPassthrough } from '../common/optional-date.util';
import { assertValidTimeRange } from '../common/validate-time-range.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpanDto } from './dto/create-span.dto';
import { TracesService } from './traces.service';

@Injectable()
export class SpansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracesService: TracesService,
  ) {}

  async upsert(projectId: string, traceId: string, dto: CreateSpanDto) {
    await this.tracesService.findOwnedTrace(projectId, traceId);

    const startedAt = new Date(dto.startedAt);
    const endedAt = toDateOrPassthrough(dto.endedAt);
    assertValidTimeRange(startedAt, endedAt);

    if (dto.parentSpanId) {
      await this.assertValidParent(
        traceId,
        dto.parentSpanId,
        dto.externalSpanId,
      );
    }

    const sharedData = {
      name: dto.name,
      type: dto.type,
      parentSpanId: dto.parentSpanId,
      input: toJsonInput(dto.input),
      output: toJsonInput(dto.output),
      model: dto.model,
      provider: dto.provider,
      promptTokens: dto.promptTokens,
      completionTokens: dto.completionTokens,
      costUsd: dto.costUsd,
      error: dto.error,
      startedAt,
      endedAt,
      durationMs: dto.durationMs,
      metadata: toJsonInput(dto.metadata),
    };

    if (!dto.externalSpanId) {
      return this.prisma.span.create({
        data: {
          traceId,
          status: dto.status ?? SpanStatus.RUNNING,
          ...sharedData,
        },
      });
    }

    return this.prisma.span.upsert({
      where: {
        traceId_externalSpanId: { traceId, externalSpanId: dto.externalSpanId },
      },
      create: {
        traceId,
        externalSpanId: dto.externalSpanId,
        status: dto.status ?? SpanStatus.RUNNING,
        ...sharedData,
      },
      update: {
        status: dto.status,
        ...sharedData,
      },
    });
  }

  // parentSpanId must reference an already-ingested span (parent-first
  // ingestion, see ADR-0008) belonging to the same trace, and must not
  // reference the span being written itself. The self-parent check only
  // applies when this call is updating an existing span (found by
  // externalSpanId); a brand-new span's id cannot be predicted by the
  // client in advance, so self-parenting is structurally impossible on a
  // pure create.
  private async assertValidParent(
    traceId: string,
    parentSpanId: string,
    externalSpanId: string | undefined,
  ): Promise<void> {
    if (externalSpanId) {
      const existing = await this.prisma.span.findUnique({
        where: { traceId_externalSpanId: { traceId, externalSpanId } },
      });
      if (existing && existing.id === parentSpanId) {
        throw new BadRequestException('A span cannot be its own parent');
      }
    }

    const parent = await this.prisma.span.findUnique({
      where: { id: parentSpanId },
    });
    if (!parent || parent.traceId !== traceId) {
      throw new BadRequestException(
        'parentSpanId must reference an already-ingested span in this trace',
      );
    }
  }
}
