import { expect, test } from "@playwright/test";
import { uniqueEmail, uniqueName } from "./fixtures/unique";

test("creating a project shows it in the list and can be opened", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Test User");
  await page.getByLabel("Email").fill(uniqueEmail("e2e-projects"));
  await page.getByLabel("Password").fill("correct horse battery staple e2e");
  await page.getByLabel("Organization name").fill(uniqueName("E2E Org"));
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  const projectName = uniqueName("E2E Project");
  await page.getByLabel("New project name").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();

  const projectLink = page.getByRole("link", { name: projectName });
  await expect(projectLink).toBeVisible();

  await projectLink.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/runs$/);
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
});
