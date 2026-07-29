import type { SpanRecord } from '@agenttrace/shared-types';
import type { Span } from '../../generated/prisma/client.js';

// Same reasoning as toTraceRecord: Prisma's Decimal (costUsd) serializes
// to a JSON string, not the number SpanRecord promises. See ADR-0011.
export function toSpanRecord(span: Span): SpanRecord {
  return {
    id: span.id,
    traceId: span.traceId,
    externalSpanId: span.externalSpanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    type: span.type,
    status: span.status,
    input: span.input,
    output: span.output,
    model: span.model,
    provider: span.provider,
    promptTokens: span.promptTokens,
    completionTokens: span.completionTokens,
    costUsd: span.costUsd ? span.costUsd.toNumber() : null,
    error: span.error,
    startedAt: span.startedAt.toISOString(),
    endedAt: span.endedAt ? span.endedAt.toISOString() : null,
    durationMs: span.durationMs,
    metadata: span.metadata,
    createdAt: span.createdAt.toISOString(),
  };
}
