import type { EvalResultRecord } from '@agenttraceai/shared-types';
import type { EvalResult } from '../../generated/prisma/client.js';

// Same reasoning as toTraceRecord/toSpanRecord/toApiKeyRecord (ADR-0011):
// an explicit mapper, not a raw Prisma row, so Date fields actually come
// back as the ISO strings EvalResultRecord promises.
export function toEvalResultRecord(evalResult: EvalResult): EvalResultRecord {
  return {
    id: evalResult.id,
    traceId: evalResult.traceId,
    score: evalResult.score,
    rationale: evalResult.rationale,
    judgeModel: evalResult.judgeModel,
    evaluatorVersion: evalResult.evaluatorVersion,
    evaluationInput: evalResult.evaluationInput,
    createdAt: evalResult.createdAt.toISOString(),
  };
}
