import { expect, test } from "@playwright/test";
import { createApiKey, signUpAndCreateProject } from "./fixtures/api-setup";
import { uniqueName } from "./fixtures/unique";

// This suite never triggers a real evaluation: apps/eval-worker's own
// call to Gemini is a real, paid, network-dependent LLM call (same
// reasoning as ADR-0010 for the reference agent), so every case here
// mocks the evaluate/evaluations routes via page.route() instead. One
// real paid smoke evaluation is verified separately, by hand, not in
// this automated suite. See ADR-0016.
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost:3000";

async function setUpTraceDetailPage(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  request: import("@playwright/test").APIRequestContext,
) {
  const { project } = await signUpAndCreateProject(context);
  const apiKey = await createApiKey(context, project.id, "e2e eval key");
  const authHeader = { Authorization: `Bearer ${apiKey.key}` };
  const startedAt = new Date().toISOString();

  const traceRes = await request.post(`${API_BASE_URL}/traces`, {
    headers: authHeader,
    data: {
      name: uniqueName("e2e-eval-run"),
      agentName: "e2e-agent",
      status: "SUCCESS",
      startedAt,
    },
  });
  if (!traceRes.ok()) {
    throw new Error(
      `Trace ingestion failed: ${traceRes.status()} ${await traceRes.text()}`,
    );
  }
  const trace = (await traceRes.json()) as { id: string };

  await page.goto(`/projects/${project.id}/runs/${trace.id}`);
  await expect(page.getByRole("heading", { name: "Evaluations" })).toBeVisible();

  return { projectId: project.id, traceId: trace.id };
}

const evaluatePath = (projectId: string, traceId: string) =>
  `**/api/projects/${projectId}/traces/${traceId}/evaluate`;

const evaluationsListPath = (projectId: string, traceId: string) =>
  `**/api/projects/${projectId}/traces/${traceId}/evaluations`;

test("shows a friendly message for each mapped failure status, and re-enables the button afterward", async ({
  page,
  context,
  request,
}) => {
  const { projectId, traceId } = await setUpTraceDetailPage(
    page,
    context,
    request,
  );

  const cases: Array<{ status: number; expectedText: RegExp }> = [
    { status: 429, expectedText: /too quickly/ },
    { status: 502, expectedText: /invalid response/ },
    { status: 503, expectedText: /temporarily unavailable/ },
    { status: 504, expectedText: /timed out/ },
    { status: 500, expectedText: /something went wrong/i },
  ];

  for (const { status, expectedText } of cases) {
    await page.route(evaluatePath(projectId, traceId), async (route) => {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: status, message: "mocked failure" }),
      });
    });

    const evaluateButton = page.getByRole("button", { name: "Evaluate" });
    await evaluateButton.click();

    await expect(page.getByText(expectedText)).toBeVisible();
    await expect(evaluateButton).toBeEnabled();

    await page.unroute(evaluatePath(projectId, traceId));
  }
});

test("disables the Evaluate button while pending, and renders a new result's score, rationale, judge model, evaluator version, and timestamp", async ({
  page,
  context,
  request,
}) => {
  const { projectId, traceId } = await setUpTraceDetailPage(
    page,
    context,
    request,
  );

  const mockedResult = {
    id: "mock-eval-id",
    traceId,
    score: 4,
    rationale: "Mocked rationale for a deterministic UI test.",
    judgeModel: "mock-judge-model",
    evaluatorVersion: "judge-v1",
    createdAt: new Date().toISOString(),
  };

  await expect(page.getByText("No evaluations yet.")).toBeVisible();

  await page.route(evaluatePath(projectId, traceId), async (route) => {
    // A short artificial delay so the pending ("Evaluating...", disabled)
    // state is actually observable, not just instantaneous.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(mockedResult),
    });
  });
  // The panel refetches the list (rather than trusting the POST
  // response directly) after a successful evaluate, same
  // invalidate-then-refetch pattern as ApiKeysPanel's own create flow --
  // so the list route needs mocking too for the new result to appear.
  await page.route(evaluationsListPath(projectId, traceId), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([mockedResult]),
    });
  });

  const evaluateButton = page.getByRole("button", { name: "Evaluate" });
  await evaluateButton.click();

  await expect(page.getByRole("button", { name: "Evaluating..." })).toBeDisabled();

  await expect(page.getByText("4/5")).toBeVisible();
  await expect(page.getByText(mockedResult.rationale)).toBeVisible();
  await expect(page.getByText(mockedResult.judgeModel)).toBeVisible();
  await expect(page.getByText("judge-v1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Evaluate" }),
  ).toBeEnabled();
});
