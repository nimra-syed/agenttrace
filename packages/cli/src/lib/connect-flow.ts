import open from "open";
import { startLoopbackServer } from "./loopback-server.js";
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./pkce.js";
import { verifyConnection } from "./verify-connection.js";

export interface ConnectFlowOptions {
  label: string;
  dashboardUrl: string;
  apiUrl: string;
}

export interface ConnectFlowResult {
  token: string;
  installationId: string;
  projectId: string;
}

// Generous enough for a real person to notice the browser window, sign
// in if needed, and click Approve, but bounded so a CLI invocation
// nobody ever returns to doesn't hang forever.
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// The reusable core of the loopback+PKCE exchange (docs/architecture/
// cli-onboarding-design.md, ADR-0017/0018), extracted out of
// commands/connect.ts at M16 so commands/init.ts (docs/architecture/
// cli-init-design.md) can reuse the exact same exchange rather than a
// second implementation of it. What happens before this (checking for
// an existing connection, deciding whether to run this at all) and
// after it (writing .env, sending a smoke trace) is each caller's own
// job, not this function's.
export async function runConnectFlow(
  options: ConnectFlowOptions,
): Promise<ConnectFlowResult> {
  console.log(`Connecting as "${options.label}"...`);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = generateState();

  const server = await startLoopbackServer();

  const authorizeUrl = new URL("/cli/authorize", options.dashboardUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", server.redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("suggested_name", options.label);

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

  const result = (await tokenResponse.json()) as ConnectFlowResult;

  // Confirmed real before claiming success, not assumed from a 2xx on
  // the exchange alone: verifyConnection makes an independent, checkable
  // call, since AgentTraceClient.trace() (used by both callers after
  // this returns) is deliberately fail-open (ADR-0009) and would report
  // success even if ingestion silently failed.
  await verifyConnection(result.token, options.apiUrl);

  return result;
}
