import type { SpanRecord, TraceRecord } from "@agenttrace/shared-types";
import { CollapsiblePayload } from "./collapsible-payload";

interface SpanNode {
  span: SpanRecord;
  children: SpanNode[];
}

// Rendering recurses per tree level; this bounds both the recursion
// depth and the indentation, so a very deep (or maliciously deep) chain
// can't blow the call stack or push content off-screen. Real traces are
// nowhere near this deep, it's a safety margin, not a expected case.
const MAX_TREE_DEPTH = 50;

// Walks a span's parentSpanId chain looking for a repeat. If `spanId`
// ever shows up again as its own ancestor, attaching it under its
// stated parent would create a cycle, which would make a naive
// recursive render loop forever.
function isOwnAncestor(
  spanId: string,
  spanById: Map<string, SpanRecord>,
): boolean {
  const seen = new Set<string>([spanId]);
  let parentId = spanById.get(spanId)?.parentSpanId ?? null;
  while (parentId) {
    if (seen.has(parentId)) return true;
    seen.add(parentId);
    parentId = spanById.get(parentId)?.parentSpanId ?? null;
  }
  return false;
}

// Two-pass on purpose: every span becomes a node in the first pass, so
// the second pass can attach a child to its parent regardless of which
// one appears first in the (chronologically ordered, not tree-ordered)
// input array. A span is treated as a root, not dropped, whenever
// attaching it under its stated parent wouldn't produce a valid tree:
// parentSpanId is missing from this trace, points to itself, or would
// close a cycle. `spans` already arrives sorted (startedAt asc, id asc)
// from the API, and pushing preserves that order, so neither roots nor
// any children array needs re-sorting.
function buildSpanTree(spans: SpanRecord[]): SpanNode[] {
  const spanById = new Map(spans.map((span) => [span.id, span]));
  const nodeById = new Map<string, SpanNode>();
  for (const span of spans) {
    nodeById.set(span.id, { span, children: [] });
  }

  const roots: SpanNode[] = [];
  for (const span of spans) {
    const node = nodeById.get(span.id)!;
    const parentId = span.parentSpanId;
    const parentNode = parentId ? nodeById.get(parentId) : undefined;
    const wouldCycle =
      parentId != null &&
      (parentId === span.id || isOwnAncestor(span.id, spanById));

    if (parentNode && !wouldCycle) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// The trace's own endedAt is the first choice for "when did this run
// finish." If the trace itself has no endedAt (still running, or
// reported without one), fall back to the latest span endedAt, then the
// latest span startedAt, then the trace's own startedAt as a last
// resort (a trace with no spans at all). Deliberately never wall-clock
// "now": that would make bar widths change on every reload and disagree
// with the durationMs the client actually reported.
function computeEffectiveEndMs(trace: TraceRecord, spans: SpanRecord[]): number {
  if (trace.endedAt) return new Date(trace.endedAt).getTime();

  const spanEndTimes = spans
    .map((span) => span.endedAt)
    .filter((value): value is string => value != null)
    .map((value) => new Date(value).getTime());
  if (spanEndTimes.length > 0) return Math.max(...spanEndTimes);

  const spanStartTimes = spans.map((span) => new Date(span.startedAt).getTime());
  if (spanStartTimes.length > 0) return Math.max(...spanStartTimes);

  return new Date(trace.startedAt).getTime();
}

const TYPE_COLORS: Record<string, string> = {
  LLM: "bg-purple-400",
  TOOL: "bg-blue-400",
  RETRIEVAL: "bg-teal-400",
  CUSTOM: "bg-gray-400",
};

function unfinishedLabel(span: SpanRecord, traceStatus: string): string | null {
  if (span.endedAt != null) return null;
  // Only "Running" when the trace itself is still RUNNING: an unfinished
  // span on a SUCCESS/ERROR trace is inconsistent data, not an
  // in-progress span, and shouldn't be described as if it were.
  return traceStatus === "RUNNING" ? "Running" : "No end recorded";
}

function SpanRow({
  node,
  traceStartMs,
  effectiveEndMs,
  totalDurationMs,
  traceStatus,
  depth,
}: {
  node: SpanNode;
  traceStartMs: number;
  effectiveEndMs: number;
  totalDurationMs: number;
  traceStatus: string;
  depth: number;
}) {
  const { span } = node;
  const spanStartMs = new Date(span.startedAt).getTime();
  const spanEndMs = span.endedAt
    ? new Date(span.endedAt).getTime()
    : effectiveEndMs;

  const leftPercent = ((spanStartMs - traceStartMs) / totalDurationMs) * 100;
  // A minimum width keeps a very short (or zero-width, if start === end)
  // span visible as a sliver instead of disappearing entirely.
  const widthPercent = Math.max(
    ((spanEndMs - spanStartMs) / totalDurationMs) * 100,
    0.5,
  );

  const isUnfinished = span.endedAt == null;
  const label = unfinishedLabel(span, traceStatus);
  const indentPx = Math.min(depth, MAX_TREE_DEPTH) * 16;
  const tooDeep = depth >= MAX_TREE_DEPTH;

  return (
    <div>
      <div className="flex items-center gap-2 py-1 text-sm">
        <div
          className="w-64 shrink-0 truncate text-gray-700"
          style={{ paddingLeft: `${indentPx}px` }}
          title={span.name}
        >
          {span.name}
          <span className="ml-2 text-xs text-gray-400">{span.type}</span>
        </div>
        <div className="relative h-4 flex-1 rounded bg-gray-100">
          <div
            className={`absolute h-4 rounded ${TYPE_COLORS[span.type] ?? "bg-gray-400"} ${isUnfinished ? "opacity-50" : ""}`}
            style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
            title={
              span.durationMs != null
                ? `${span.durationMs}ms`
                : "duration unknown"
            }
          />
        </div>
        <div className="w-24 shrink-0 text-right text-xs text-gray-500">
          {span.durationMs != null ? `${span.durationMs}ms` : "-"}
        </div>
        {label && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
            {label}
          </span>
        )}
      </div>
      <div className="space-y-1 pb-2" style={{ paddingLeft: `${indentPx + 16}px` }}>
        {span.error && (
          <p className="text-xs text-red-600">Error: {span.error}</p>
        )}
        <CollapsiblePayload label="Input" value={span.input} />
        <CollapsiblePayload label="Output" value={span.output} />
      </div>
      {!tooDeep &&
        node.children.map((child) => (
          <SpanRow
            key={child.span.id}
            node={child}
            traceStartMs={traceStartMs}
            effectiveEndMs={effectiveEndMs}
            totalDurationMs={totalDurationMs}
            traceStatus={traceStatus}
            depth={depth + 1}
          />
        ))}
      {tooDeep && node.children.length > 0 && (
        <p className="pl-4 text-xs text-gray-400">
          ({node.children.length} more nested span
          {node.children.length === 1 ? "" : "s"} not shown, nesting too deep)
        </p>
      )}
    </div>
  );
}

export function SpanWaterfall({
  trace,
  spans,
}: {
  trace: TraceRecord;
  spans: SpanRecord[];
}) {
  if (spans.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No spans recorded for this run yet.
      </p>
    );
  }

  const traceStartMs = new Date(trace.startedAt).getTime();
  const effectiveEndMs = computeEffectiveEndMs(trace, spans);
  // Floored at 1ms so a trace whose start and effective end coincide
  // (e.g. a single zero-duration span) never divides by zero.
  const totalDurationMs = Math.max(effectiveEndMs - traceStartMs, 1);

  const roots = buildSpanTree(spans);

  return (
    <div className="rounded border border-gray-200 p-4">
      {roots.map((root) => (
        <SpanRow
          key={root.span.id}
          node={root}
          traceStartMs={traceStartMs}
          effectiveEndMs={effectiveEndMs}
          totalDurationMs={totalDurationMs}
          traceStatus={trace.status}
          depth={0}
        />
      ))}
    </div>
  );
}
