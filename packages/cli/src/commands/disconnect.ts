import { readEnvValue, removeEnvValues } from "../lib/env-file.js";

export interface DisconnectOptions {
  envFile: string;
}

// Local-only, on purpose: apps/api's DELETE
// /projects/:projectId/installations/:installationId (M13) is
// session-authenticated, not Bearer-token-authenticated, so a CLI
// holding only its own installation token has no endpoint that lets it
// revoke itself server-side. Documented here, not silently glossed
// over: building a self-revoke endpoint would pull this milestone back
// into apps/api's territory, which M13 already closed. See the M15
// plan's own scope-decision note.
export async function disconnect(options: DisconnectOptions): Promise<void> {
  const apiKey = readEnvValue(options.envFile, "AGENTTRACE_API_KEY");
  if (!apiKey) {
    console.log("Nothing to disconnect.");
    return;
  }

  removeEnvValues(options.envFile, [
    "AGENTTRACE_API_KEY",
    "AGENTTRACE_BASE_URL",
  ]);
  console.log(`Removed the connection from ${options.envFile}.`);
  console.log(
    "Note: this only removes it locally. To fully revoke it, remove it from the project's Connected Applications settings in the dashboard.",
  );
}
