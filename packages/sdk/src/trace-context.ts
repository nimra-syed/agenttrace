import type { SpanType } from '@agenttrace/shared-types';
import { normalizeError } from './errors.js';
import { HttpTransport } from './http.js';

export interface TraceInfo {
  name: string;
  agentName: string;
  input?: unknown;
}

export interface SpanInfo {
  name: string;
  type: SpanType;
  input?: unknown;
}

export interface UsageInfo {
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

export interface SpanContext {
  setOutput(value: unknown): void;
  recordUsage(usage: UsageInfo): void;
  span<T>(info: SpanInfo, fn: (span: SpanContext) => Promise<T>): Promise<T>;
}

export interface TraceContext {
  setOutput(value: unknown): void;
  span<T>(info: SpanInfo, fn: (span: SpanContext) => Promise<T>): Promise<T>;
}

// Output and usage are only ever populated by an explicit call
// (setOutput / recordUsage), never captured automatically from a
// callback's return value. See ADR-0009: a return value can contain
// secrets, private data, circular references, or be very large, none of
// which should be sent just because a function happened to return it.
class MutableRecordState {
  private output: unknown;
  private hasOutput = false;
  usage: UsageInfo = {};

  setOutput(value: unknown): void {
    this.output = value;
    this.hasOutput = true;
  }

  recordUsage(usage: UsageInfo): void {
    this.usage = { ...this.usage, ...usage };
  }

  getOutput(): unknown {
    return this.hasOutput ? this.output : undefined;
  }
}

export async function runTrace<T>(
  http: HttpTransport,
  info: TraceInfo,
  fn: (trace: TraceContext) => Promise<T>,
): Promise<T> {
  const externalTraceId = crypto.randomUUID();
  const startedAtWall = new Date();
  const startedAtMono = performance.now();

  // Reporting at start, not just at the end, means a trace that never
  // finishes (the process hangs or crashes) still shows up as a stuck
  // RUNNING trace instead of not existing at all. See ADR-0009.
  const startRecord = await http.postTrace({
    externalTraceId,
    name: info.name,
    agentName: info.agentName,
    input: info.input,
    startedAt: startedAtWall.toISOString(),
  });
  // May be undefined if the start call failed, timed out, or the response
  // couldn't be parsed. Everything below still works either way: spans
  // for this trace are skipped without a confirmed id (see runSpan), and
  // the end call below never depends on this having succeeded.
  const traceServerId = startRecord?.id;

  const state = new MutableRecordState();
  const context: TraceContext = {
    setOutput: (value) => state.setOutput(value),
    span: (spanInfo, spanFn) =>
      runSpan(http, traceServerId, undefined, spanInfo, spanFn),
  };

  try {
    const result = await fn(context);
    await finishTrace(http, externalTraceId, info, startedAtWall, startedAtMono, {
      status: 'SUCCESS',
      output: state.getOutput(),
    });
    return result;
  } catch (err) {
    await finishTrace(http, externalTraceId, info, startedAtWall, startedAtMono, {
      status: 'ERROR',
      output: state.getOutput(),
      error: normalizeError(err),
    });
    throw err;
  }
}

async function finishTrace(
  http: HttpTransport,
  externalTraceId: string,
  info: TraceInfo,
  startedAtWall: Date,
  startedAtMono: number,
  outcome: { status: 'SUCCESS' | 'ERROR'; output: unknown; error?: string },
): Promise<void> {
  const endedAtWall = new Date();
  const durationMs = Math.round(performance.now() - startedAtMono);

  // This call is self-sufficient: it includes everything needed to
  // create a complete row on its own, not just an update. We cannot
  // assume the start call above actually reached the server (it may have
  // failed, or timed out without telling us whether the server processed
  // it anyway), so this must not depend on that having worked. See
  // ADR-0009.
  await http.postTrace({
    externalTraceId,
    name: info.name,
    agentName: info.agentName,
    input: info.input,
    status: outcome.status,
    output: outcome.output,
    error: outcome.error,
    startedAt: startedAtWall.toISOString(),
    endedAt: endedAtWall.toISOString(),
    durationMs,
  });
}

async function runSpan<T>(
  http: HttpTransport,
  traceServerId: string | undefined,
  parentServerId: string | undefined,
  info: SpanInfo,
  fn: (span: SpanContext) => Promise<T>,
): Promise<T> {
  if (!traceServerId) {
    // The trace's own start call never confirmed a server id, so there is
    // no valid URL to report a span against (POST /traces/:traceId/spans
    // needs a real id, not the external one). Run the real code
    // unaffected; only telemetry for this span and everything nested
    // under it is skipped. See ADR-0009.
    const noopContext: SpanContext = {
      setOutput: () => undefined,
      recordUsage: () => undefined,
      span: (childInfo, childFn) =>
        runSpan(http, undefined, undefined, childInfo, childFn),
    };
    return fn(noopContext);
  }

  const externalSpanId = crypto.randomUUID();
  const startedAtWall = new Date();
  const startedAtMono = performance.now();

  const startRecord = await http.postSpan(traceServerId, {
    externalSpanId,
    parentSpanId: parentServerId,
    name: info.name,
    type: info.type,
    input: info.input,
    startedAt: startedAtWall.toISOString(),
  });
  // A child span only gets a parent reference if this span's start call
  // confirmed a server id. If it didn't, the child is still reported,
  // just without a parentSpanId, a flatter tree rather than lost data.
  // See ADR-0009.
  const spanServerId = startRecord?.id;

  const state = new MutableRecordState();
  const context: SpanContext = {
    setOutput: (value) => state.setOutput(value),
    recordUsage: (usage) => state.recordUsage(usage),
    span: (childInfo, childFn) =>
      runSpan(http, traceServerId, spanServerId, childInfo, childFn),
  };

  try {
    const result = await fn(context);
    await finishSpan(
      http,
      traceServerId,
      externalSpanId,
      parentServerId,
      info,
      startedAtWall,
      startedAtMono,
      { status: 'SUCCESS', output: state.getOutput(), usage: state.usage },
    );
    return result;
  } catch (err) {
    await finishSpan(
      http,
      traceServerId,
      externalSpanId,
      parentServerId,
      info,
      startedAtWall,
      startedAtMono,
      {
        status: 'ERROR',
        output: state.getOutput(),
        usage: state.usage,
        error: normalizeError(err),
      },
    );
    throw err;
  }
}

async function finishSpan(
  http: HttpTransport,
  traceServerId: string,
  externalSpanId: string,
  parentServerId: string | undefined,
  info: SpanInfo,
  startedAtWall: Date,
  startedAtMono: number,
  outcome: {
    status: 'SUCCESS' | 'ERROR';
    output: unknown;
    usage: UsageInfo;
    error?: string;
  },
): Promise<void> {
  const endedAtWall = new Date();
  const durationMs = Math.round(performance.now() - startedAtMono);

  // Self-sufficient for the same reason as finishTrace above: this call
  // does not assume the span's start call reached the server.
  await http.postSpan(traceServerId, {
    externalSpanId,
    parentSpanId: parentServerId,
    name: info.name,
    type: info.type,
    input: info.input,
    status: outcome.status,
    output: outcome.output,
    error: outcome.error,
    startedAt: startedAtWall.toISOString(),
    endedAt: endedAtWall.toISOString(),
    durationMs,
    model: outcome.usage.model,
    provider: outcome.usage.provider,
    promptTokens: outcome.usage.promptTokens,
    completionTokens: outcome.usage.completionTokens,
    costUsd: outcome.usage.costUsd,
  });
}
