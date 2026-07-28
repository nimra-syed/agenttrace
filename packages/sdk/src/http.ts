import type {
  CreateSpanPayload,
  CreateTracePayload,
  SpanRecord,
  TraceRecord,
} from '@agenttrace/shared-types';

export interface HttpTransportOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

// A warning can only ever describe *what kind* of failure happened, never
// carry request/response content. This is enforced by the type itself,
// not just a convention, so a call site cannot accidentally pass through
// the API key, a header, or captured application data. See ADR-0009.
type WarnReason =
  | { kind: 'timeout' }
  | { kind: 'network-error' }
  | { kind: 'http-error'; status: number }
  | { kind: 'invalid-response' };

function logWarning(operation: string, reason: WarnReason): void {
  switch (reason.kind) {
    case 'timeout':
      console.warn(`[agenttrace] ${operation} failed: timed out`);
      return;
    case 'network-error':
      console.warn(`[agenttrace] ${operation} failed: network error`);
      return;
    case 'http-error':
      console.warn(`[agenttrace] ${operation} failed: HTTP ${reason.status}`);
      return;
    case 'invalid-response':
      console.warn(`[agenttrace] ${operation} failed: invalid response`);
      return;
  }
}

// Fail-open, always. Every method here catches its own failures, warns
// (safely, see above), and resolves to undefined rather than throwing, so
// a caller never needs its own try/catch around a transport call. Timeout
// is enforced with an explicit AbortController so an unresponsive server
// can never hang the caller's own code, which would defeat the point of
// fail-open. See ADR-0009.
export class HttpTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: HttpTransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
  }

  postTrace(payload: CreateTracePayload): Promise<TraceRecord | undefined> {
    return this.postJson<TraceRecord>('trace', '/traces', payload);
  }

  postSpan(
    traceId: string,
    payload: CreateSpanPayload,
  ): Promise<SpanRecord | undefined> {
    return this.postJson<SpanRecord>(
      'span',
      `/traces/${encodeURIComponent(traceId)}/spans`,
      payload,
    );
  }

  private async postJson<T>(
    operation: string,
    path: string,
    payload: unknown,
  ): Promise<T | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError';
      logWarning(operation, { kind: isAbort ? 'timeout' : 'network-error' });
      return undefined;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      logWarning(operation, { kind: 'http-error', status: response.status });
      return undefined;
    }

    try {
      return (await response.json()) as T;
    } catch {
      logWarning(operation, { kind: 'invalid-response' });
      return undefined;
    }
  }
}
