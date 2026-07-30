import { expect, test } from "@playwright/test";
import { uniqueEmail, uniqueName } from "./fixtures/unique";

test("signup lands on the projects page", async ({ page }) => {
  await page.goto("/signup");

  await page.getByLabel("Your name").fill("E2E Test User");
  await page.getByLabel("Email").fill(uniqueEmail("e2e-signup"));
  await page.getByLabel("Password").fill("correct horse battery staple e2e");
  await page.getByLabel("Organization name").fill(uniqueName("E2E Org"));
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("logout returns to the login page, and it stays there", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Test User");
  await page.getByLabel("Email").fill(uniqueEmail("e2e-logout"));
  await page.getByLabel("Password").fill("correct horse battery staple e2e");
  await page.getByLabel("Organization name").fill(uniqueName("E2E Org"));
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Not just "logout redirected once" -- the session is actually gone,
  // not just the page navigated away from.
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login$/);
});

test("a signed-out visitor is redirected away from a protected page", async ({
  page,
}) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login$/);
});
