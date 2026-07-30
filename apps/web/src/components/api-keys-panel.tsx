"use client";

import type { ApiKeyRecord, CreateApiKeyResponse } from "@agenttrace/shared-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { FormField } from "./form-field";
import { ApiError, createApiKey, listApiKeys, revokeApiKey } from "@/lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

// A copy-once reveal box, not a modal or native alert: shown inline
// right where the create form was, dismissed by an explicit "Done"
// click. Matches the actual backend guarantee -- the raw key is never
// retrievable again after this response, so there is no "view again"
// affordance to build.
function NewKeyReveal({
  newKey,
  onDone,
}: {
  newKey: CreateApiKeyResponse;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(newKey.key);
    setCopied(true);
  }

  return (
    <div className="mb-6 rounded border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">
        Your new API key: {newKey.name}
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Copy it now. You won&apos;t be able to see it again.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-white px-3 py-2 text-xs">
          {newKey.key}
        </code>
        <button
          onClick={() => void handleCopy()}
          className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        onClick={onDone}
        className="mt-3 rounded bg-black px-4 py-2 text-sm font-medium text-white"
      >
        Done
      </button>
    </div>
  );
}

function ApiKeyRow({
  projectId,
  apiKey,
  onRevoked,
}: {
  projectId: string;
  apiKey: ApiKeyRecord;
  onRevoked: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  async function handleConfirmRevoke() {
    setIsRevoking(true);
    try {
      await revokeApiKey(projectId, apiKey.id);
      onRevoked();
    } finally {
      setIsRevoking(false);
      setConfirming(false);
    }
  }

  const isRevoked = apiKey.revokedAt != null;

  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 pr-4 font-medium">{apiKey.name}</td>
      <td className="py-2 pr-4 text-gray-600">
        <code className="text-xs">{apiKey.keyPrefix}…</code>
      </td>
      <td className="py-2 pr-4">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            isRevoked
              ? "bg-gray-100 text-gray-600"
              : "bg-green-100 text-green-800"
          }`}
        >
          {isRevoked ? "Revoked" : "Active"}
        </span>
      </td>
      <td className="py-2 pr-4 text-gray-600">
        {formatDate(apiKey.createdAt)}
      </td>
      <td className="py-2 pr-4 text-gray-600">
        {formatDate(apiKey.lastUsedAt)}
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

export function ApiKeysPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ["api-keys", projectId],
    queryFn: () => listApiKeys(projectId),
  });

  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      const created = await createApiKey(projectId, { name });
      setNewKey(created);
      setName("");
      await queryClient.invalidateQueries({
        queryKey: ["api-keys", projectId],
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setIsCreating(false);
    }
  }

  function handleRevoked() {
    void queryClient.invalidateQueries({ queryKey: ["api-keys", projectId] });
  }

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">API Keys</h2>

      {newKey && (
        <NewKeyReveal newKey={newKey} onDone={() => setNewKey(null)} />
      )}

      {isLoading && <p className="text-sm text-gray-600">Loading...</p>}

      {!isLoading && apiKeys && apiKeys.length === 0 && (
        <p className="mb-4 text-sm text-gray-600">
          No API keys yet. Create one below to start sending traces.
        </p>
      )}

      {!isLoading && apiKeys && apiKeys.length > 0 && (
        <table className="mb-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Prefix</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Created</th>
              <th className="py-2 pr-4 font-medium">Last used</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {apiKeys.map((apiKey) => (
              <ApiKeyRow
                key={apiKey.id}
                projectId={projectId}
                apiKey={apiKey}
                onRevoked={handleRevoked}
              />
            ))}
          </tbody>
        </table>
      )}

      <form
        onSubmit={(event) => void handleCreate(event)}
        className="flex items-end gap-3 rounded border border-gray-200 p-4"
      >
        <div className="flex-1">
          <FormField
            id="apiKeyName"
            label="New key name"
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={isCreating}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isCreating ? "Creating..." : "Create key"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
