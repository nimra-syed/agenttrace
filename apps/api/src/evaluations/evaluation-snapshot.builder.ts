import type { Span, Trace } from '../../generated/prisma/client.js';

// Bounds on the evidence sent to the judge. Not primarily about fitting
// a context window (Gemini flash-tier models have a huge one) -- about
// bounding cost (input tokens are billed), latency, and keeping the
// judge focused on the most relevant evidence rather than everything a
// long-running agent ever did. See ADR-0016.
export const MAX_SPANS = 20;
export const MAX_FIELD_CHARS = 2000;
export const MAX_TOTAL_SNAPSHOT_CHARS = 20000;

export interface EvaluationSpanEvidence {
  name: string;
  type: string;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
}

// The exact bounded evidence sent to apps/eval-worker, and the exact
// shape persisted as EvalResult.evaluationInput for that result (not a
// reference to the trace/spans as they exist now). See ADR-0016 and
// /contracts/evaluation-request.example.json, which apps/eval-worker's
// own tests validate against the same fixture.
export interface EvaluationSnapshot {
  trace: {
    name: string;
    agentName: string;
    status: string;
    input: string | null;
    output: string | null;
    error: string | null;
  };
  spans: EvaluationSpanEvidence[];
  truncated: boolean;
  omittedSpanCount: number;
}

// input/output are `unknown` (Prisma Json?) on both Trace and Span, so
// this always stringifies first: truncation is a text-length concept,
// and a value truncated at a raw character boundary may no longer be
// valid JSON (e.g. `{"foo": "b` cut off mid-string). That's fine --
// apps/eval-worker only ever renders these as evidence text in a
// prompt, never re-parses them as JSON.
function truncateField(value: unknown): {
  text: string | null;
  wasTruncated: boolean;
} {
  if (value == null) return { text: null, wasTruncated: false };
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= MAX_FIELD_CHARS) return { text, wasTruncated: false };
  return {
    text: `${text.slice(0, MAX_FIELD_CHARS)}\n[truncated: showing ${MAX_FIELD_CHARS} of ${text.length} characters]`,
    wasTruncated: true,
  };
}

// Spans are re-sorted here rather than trusted to already be in order:
// this function's output feeds directly into what gets judged and
// permanently stored (EvalResult.evaluationInput), so its correctness
// shouldn't depend on every caller remembering to pre-sort, and a
// self-contained sort makes this straightforward to unit test with
// arbitrarily-ordered fixtures.
function sortSpans(spans: Span[]): Span[] {
  return [...spans].sort((a, b) => {
    const diff = a.startedAt.getTime() - b.startedAt.getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function isSpanEvidence(value: unknown): value is EvaluationSpanEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.status === 'string' &&
    (record.input === null || typeof record.input === 'string') &&
    (record.output === null || typeof record.output === 'string') &&
    (record.error === null || typeof record.error === 'string')
  );
}

// Exported for the shared-fixture contract test (contract.spec.ts) --
// this is the same shape check this function's own output must satisfy,
// used to confirm /contracts/evaluation-request.example.json still
// matches what this side actually produces/expects.
export function isEvaluationSnapshot(
  value: unknown,
): value is EvaluationSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.trace !== 'object' || record.trace === null) return false;
  const trace = record.trace as Record<string, unknown>;
  const traceValid =
    typeof trace.name === 'string' &&
    typeof trace.agentName === 'string' &&
    typeof trace.status === 'string' &&
    (trace.input === null || typeof trace.input === 'string') &&
    (trace.output === null || typeof trace.output === 'string') &&
    (trace.error === null || typeof trace.error === 'string');
  return (
    traceValid &&
    Array.isArray(record.spans) &&
    record.spans.every(isSpanEvidence) &&
    typeof record.truncated === 'boolean' &&
    typeof record.omittedSpanCount === 'number'
  );
}

export function buildEvaluationSnapshot(
  trace: Trace,
  spans: Span[],
): EvaluationSnapshot {
  const traceInput = truncateField(trace.input);
  const traceOutput = truncateField(trace.output);
  const traceError = truncateField(trace.error);

  const orderedSpans = sortSpans(spans);
  const includedSpans = orderedSpans.slice(0, MAX_SPANS);
  let omittedSpanCount = Math.max(0, orderedSpans.length - MAX_SPANS);

  let fieldTruncated =
    traceInput.wasTruncated ||
    traceOutput.wasTruncated ||
    traceError.wasTruncated;

  const spanEvidence: EvaluationSpanEvidence[] = includedSpans.map((span) => {
    const input = truncateField(span.input);
    const output = truncateField(span.output);
    const error = truncateField(span.error);
    if (input.wasTruncated || output.wasTruncated || error.wasTruncated) {
      fieldTruncated = true;
    }
    return {
      name: span.name,
      type: span.type,
      status: span.status,
      input: input.text,
      output: output.text,
      error: error.text,
    };
  });

  let snapshot: EvaluationSnapshot = {
    trace: {
      name: trace.name,
      agentName: trace.agentName,
      status: trace.status,
      input: traceInput.text,
      output: traceOutput.text,
      error: traceError.text,
    },
    spans: spanEvidence,
    truncated: fieldTruncated || omittedSpanCount > 0,
    omittedSpanCount,
  };

  // Final backstop: per-field and per-span-count bounds should already
  // keep this well under the ceiling, but drop trailing spans (already
  // the lowest-priority evidence, since spans are chronologically
  // ordered and truncation always keeps the earliest ones) until the
  // whole snapshot fits, rather than trusting the earlier bounds alone.
  while (
    JSON.stringify(snapshot).length > MAX_TOTAL_SNAPSHOT_CHARS &&
    snapshot.spans.length > 0
  ) {
    snapshot = {
      ...snapshot,
      spans: snapshot.spans.slice(0, -1),
      omittedSpanCount: omittedSpanCount + 1,
      truncated: true,
    };
    omittedSpanCount += 1;
  }

  return snapshot;
}
