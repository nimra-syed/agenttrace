import { expect, test } from "@playwright/test";
import { createApiKey, signUpAndCreateProject } from "./fixtures/api-setup";
import { uniqueName } from "./fixtures/unique";

// Ingestion hits the API directly, not the Next.js proxy: API-key auth
// uses an Authorization header, not cookies, so there's no
// origin-scoping concern here the way there is for the session-based
// setup calls -- and this is the more faithful representation of "the
// public ingestion boundary," which real callers (the SDK, a script)
// hit directly, never through the dashboard's own frontend. See
// ADR-0015.
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost:3000";

// Intentionally narrow: one trace, two spans, no filters, no
// pagination, no waterfall-position or payload-detail assertions --
// those are each their own follow-up, not part of standing up e2e
// infrastructure for the first time. See ADR-0015.
test("a trace ingested through the public API appears in the dashboard", async ({
  page,
  context,
  request,
}) => {
  const { project } = await signUpAndCreateProject(context);
  const apiKey = await createApiKey(context, project.id, "e2e ingestion key");

  const traceName = uniqueName("e2e-smoke-run");
  const startedAt = new Date().toISOString();
  const authHeader = { Authorization: `Bearer ${apiKey.key}` };

  const traceRes = await request.post(`${API_BASE_URL}/traces`, {
    headers: authHeader,
    data: {
      name: traceName,
      agentName: "e2e-agent",
      status: "SUCCESS",
      startedAt,
      endedAt: new Date(Date.now() + 5000).toISOString(),
      durationMs: 5000,
    },
  });
  if (!traceRes.ok()) {
    throw new Error(
      `Trace ingestion failed: ${traceRes.status()} ${await traceRes.text()}`,
    );
  }
  const trace = (await traceRes.json()) as { id: string };

  const spanRes = await request.post(
    `${API_BASE_URL}/traces/${trace.id}/spans`,
    {
      headers: authHeader,
      data: {
        name: "call-llm",
        type: "LLM",
        status: "SUCCESS",
        startedAt,
        endedAt: new Date(Date.now() + 3000).toISOString(),
        durationMs: 3000,
      },
    },
  );
  if (!spanRes.ok()) {
    throw new Error(
      `Span ingestion failed: ${spanRes.status()} ${await spanRes.text()}`,
    );
  }

  await page.goto(`/projects/${project.id}/runs`);
  const traceLink = page.getByRole("link", { name: traceName });
  await expect(traceLink).toBeVisible();

  await traceLink.click();
  await expect(page).toHaveURL(/\/runs\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: traceName }),
  ).toBeVisible();
  await expect(page.getByText("call-llm")).toBeVisible();
});
