import { HttpTransport } from './http.js';
import { runTrace, type TraceContext, type TraceInfo } from './trace-context.js';

const DEFAULT_TIMEOUT_MS = 5000;

export interface AgentTraceClientOptions {
  apiKey: string;
  baseUrl: string;
  // Bounded so a slow or unresponsive AgentTrace instance can never hang
  // the caller's own application, which would defeat fail-open. Defaults
  // to 5 seconds. See ADR-0009.
  timeoutMs?: number;
}

export class AgentTraceClient {
  private readonly http: HttpTransport;

  constructor(options: AgentTraceClientOptions) {
    this.http = new HttpTransport({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  trace<T>(
    info: TraceInfo,
    fn: (trace: TraceContext) => Promise<T>,
  ): Promise<T> {
    return runTrace(this.http, info, fn);
  }
}
