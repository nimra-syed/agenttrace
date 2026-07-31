import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { connectApplication, signUpAndCreateProject } from "./fixtures/api-setup";

// The CLI itself (a future milestone) is what would normally exchange
// a code for a real credential and ingest with it; here that half of
// the flow is done directly against the public API (request.post, no
// proxy), the same faithful-to-how-a-real-caller-works reasoning
// trace-smoke.spec.ts already established for ingestion. Only the
// dashboard-facing half (status display, revoke) goes through the UI.
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost:3000";

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

test("shows Pending, then Connected after a real token exchange and ingestion, then Revoked", async ({
  page,
  context,
  request,
}) => {
  const { project } = await signUpAndCreateProject(context);
  const { verifier, challenge } = pkcePair();

  const { code } = await connectApplication(
    context,
    project.id,
    challenge,
    "BeautyLab",
  );

  await page.goto(`/projects/${project.id}/settings`);
  await expect(page.getByText("BeautyLab")).toBeVisible();
  await expect(page.getByText("Pending")).toBeVisible();

  const tokenRes = await request.post(`${API_BASE_URL}/cli/token`, {
    data: { code, codeVerifier: verifier },
  });
  if (!tokenRes.ok()) {
    throw new Error(
      `Token exchange failed: ${tokenRes.status()} ${await tokenRes.text()}`,
    );
  }
  const { token } = (await tokenRes.json()) as { token: string };

  const traceRes = await request.post(`${API_BASE_URL}/traces`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: "connected-app-smoke-trace",
      agentName: "beautylab-agent",
      status: "SUCCESS",
      startedAt: new Date().toISOString(),
    },
  });
  if (!traceRes.ok()) {
    throw new Error(
      `Trace ingestion failed: ${traceRes.status()} ${await traceRes.text()}`,
    );
  }

  await page.reload();
  await expect(page.getByText("Connected")).toBeVisible();

  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Revoked")).toBeVisible();

  const revokedIngestRes = await request.post(`${API_BASE_URL}/traces`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: "should-fail-after-revoke",
      agentName: "beautylab-agent",
      status: "SUCCESS",
      startedAt: new Date().toISOString(),
    },
  });
  expect(revokedIngestRes.status()).toBe(401);
});
