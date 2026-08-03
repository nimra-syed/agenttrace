import { readEnvValue } from "../lib/env-file.js";
import { ConnectionInvalidError, verifyConnection } from "../lib/verify-connection.js";

export interface WhoamiOptions {
  envFile: string;
  dashboardUrl: string;
}

export async function whoami(options: WhoamiOptions): Promise<void> {
  const apiKey = readEnvValue(options.envFile, "AGENTTRACE_API_KEY");
  const baseUrl = readEnvValue(options.envFile, "AGENTTRACE_BASE_URL");

  if (!apiKey || !baseUrl) {
    console.log("Not connected. Run `agenttrace connect` first.");
    return;
  }

  let context;
  try {
    context = await verifyConnection(apiKey, baseUrl);
  } catch (err) {
    if (err instanceof ConnectionInvalidError) {
      console.log(
        `This connection is no longer valid (${err.message}). Run \`agenttrace connect\` again.`,
      );
      return;
    }
    throw err;
  }

  // No project *name* is resolved here: nothing exposes that to a
  // non-session-authenticated caller today (this credential
  // authenticates as an installation/API key, not a signed-in person),
  // and building a lookup just for this would be scope creep beyond
  // what M15 set out to do. A real, minor, accepted limitation, not a
  // hidden one.
  console.log(
    context.installationId
      ? `Connected (installation ${context.installationId}).`
      : `Connected (API key ${context.apiKeyId ?? "unknown"}).`,
  );
  console.log(`Project: ${context.projectId}`);
  console.log(
    `View it at ${new URL(`/projects/${context.projectId}/runs`, options.dashboardUrl).toString()}`,
  );
}
