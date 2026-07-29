import type { TraceRecord } from "@agenttrace/shared-types";
import Link from "next/link";

// Exported so the trace detail page (M8) formats duration, cost, and
// status the same way as this list, instead of re-deriving the same
// rules in a second place.
export const STATUS_STYLES: Record<string, string> = {
  RUNNING: "bg-blue-100 text-blue-800",
  SUCCESS: "bg-green-100 text-green-800",
  ERROR: "bg-red-100 text-red-800",
};

export function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return "-";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatCost(costUsd: number | null): string {
  if (costUsd == null) return "-";
  return `$${costUsd.toFixed(4)}`;
}

export function RunsTable({ traces }: { traces: TraceRecord[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          <th className="py-2 pr-4 font-medium">Name</th>
          <th className="py-2 pr-4 font-medium">Agent</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Started</th>
          <th className="py-2 pr-4 font-medium">Duration</th>
          <th className="py-2 pr-4 font-medium">Tokens</th>
          <th className="py-2 pr-4 font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {traces.map((trace) => (
          <tr key={trace.id} className="border-b border-gray-100">
            <td className="py-2 pr-4 font-medium">
              <Link
                href={`/projects/${trace.projectId}/runs/${trace.id}`}
                className="hover:underline"
              >
                {trace.name}
              </Link>
            </td>
            <td className="py-2 pr-4 text-gray-600">{trace.agentName}</td>
            <td className="py-2 pr-4">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[trace.status] ?? ""}`}
              >
                {trace.status}
              </span>
            </td>
            <td className="py-2 pr-4 text-gray-600">
              {new Date(trace.startedAt).toLocaleString()}
            </td>
            <td className="py-2 pr-4 text-gray-600">
              {formatDuration(trace.durationMs)}
            </td>
            <td className="py-2 pr-4 text-gray-600">
              {trace.totalTokens ?? "-"}
            </td>
            <td className="py-2 pr-4 text-gray-600">
              {formatCost(trace.totalCostUsd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
