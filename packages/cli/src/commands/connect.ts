import { AgentTraceClient } from "@agenttraceai/sdk";
import { runConnectFlow } from "../lib/connect-flow.js";
import { readEnvValue, setEnvValues } from "../lib/env-file.js";
import { deriveLabel } from "../lib/label.js";
import { confirm } from "../lib/prompt.js";

export interface ConnectOptions {
  envFile: string;
  name?: string;
  force: boolean;
  dashboardUrl: string;
  apiUrl: string;
}

export async function connect(options: ConnectOptions): Promise<void> {
  // Checked before anything else happens, not right before the final
  // write: deciding this after a token has already been exchanged would
  // mean holding a real secret in memory with nowhere safe to go if the
  // person declines, since it can never be printed to the terminal as a
  // fallback under this project's own credential-hygiene rule.
  const existingKey = readEnvValue(options.envFile, "AGENTTRACE_API_KEY");
  const existingBaseUrl = readEnvValue(options.envFile, "AGENTTRACE_BASE_URL");
  if ((existingKey ?? existingBaseUrl) && !options.force) {
    const proceed = await confirm(
      `${options.envFile} already has an AgentTrace connection configured. Overwrite it? [y/N]`,
      { assumeYes: false, flagHint: "--force" },
    );
    if (!proceed) {
      console.log("Cancelled. Nothing was changed.");
      return;
    }
  }

  const label = options.name ?? deriveLabel(process.cwd());

  const result = await runConnectFlow({
    label,
    dashboardUrl: options.dashboardUrl,
    apiUrl: options.apiUrl,
  });

  setEnvValues(options.envFile, {
    AGENTTRACE_API_KEY: result.token,
    AGENTTRACE_BASE_URL: options.apiUrl,
  });
  console.log(`Saved your connection to ${options.envFile}.`);

  console.log("Sending a test trace...");
  const client = new AgentTraceClient({
    apiKey: result.token,
    baseUrl: options.apiUrl,
  });
  await client.trace(
    { name: "agenttrace-cli-smoke-test", agentName: label },
    async (trace) => {
      trace.setOutput("Connected via `agenttrace connect`.");
    },
  );

  const runsUrl = new URL(
    `/projects/${result.projectId}/runs`,
    options.dashboardUrl,
  );
  console.log(`Connected! View it at ${runsUrl.toString()}`);
}
