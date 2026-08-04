"use client";

import type { InstallationRecord } from "@agenttraceai/shared-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listInstallations, me, revokeInstallation } from "@/lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

// Derived, not a stored field: Pending means the row was approved in
// the browser but the CLI hasn't completed the token exchange yet
// (lastUsedAt is still null); Connected means it has authenticated at
// least once; Revoked always wins. See ADR-0017 and
// docs/architecture/cli-onboarding-design.md section 5.
type ConnectionStatus = "Pending" | "Connected" | "Revoked";

function connectionStatus(installation: InstallationRecord): ConnectionStatus {
  if (installation.revokedAt) return "Revoked";
  if (installation.lastUsedAt) return "Connected";
  return "Pending";
}

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  Connected: "bg-green-100 text-green-800",
  Pending: "bg-amber-100 text-amber-800",
  Revoked: "bg-gray-100 text-gray-600",
};

function ConnectedApplicationRow({
  projectId,
  installation,
  isOwnConnection,
  onRevoked,
}: {
  projectId: string;
  installation: InstallationRecord;
  isOwnConnection: boolean;
  onRevoked: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  async function handleConfirmRevoke() {
    setIsRevoking(true);
    try {
      await revokeInstallation(projectId, installation.id);
      onRevoked();
    } finally {
      setIsRevoking(false);
      setConfirming(false);
    }
  }

  const status = connectionStatus(installation);
  const isRevoked = status === "Revoked";

  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 pr-4 font-medium">{installation.label}</td>
      <td className="py-2 pr-4">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
        >
          {status}
        </span>
      </td>
      <td className="py-2 pr-4 text-gray-600">
        {isOwnConnection ? "You" : "Another member"}
      </td>
      <td className="py-2 pr-4 text-gray-600">
        {formatDate(installation.createdAt)}
      </td>
      <td className="py-2 pr-4 text-gray-600">
        {formatDate(installation.lastUsedAt)}
      </td>
      <td className="py-2 pr-4 text-right">
        {!isRevoked &&
          (confirming ? (
            <span className="inline-flex gap-2">
              <button
                onClick={() => void handleConfirmRevoke()}
                disabled={isRevoking}
                className="text-xs font-medium text-red-600 underline disabled:opacity-50"
              >
                {isRevoking ? "Revoking..." : "Confirm"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={isRevoking}
                className="text-xs text-gray-500 underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs text-red-600 underline"
            >
              Revoke
            </button>
          ))}
      </td>
    </tr>
  );
}

// Deliberately narrower than ApiKeysPanel: no create form, no
// one-time-secret-reveal box. Installations are only ever created
// through the browser-approval flow at /cli/authorize, never here. See
// docs/architecture/cli-onboarding-design.md.
export function ConnectedApplicationsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const { data: installations, isLoading } = useQuery({
    queryKey: ["installations", projectId],
    queryFn: () => listInstallations(projectId),
  });
  // Reused, not refetched: AppHeader already runs this same query, so
  // this is effectively free (React Query dedupes by key).
  const { data: currentUser } = useQuery({ queryKey: ["me"], queryFn: me });

  function handleRevoked() {
    void queryClient.invalidateQueries({
      queryKey: ["installations", projectId],
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Connected Applications</h2>

      {isLoading && <p className="text-sm text-gray-600">Loading...</p>}

      {!isLoading && installations && installations.length === 0 && (
        <p className="text-sm text-gray-600">
          Nothing connected yet. Use{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">
            agenttrace connect
          </code>{" "}
          from an application to connect it here.
        </p>
      )}

      {!isLoading && installations && installations.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Connected by</th>
              <th className="py-2 pr-4 font-medium">Created</th>
              <th className="py-2 pr-4 font-medium">Last used</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {installations.map((installation) => (
              <ConnectedApplicationRow
                key={installation.id}
                projectId={projectId}
                installation={installation}
                isOwnConnection={
                  currentUser?.id === installation.createdByUserId
                }
                onRevoked={handleRevoked}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
