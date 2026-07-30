"use client";

import type { TraceStatus } from "@agenttrace/shared-types";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { RunFilters } from "@/components/run-filters";
import { RunsTable } from "@/components/runs-table";
import { listTraces } from "@/lib/api";

export default function RunsPage() {
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();

  // Filters live in the URL (not just component state), so a filtered
  // view is refreshable and bookmarkable/shareable, per the M7 plan.
  const filters = {
    status: (searchParams.get("status") as TraceStatus | null) ?? undefined,
    agentName: searchParams.get("agentName") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ["traces", params.projectId, filters],
      queryFn: ({ pageParam }) =>
        listTraces(params.projectId, { ...filters, cursor: pageParam }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });

  const traces = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Runs</h1>
          <Link
            href={`/projects/${params.projectId}/settings`}
            className="text-sm text-gray-500 hover:underline"
          >
            Settings
          </Link>
        </div>
        <RunFilters />
        {isLoading && <p className="text-sm text-gray-600">Loading...</p>}
        {!isLoading && traces.length === 0 && (
          <p className="text-sm text-gray-600">
            No runs match these filters yet.
          </p>
        )}
        {traces.length > 0 && <RunsTable traces={traces} />}
        {hasNextPage && (
          <button
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="mt-4 rounded border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        )}
      </main>
    </>
  );
}
