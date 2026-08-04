"use client";

import type { CliAuthorizePayload } from "@agenttraceai/shared-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/app-header";
import { FormField } from "@/components/form-field";
import { ApiError, cliAuthorize, createProject, listProjects } from "@/lib/api";

// Rejects everything except an exact, unambiguous loopback redirect
// target. A raw string-prefix check (e.g.
// redirectUri.startsWith("http://127.0.0.1:")) is bypassable: a value
// like "http://localhost:1234@evil.example.com/callback" passes a naive
// prefix check while actually navigating the browser to
// evil.example.com, since everything before the @ is userinfo, not the
// host. Parsing with new URL() and checking its fields explicitly is
// the only safe way to validate this.
function isSafeLoopbackRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port !== "" &&
    url.username === "" &&
    url.password === ""
  );
}

// A protected page (no proxy.ts change needed: it isn't in
// PUBLIC_PATHS, so it already gets the same redirect-to-/login-if-no-
// session behavior every other page gets). The CLI (a future
// milestone) opens this URL after starting its own loopback listener,
// supplying state/redirect_uri/code_challenge as query parameters; this
// page never generates PKCE material itself, only relays what it was
// given. See docs/architecture/cli-onboarding-design.md.
//
// Wrapped in Suspense: unlike [projectId]/runs (exempted from static
// prerendering by its own dynamic route segment), this path has none,
// so Next tries to statically prerender it by default, and
// useSearchParams() requires a Suspense boundary in that case --
// confirmed by a real failed production build, not assumed.
export default function CliAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <CliAuthorizeForm />
    </Suspense>
  );
}

function CliAuthorizeForm() {
  const searchParams = useSearchParams();
  const state = searchParams.get("state");
  const redirectUri = searchParams.get("redirect_uri");
  const codeChallenge = searchParams.get("code_challenge");
  const suggestedName = searchParams.get("suggested_name") ?? "";

  const queryClient = useQueryClient();
  const { data: projects, isLoading: isLoadingProjects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState(suggestedName);
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingParams = !state || !redirectUri || !codeChallenge;
  const unsafeRedirect = Boolean(redirectUri) && !missingParams
    ? !isSafeLoopbackRedirect(redirectUri as string)
    : false;

  async function handleCreateProject() {
    setError(null);
    setIsCreatingProject(true);
    try {
      const project = await createProject({ name: newProjectName });
      setNewProjectName("");
      setShowNewProjectForm(false);
      setProjectId(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function handleApprove(event: FormEvent) {
    event.preventDefault();
    if (!redirectUri || !codeChallenge || !state) return;
    // Re-checked here, not just relied on via the form's render gate
    // (unsafeRedirect) above: the actual navigation must never depend
    // solely on JSX structure staying exactly as it is today.
    if (!isSafeLoopbackRedirect(redirectUri)) return;
    setError(null);
    setIsApproving(true);
    try {
      const payload: CliAuthorizePayload = {
        projectId,
        codeChallenge,
        label: label.trim() || undefined,
      };
      const result = await cliAuthorize(payload);

      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", result.code);
      callbackUrl.searchParams.set("state", state);
      window.location.assign(callbackUrl.toString());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
      setIsApproving(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Connect an application</h1>

        {missingParams && (
          <p className="text-sm text-red-600">
            This connection link is invalid or incomplete. Ask the
            application you&apos;re connecting to try again.
          </p>
        )}

        {!missingParams && unsafeRedirect && (
          <p className="text-sm text-red-600">
            This connection request was blocked for safety: it
            doesn&apos;t point back to a trusted location on this
            computer.
          </p>
        )}

        {!missingParams && !unsafeRedirect && (
          <form
            onSubmit={(event) => void handleApprove(event)}
            className="flex flex-col gap-4"
          >
            <p className="text-sm text-gray-600">
              An application on this computer wants to connect to an
              AgentTrace project.
            </p>

            <FormField
              id="connectionLabel"
              label="Connection name"
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. BeautyLab"
            />

            <div className="flex flex-col gap-1">
              <label
                htmlFor="projectId"
                className="text-sm font-medium text-gray-700"
              >
                Project
              </label>
              <select
                id="projectId"
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              >
                <option value="" disabled>
                  {isLoadingProjects ? "Loading projects..." : "Choose a project"}
                </option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            {!showNewProjectForm && (
              <button
                type="button"
                onClick={() => setShowNewProjectForm(true)}
                className="self-start text-xs text-gray-600 underline"
              >
                + New project
              </button>
            )}

            {showNewProjectForm && (
              <div className="flex items-end gap-3 rounded border border-gray-200 p-3">
                <div className="flex-1">
                  <FormField
                    id="newProjectName"
                    label="New project name"
                    type="text"
                    required
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateProject()}
                  disabled={isCreatingProject || !newProjectName}
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {isCreatingProject ? "Creating..." : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewProjectForm(false)}
                  disabled={isCreatingProject}
                  className="text-xs text-gray-500 underline"
                >
                  Cancel
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={isApproving || !projectId}
              className="self-start rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isApproving ? "Connecting..." : "Approve"}
            </button>
          </form>
        )}
      </main>
    </>
  );
}
