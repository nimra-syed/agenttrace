"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

// datetime-local inputs use "YYYY-MM-DDTHH:mm" in local time, no
// seconds, no timezone. The API (and the URL, for a bookmarkable link)
// stores a full ISO 8601 string. These two helpers convert between them
// at the edges, so the rest of the app only ever deals with real ISO
// strings.
function toIsoOrUndefined(localValue: string): string | undefined {
  if (!localValue) return undefined;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RunFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [agentName, setAgentName] = useState(
    searchParams.get("agentName") ?? "",
  );
  const [from, setFrom] = useState(
    toDatetimeLocalValue(searchParams.get("from")),
  );
  const [to, setTo] = useState(toDatetimeLocalValue(searchParams.get("to")));

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (agentName) params.set("agentName", agentName);
    const fromIso = toIsoOrUndefined(from);
    const toIso = toIsoOrUndefined(to);
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    router.push(`?${params.toString()}`);
  }

  function clearFilters() {
    setStatus("");
    setAgentName("");
    setFrom("");
    setTo("");
    router.push("?");
  }

  return (
    <form
      onSubmit={applyFilters}
      className="mb-6 flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">Status</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All</option>
          <option value="RUNNING">Running</option>
          <option value="SUCCESS">Success</option>
          <option value="ERROR">Error</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">Agent name</span>
        <input
          type="text"
          value={agentName}
          onChange={(event) => setAgentName(event.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">From</span>
        <input
          type="datetime-local"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">To</span>
        <input
          type="datetime-local"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={clearFilters}
        className="rounded border border-gray-300 px-4 py-2 text-sm"
      >
        Clear
      </button>
    </form>
  );
}
