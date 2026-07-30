import { expect, test } from "@playwright/test";
import { signUpAndCreateProject } from "./fixtures/api-setup";
import { uniqueName } from "./fixtures/unique";

// User + project come from the API (see fixtures/api-setup.ts and
// ADR-0015), not the signup/project-creation UI: this spec's subject is
// the API-keys UI specifically, already covered independently by
// auth.spec.ts and projects.spec.ts.
test("creating, listing, and revoking an API key", async ({
  page,
  context,
}) => {
  const { project } = await signUpAndCreateProject(context);

  await page.goto(`/projects/${project.id}/settings`);

  const keyName = uniqueName("E2E Key");
  await page.getByLabel("New key name").fill(keyName);
  await page.getByRole("button", { name: "Create key" }).click();

  // The one-time reveal: shown once, then gone for good after "Done".
  await expect(
    page.getByText(`Your new API key: ${keyName}`),
  ).toBeVisible();
  const revealedKey = page.locator("code").first();
  await expect(revealedKey).toContainText("atr_");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`Your new API key: ${keyName}`)).toHaveCount(0);

  // Filtering by contained text rather than getByRole("row", { name })
  // -- a <tr>'s accessible-name computation from its cells' text is
  // inconsistent enough across engines to be a fragile match here.
  const row = page.locator("tbody tr").filter({ hasText: keyName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();

  await row.getByRole("button", { name: "Revoke" }).click();
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(row.getByText("Revoked")).toBeVisible();
});
