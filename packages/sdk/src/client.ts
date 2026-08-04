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
    // Checked here, not left to fail later inside HttpTransport: a
    // missing baseUrl previously reached `.replace()` on `undefined`,
    // a confusing crash pointing at the wrong line for whoever hit it.
    // Both fields are required by the type, but a caller building
    // `options` from `process.env` (exactly what the generated
    // agenttrace.ts/.js scaffold does) can still end up with `undefined`
    // at runtime despite what the type claims.
    if (!options.apiKey) {
      throw new Error(
        "AgentTraceClient: `apiKey` is required but was empty or missing. Check that AGENTTRACE_API_KEY is set before constructing the client.",
      );
    }
    if (!options.baseUrl) {
      throw new Error(
        "AgentTraceClient: `baseUrl` is required but was empty or missing. Check that AGENTTRACE_BASE_URL is set before constructing the client.",
      );
    }

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
