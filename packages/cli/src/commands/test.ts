import { AgentTraceClient } from "@agenttraceai/sdk";
import { readEnvValue } from "../lib/env-file.js";
import { deriveLabel } from "../lib/label.js";
import { ConnectionInvalidError, verifyConnection } from "../lib/verify-connection.js";

export interface TestOptions {
  envFile: string;
}

export async function testConnection(options: TestOptions): Promise<void> {
  const apiKey = readEnvValue(options.envFile, "AGENTTRACE_API_KEY");
  const baseUrl = readEnvValue(options.envFile, "AGENTTRACE_BASE_URL");

  if (!apiKey || !baseUrl) {
    console.log("Not connected. Run `agenttrace connect` first.");
    return;
  }

  // verifyConnection, not AgentTraceClient.trace() alone, is what
  // actually determines success or failure here: trace() fails open by
  // design (ADR-0009), so it would report success even against a
  // revoked or invalid credential.
  try {
    await verifyConnection(apiKey, baseUrl);
  } catch (err) {
    if (err instanceof ConnectionInvalidError) {
      console.log(
        `This connection is not working (${err.message}). Run \`agenttrace connect\` again.`,
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const client = new AgentTraceClient({ apiKey, baseUrl });
  await client.trace(
    {
      name: "agenttrace-cli-test-trace",
      agentName: deriveLabel(process.cwd()),
    },
    async (trace) => {
      trace.setOutput("Sent via `agenttrace test`.");
    },
  );

  console.log("Connection is working. Sent a test trace.");
}
