"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AppHeader } from "@/components/app-header";
import { FormField } from "@/components/form-field";
import { ApiError, createProject, listProjects } from "@/lib/api";

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      await createProject({ name });
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Projects</h1>

        {isLoading && <p className="text-sm text-gray-600">Loading...</p>}

        {!isLoading && projects && projects.length === 0 && (
          <p className="mb-6 text-sm text-gray-600">
            You don&apos;t have any projects yet. Create one below to start
            recording agent runs.
          </p>
        )}

        {!isLoading && projects && projects.length > 0 && (
          <ul className="mb-8 flex flex-col divide-y divide-gray-200 rounded border border-gray-200">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}/runs`}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <span className="font-medium">{project.name}</span>
                  <span className="ml-2 text-sm text-gray-500">
                    {project.slug}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(event) => void handleCreate(event)}
          className="flex items-end gap-3 rounded border border-gray-200 p-4"
        >
          <div className="flex-1">
            <FormField
              id="projectName"
              label="New project name"
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
            {isCreating ? "Creating..." : "Create project"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </main>
    </>
  );
}
