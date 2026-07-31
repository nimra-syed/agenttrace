"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ApiKeysPanel } from "@/components/api-keys-panel";
import { ConnectedApplicationsPanel } from "@/components/connected-applications-panel";

export default function ProjectSettingsPage() {
  const params = useParams<{ projectId: string }>();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          href={`/projects/${params.projectId}/runs`}
          className="text-sm text-gray-500 hover:underline"
        >
          &larr; Back to runs
        </Link>
        <h1 className="mt-4 mb-6 text-2xl font-semibold">Project settings</h1>
        <ApiKeysPanel projectId={params.projectId} />
        <div className="mt-10">
          <ConnectedApplicationsPanel projectId={params.projectId} />
        </div>
      </main>
    </>
  );
}
