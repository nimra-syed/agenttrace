import type { TraceRecord } from '@agenttrace/shared-types';
import type { Trace } from '../../generated/prisma/client.js';

// Prisma's Trace model uses Date (not string) and Decimal (not number)
// internally. Neither serializes to JSON the way TraceRecord's wire
// format promises: a bare Date would still come out as an ISO string by
// luck (Date.prototype.toJSON), but Decimal serializes to a JSON
// *string* (e.g. "12.34"), not a number, confirmed directly while
// building this endpoint (see ADR-0011). Returning Prisma's row as-is
// would silently break the totalCostUsd: number contract.
export function toTraceRecord(trace: Trace): TraceRecord {
  return {
    id: trace.id,
    projectId: trace.projectId,
    externalTraceId: trace.externalTraceId,
    name: trace.name,
    agentName: trace.agentName,
    status: trace.status,
    input: trace.input,
    output: trace.output,
    error: trace.error,
    startedAt: trace.startedAt.toISOString(),
    endedAt: trace.endedAt ? trace.endedAt.toISOString() : null,
    durationMs: trace.durationMs,
    totalTokens: trace.totalTokens,
    totalCostUsd: trace.totalCostUsd ? trace.totalCostUsd.toNumber() : null,
    metadata: trace.metadata,
    createdAt: trace.createdAt.toISOString(),
  };
}
