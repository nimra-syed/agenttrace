import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EvaluationSnapshot } from './evaluation-snapshot.builder';
import {
  validateEvalWorkerSecret,
  validateEvalWorkerUrl,
} from './evaluation-worker.util';

// Generous enough for a real Gemini call including network latency, but
// bounded so a hung request doesn't tie up a NestJS request indefinitely
// or leave the dashboard user waiting forever. See ADR-0016.
const EVAL_WORKER_TIMEOUT_MS = 30_000;

export interface EvaluationJudgment {
  score: number;
  rationale: string;
  judgeModel: string;
  evaluatorVersion: string;
}

// Exported for the shared-fixture contract test (contract.spec.ts) --
// the same validator used against a real eval-worker response is what
// checks the fixture hasn't drifted from what this client actually
// expects.
export function isEvaluationJudgment(
  value: unknown,
): value is EvaluationJudgment {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.score === 'number' &&
    typeof record.rationale === 'string' &&
    typeof record.judgeModel === 'string' &&
    typeof record.evaluatorVersion === 'string'
  );
}

@Injectable()
export class EvaluationWorkerClient {
  async evaluate(snapshot: EvaluationSnapshot): Promise<EvaluationJudgment> {
    // Re-validated on every call, not just trusted from startup: cheap,
    // and the same defense-in-depth reasoning as computeCsrfToken
    // re-validating CSRF_SECRET (ADR-0014) rather than trusting that
    // some other code path already checked it.
    const url = validateEvalWorkerUrl(process.env.EVAL_WORKER_URL);
    const secret = validateEvalWorkerSecret(process.env.EVAL_WORKER_SECRET);

    let response: Response;
    try {
      response = await fetch(`${url}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(EVAL_WORKER_TIMEOUT_MS),
      });
    } catch (error) {
      // Never retried automatically: retrying a request that triggers a
      // real, paid LLM call risks a duplicate charge if the original
      // call actually succeeded but the response was merely slow or
      // lost in transit. A human re-clicking "Evaluate" is an
      // intentional retry; this client silently doing one is not. See
      // ADR-0016.
      //
      // Only the error's *name* is ever used, never its message or the
      // snapshot/secret -- application data in trace/span input/output
      // can contain secrets or private data, same reasoning as the
      // SDK's own error handling (ADR-0009).
      //
      // AbortSignal.timeout() rejects with a DOMException named
      // 'TimeoutError', not the generic 'AbortError' -- confirmed
      // empirically against this project's Node version, not assumed.
      // That specific case means the worker (and, transitively,
      // Gemini) simply took too long, distinct from the worker being
      // entirely unreachable (connection refused, DNS failure, etc,
      // which fetch throws as a plain TypeError).
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException(
          'The evaluation worker did not respond in time.',
        );
      }
      throw new ServiceUnavailableException(
        'The evaluation worker could not be reached.',
      );
    }

    if (response.status === 503) {
      // The worker's own translation of a Gemini/provider-side failure
      // (rate limited, overloaded, etc) -- propagated as our own 503 so
      // the distinction ("try again later," not "something is broken")
      // survives the hop to apps/api's caller. See ADR-0016.
      throw new ServiceUnavailableException(
        'The evaluation provider is temporarily unavailable. Try again shortly.',
      );
    }
    if (response.status === 502) {
      // The worker's own translation of a malformed/unparseable judge
      // response. Propagated as our own 502 for the same reason as 503
      // above.
      throw new BadGatewayException(
        'The evaluation worker returned an invalid response.',
      );
    }
    if (!response.ok) {
      // Covers a 401 here too (internal secret mismatch between apps/api
      // and apps/eval-worker) -- a misconfiguration on our own side, not
      // something a retry or a "try later" message would fix, so this
      // stays a plain 500 rather than one of the provider-facing codes
      // above. response.status/body are never included in the thrown
      // message: eval-worker's own error bodies are meant for operators
      // reading logs, not guaranteed safe to relay verbatim to a browser.
      throw new InternalServerErrorException(
        'Evaluation worker request failed.',
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!isEvaluationJudgment(body)) {
      // The worker reported success (200) but the body doesn't match the
      // wire contract both languages are contract-tested against
      // (contract.spec.ts / test_contract.py) -- a drift bug, not a
      // provider problem, but still "this service got something
      // untrustworthy from upstream," hence 502 rather than 500.
      throw new BadGatewayException(
        'Evaluation worker returned an unexpected response shape.',
      );
    }

    return body;
  }
}
