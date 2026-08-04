import type { InstallationRecord } from '@agenttraceai/shared-types';
import type { Installation } from '../../generated/prisma/client.js';

// Same reasoning as toApiKeyRecord/toTraceRecord (ADR-0011): an
// explicit mapper, not a raw Prisma row, so Date fields come back as
// the ISO strings InstallationRecord promises. tokenHash/tokenPrefix
// are deliberately never included -- neither is ever safe or useful to
// return from a list/detail endpoint.
export function toInstallationRecord(
  installation: Pick<
    Installation,
    | 'id'
    | 'projectId'
    | 'label'
    | 'createdByUserId'
    | 'lastUsedAt'
    | 'revokedAt'
    | 'revokedByUserId'
    | 'createdAt'
  >,
): InstallationRecord {
  return {
    id: installation.id,
    projectId: installation.projectId,
    label: installation.label,
    createdByUserId: installation.createdByUserId,
    lastUsedAt: installation.lastUsedAt
      ? installation.lastUsedAt.toISOString()
      : null,
    revokedAt: installation.revokedAt
      ? installation.revokedAt.toISOString()
      : null,
    revokedByUserId: installation.revokedByUserId,
    createdAt: installation.createdAt.toISOString(),
  };
}
