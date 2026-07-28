// Wire-format types shared between apps/api (request/response bodies),
// packages/sdk (what it sends and parses), and eventually apps/web (what
// it renders). These describe JSON over HTTP, not database rows: every
// timestamp is an ISO 8601 string, since JSON has no native Date type.
// Prisma's generated types stay internal to apps/api and are never
// imported from here.

export type TraceStatus = 'RUNNING' | 'SUCCESS' | 'ERROR';
export type SpanType = 'LLM' | 'TOOL' | 'RETRIEVAL' | 'CUSTOM';
export type SpanStatus = 'RUNNING' | 'SUCCESS' | 'ERROR';

// The body of POST /traces. Matches apps/api's CreateTraceDto, which
// `implements` this interface as a compile-time guarantee the two stay in
// sync. That `implements` relationship is a shape check only; the actual
// runtime validation of incoming JSON is still done by CreateTraceDto's
// class-validator decorators, not by this type.
export interface CreateTracePayload {
  externalTraceId?: string;
  name: string;
  agentName: string;
  status?: TraceStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  metadata?: unknown;
}

// The body of POST /traces/:traceId/spans. Matches CreateSpanDto, same
// implements-as-shape-check relationship as above.
export interface CreateSpanPayload {
  externalSpanId?: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  status?: SpanStatus;
  input?: unknown;
  output?: unknown;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  error?: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number;
  metadata?: unknown;
}

// What POST /traces returns. Used by the SDK to read back the
// server-assigned id, and reusable by the dashboard later instead of
// being redefined there.
export interface TraceRecord {
  id: string;
  projectId: string;
  externalTraceId: string | null;
  name: string;
  agentName: string;
  status: TraceStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalCostUsd: number | null;
  metadata: unknown;
  createdAt: string;
}

// What POST /traces/:traceId/spans returns.
export interface SpanRecord {
  id: string;
  traceId: string;
  externalSpanId: string | null;
  parentSpanId: string | null;
  name: string;
  type: SpanType;
  status: SpanStatus;
  input: unknown;
  output: unknown;
  model: string | null;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  metadata: unknown;
  createdAt: string;
}
