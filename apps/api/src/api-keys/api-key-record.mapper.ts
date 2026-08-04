import type { ApiKeyRecord } from '@agenttraceai/shared-types';
import type { ApiKey } from '../../generated/prisma/client.js';

// Same reasoning as toTraceRecord/toSpanRecord (ADR-0011): an explicit
// mapper, not a raw Prisma row returned as-is, so Date fields actually
// come back as the ISO strings ApiKeyRecord promises.
export function toApiKeyRecord(
  apiKey: Pick<
    ApiKey,
    'id' | 'name' | 'keyPrefix' | 'revokedAt' | 'lastUsedAt' | 'createdAt'
  >,
): ApiKeyRecord {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    revokedAt: apiKey.revokedAt ? apiKey.revokedAt.toISOString() : null,
    lastUsedAt: apiKey.lastUsedAt ? apiKey.lastUsedAt.toISOString() : null,
    createdAt: apiKey.createdAt.toISOString(),
  };
}
