import { defineConfig, devices } from "@playwright/test";

// Expected to already be running (pnpm db:up / dev:api / dev:web,
// locally; started explicitly by the CI workflow) -- this config does
// not manage server lifecycle itself. See ADR-0015.
const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Not parallelized yet: every test's data is independent, but all
  // tests share one running apps/api process and one Postgres
  // instance, including state not yet verified safe under concurrency
  // (e.g. the in-memory rate-limiter store from ADR-0014). See
  // ADR-0015.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: WEB_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
