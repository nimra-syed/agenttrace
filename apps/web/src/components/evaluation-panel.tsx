"use client";

import type { EvalResultRecord } from "@agenttrace/shared-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, listEvaluations, triggerEvaluation } from "@/lib/api";

// Fixed 1-5 scale, matching the rubric's own MIN_SCORE/MAX_SCORE
// (apps/eval-worker/app/judge.py). Not derived from any response field,
// since none carries the scale itself. See ADR-0016.
const MAX_SCORE = 5;

// Distinct, stable copy per status, not a relay of whatever message the
// backend happened to send: apps/api's own messages are sanitized and
// reasonable (ADR-0016), but this keeps the frontend's wording stable
// even if that changes, and gives every other failure (a network error
// reaching apps/api itself, an unrecognized status) one clear fallback.
function evaluationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 429:
        return "You're evaluating this trace too quickly. Wait a bit and try again.";
      case 502:
        return "The evaluation service returned an invalid response. Try again.";
      case 503:
        return "The evaluation provider is temporarily unavailable. Try again shortly.";
      case 504:
        return "The evaluation request timed out. Try again.";
      default:
        break;
    }
  }
  return "Something went wrong running this evaluation.";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function EvaluationCard({ evaluation }: { evaluation: EvalResultRecord }) {
  return (
    <li className="rounded border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">
          {evaluation.score}/{MAX_SCORE}
        </span>
        <span className="text-xs text-gray-500">
          {formatDate(evaluation.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{evaluation.rationale}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
        <div>
          <dt className="inline font-medium">Judge model: </dt>
          <dd className="inline">{evaluation.judgeModel}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Evaluator version: </dt>
          <dd className="inline">{evaluation.evaluatorVersion}</dd>
        </div>
      </dl>
    </li>
  );
}

export function EvaluationPanel({
  projectId,
  traceId,
}: {
  projectId: string;
  traceId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["evaluations", projectId, traceId];
  const { data: evaluations, isLoading } = useQuery({
    queryKey,
    queryFn: () => listEvaluations(projectId, traceId),
  });

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEvaluate() {
    setError(null);
    setIsEvaluating(true);
    try {
      await triggerEvaluation(projectId, traceId);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError(evaluationErrorMessage(err));
    } finally {
      setIsEvaluating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Evaluations</h2>
        <button
          onClick={() => void handleEvaluate()}
          disabled={isEvaluating}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isEvaluating ? "Evaluating..." : "Evaluate"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {isLoading && <p className="mt-2 text-sm text-gray-600">Loading...</p>}

      {!isLoading && evaluations && evaluations.length === 0 && (
        <p className="mt-2 text-sm text-gray-600">
          No evaluations yet. Click Evaluate to score this trace.
        </p>
      )}

      {/* Rendered in the order the API returns it (createdAt desc,
          apps/api's evaluations.service.ts) -- append-only history is
          only meaningful newest-first, and the API is already the
          source of truth for that order, so it isn't re-sorted here. */}
      {!isLoading && evaluations && evaluations.length > 0 && (
        <ul className="mt-3 space-y-3">
          {evaluations.map((evaluation) => (
            <EvaluationCard key={evaluation.id} evaluation={evaluation} />
          ))}
        </ul>
      )}
    </div>
  );
}
