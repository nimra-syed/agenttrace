// Confirmed by reading apps/api's own ApiKeyGuard (M13, ADR-0017):
// GET /api-keys/verify already echoes back apiKeyContext regardless of
// which credential type authenticated the request, so an
// Installation-authenticated call already returns
// { installationId, projectId, orgId } today with zero backend
// changes. Deliberately not using AgentTraceClient.trace() for this:
// that method fails open by design (ADR-0009), warning and resolving
// successfully even when the underlying HTTP call fails, which is
// exactly wrong for a command whose entire job is reporting whether
// the connection actually works.
export interface ConnectionContext {
  projectId: string;
  orgId: string;
  installationId?: string;
  apiKeyId?: string;
}

export class ConnectionInvalidError extends Error {
  constructor(public readonly status: number) {
    super(`The server responded with ${status}.`);
    this.name = "ConnectionInvalidError";
  }
}

export async function verifyConnection(
  apiKey: string,
  baseUrl: string,
): Promise<ConnectionContext> {
  const response = await fetch(new URL("/api-keys/verify", baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new ConnectionInvalidError(response.status);
  }

  return (await response.json()) as ConnectionContext;
}
