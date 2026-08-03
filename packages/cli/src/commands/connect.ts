import { createInterface } from "node:readline/promises";
import { AgentTraceClient } from "@agenttrace/sdk";
import open from "open";
import { readEnvValue, setEnvValues } from "../lib/env-file.js";
import { deriveLabel } from "../lib/label.js";
import { startLoopbackServer } from "../lib/loopback-server.js";
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "../lib/pkce.js";
import { verifyConnection } from "../lib/verify-connection.js";

export interface ConnectOptions {
  envFile: string;
  name?: string;
  force: boolean;
  dashboardUrl: string;
  apiUrl: string;
}

// Generous enough for a real person to notice the browser window, sign
// in if needed, and click Approve, but bounded so a CLI invocation
// nobody ever returns to doesn't hang forever.
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export async function connect(options: ConnectOptions): Promise<void> {
  // Checked before anything else happens, not right before the final
  // write: deciding this after a token has already been exchanged would
  // mean holding a real secret in memory with nowhere safe to go if the
  // person declines, since it can never be printed to the terminal as a
  // fallback under this project's own credential-hygiene rule.
  const existingKey = readEnvValue(options.envFile, "AGENTTRACE_API_KEY");
  const existingBaseUrl = readEnvValue(options.envFile, "AGENTTRACE_BASE_URL");
  if ((existingKey ?? existingBaseUrl) && !options.force) {
    const proceed = await confirmOverwrite(options.envFile);
    if (!proceed) {
      console.log("Cancelled. Nothing was changed.");
      return;
    }
  }

  const label = options.name ?? deriveLabel(process.cwd());
  console.log(`Connecting as "${label}"...`);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = generateState();

  const server = await startLoopbackServer();

  const authorizeUrl = new URL("/cli/authorize", options.dashboardUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", server.redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("suggested_name", label);

  console.log("Opening your browser to approve this connection...");
  console.log(
    `If it doesn't open automatically, visit:\n  ${authorizeUrl.toString()}`,
  );
  await open(authorizeUrl.toString()).catch(() => {
    // Non-fatal: the printed URL above is the fallback for any
    // environment with no default browser handler.
  });

  let callback;
  try {
    callback = await server.waitForCallback(CALLBACK_TIMEOUT_MS);
  } finally {
    await server.close();
  }

  if (callback.state !== state) {
    throw new Error(
      "The browser approval did not match this connection attempt. Run `agenttrace connect` again.",
    );
  }

  console.log("Exchanging your approval for a connection...");
  const tokenResponse = await fetch(new URL("/cli/token", options.apiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: callback.code, codeVerifier }),
  });

  if (!tokenResponse.ok) {
    // Sanitized: never the code, verifier, or response body, matching
    // apps/api's own error-handling discipline for this exact exchange
    // (ADR-0017).
    throw new Error(
      `Could not complete the connection (the server responded with ${tokenResponse.status}).`,
    );
  }

  const result = (await tokenResponse.json()) as {
    token: string;
    installationId: string;
    projectId: string;
  };

  // Confirmed real before claiming success, not assumed from a 2xx on
  // the exchange alone: verifyConnection makes an independent, checkable
  // call, since AgentTraceClient.trace() below is deliberately fail-open
  // (ADR-0009) and would report success even if ingestion silently
  // failed.
  await verifyConnection(result.token, options.apiUrl);

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

async function confirmOverwrite(envFile: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      `${envFile} already has an AgentTrace connection configured. Overwrite it? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}
