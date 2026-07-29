"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { CollapsiblePayload } from "@/components/collapsible-payload";
import {
  formatCost,
  formatDuration,
  STATUS_STYLES,
} from "@/components/runs-table";
import { SpanWaterfall } from "@/components/span-waterfall";
import { ApiError, getTraceDetail } from "@/lib/api";

// Same reasoning as unfinishedLabel in span-waterfall.tsx: an endedAt-less
// trace only reads as "Running" while its own status agrees; otherwise
// it's incomplete data, not an in-progress run, and shouldn't be
// described as if it were.
function tracePendingLabel(status: string, endedAt: string | null): string | null {
  if (endedAt != null) return null;
  return status === "RUNNING" ? "Running" : "No end recorded";
}

export default function TraceDetailPage() {
  const params = useParams<{ projectId: string; traceId: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["trace-detail", params.projectId, params.traceId],
    queryFn: () => getTraceDetail(params.projectId, params.traceId),
  });

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href={`/projects/${params.projectId}/runs`}
          className="text-sm text-gray-500 hover:underline"
        >
          &larr; Back to runs
        </Link>

        {isLoading && (
          <p className="mt-4 text-sm text-gray-600">Loading...</p>
        )}

        {error && error instanceof ApiError && error.status === 404 && (
          <p className="mt-4 text-sm text-gray-600">
            This run doesn&apos;t exist, or you don&apos;t have access to it.
          </p>
        )}

        {error && (!(error instanceof ApiError) || error.status !== 404) && (
          <p className="mt-4 text-sm text-red-600">
            Something went wrong loading this run.
          </p>
        )}

        {data && (
          <>
            <div className="mt-4 rounded border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold">{data.trace.name}</h1>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[data.trace.status] ?? ""}`}
                >
                  {data.trace.status}
                </span>
                {tracePendingLabel(data.trace.status, data.trace.endedAt) && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {tracePendingLabel(data.trace.status, data.trace.endedAt)}
                  </span>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-gray-500">Agent</dt>
                  <dd className="text-gray-700">{data.trace.agentName}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Started</dt>
                  <dd className="text-gray-700">
                    {new Date(data.trace.startedAt).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Duration</dt>
                  <dd className="text-gray-700">
                    {formatDuration(data.trace.durationMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Tokens</dt>
                  {/* Displayed as reported by the client, never
                      re-summed from span data: totalTokens/totalCostUsd
                      are independent, explicitly-reported fields (same
                      as durationMs), not derived from spans. Re-summing
                      here could disagree with what was actually
                      reported. See ADR-0008 and CLAUDE.md. */}
                  <dd className="text-gray-700">
                    {data.trace.totalTokens ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Cost</dt>
                  <dd className="text-gray-700">
                    {formatCost(data.trace.totalCostUsd)}
                  </dd>
                </div>
              </dl>

              {data.trace.error && (
                <p className="mt-3 text-sm text-red-600">
                  Error: {data.trace.error}
                </p>
              )}

              <div className="mt-3 space-y-1">
                <CollapsiblePayload label="Input" value={data.trace.input} />
                <CollapsiblePayload label="Output" value={data.trace.output} />
              </div>
            </div>

            <h2 className="mt-6 mb-2 text-lg font-semibold">Spans</h2>
            <SpanWaterfall trace={data.trace} spans={data.spans} />
          </>
        )}
      </main>
    </>
  );
}
