import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { signUpAndCreateProject } from "./fixtures/api-setup";
import { uniqueName } from "./fixtures/unique";

// Nothing in this flow costs money or hits a real external provider
// (unlike M12's evaluation panel), so these exercise the real
// authorize-and-redirect flow end to end instead of mocking it. A
// throwaway local HTTP server stands in for the not-yet-built CLI's own
// loopback listener (M15), the same role BeautyLab/curl played as a
// stand-in for not-yet-built pieces in earlier milestones.
function startLoopbackListener(): Promise<{
  port: number;
  received: Promise<URL>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    let resolveReceived: (url: URL) => void;
    const received = new Promise<URL>((r) => {
      resolveReceived = r;
    });
    const server: Server = createServer((req, res) => {
      resolveReceived(new URL(req.url ?? "/", "http://127.0.0.1"));
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("You can close this tab.");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        received,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function authorizeUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `/cli/authorize?${search}`;
}

test("shows an invalid-link message when required query params are missing", async ({
  page,
  context,
}) => {
  await signUpAndCreateProject(context);

  await page.goto("/cli/authorize");

  await expect(page.getByText(/invalid or incomplete/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("blocks a plainly external redirect_uri", async ({ page, context }) => {
  await signUpAndCreateProject(context);

  await page.goto(
    authorizeUrl({
      state: "s1",
      redirect_uri: "https://evil.example.com/callback",
      code_challenge: "challenge",
    }),
  );

  await expect(page.getByText(/blocked for safety/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("blocks a deceptive redirect_uri using a userinfo bypass", async ({
  page,
  context,
}) => {
  await signUpAndCreateProject(context);

  // Everything before the @ is userinfo, not the host: a naive
  // startsWith("http://localhost") check would pass this while the
  // browser actually navigates to evil.example.com. See ADR-0017 and
  // the plan's own correction note.
  await page.goto(
    authorizeUrl({
      state: "s1",
      redirect_uri: "http://localhost:1234@evil.example.com/callback",
      code_challenge: "challenge",
    }),
  );

  await expect(page.getByText(/blocked for safety/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("approves a connection and redirects to the real loopback listener with a code and the original state", async ({
  page,
  context,
}) => {
  const { project } = await signUpAndCreateProject(context);
  const listener = await startLoopbackListener();

  await page.goto(
    authorizeUrl({
      state: "the-original-state",
      redirect_uri: `http://127.0.0.1:${listener.port}/callback`,
      code_challenge: "a-challenge-value",
      suggested_name: "BeautyLab",
    }),
  );

  await expect(page.getByLabel("Connection name")).toHaveValue("BeautyLab");
  await page.getByLabel("Project").selectOption(project.id);
  await page.getByRole("button", { name: "Approve" }).click();

  const received = await listener.received;
  expect(received.pathname).toBe("/callback");
  expect(received.searchParams.get("state")).toBe("the-original-state");
  expect(received.searchParams.get("code")).toBeTruthy();

  await listener.close();
});

test("preserves an existing query parameter already present on redirect_uri", async ({
  page,
  context,
}) => {
  // The CLI is free to encode its own state into redirect_uri's query
  // string (e.g. a listener session id) before ever reaching this page.
  // Building the callback via new URL(redirectUri).searchParams.set(...)
  // must add code/state onto whatever was already there, not replace
  // it -- a naive string-concatenation approach ("?code=...") would
  // silently drop this instead.
  const { project } = await signUpAndCreateProject(context);
  const listener = await startLoopbackListener();

  await page.goto(
    authorizeUrl({
      state: "the-original-state",
      redirect_uri: `http://127.0.0.1:${listener.port}/callback?session=abc123`,
      code_challenge: "a-challenge-value",
    }),
  );

  await page.getByLabel("Project").selectOption(project.id);
  await page.getByRole("button", { name: "Approve" }).click();

  const received = await listener.received;
  expect(received.searchParams.get("session")).toBe("abc123");
  expect(received.searchParams.get("state")).toBe("the-original-state");
  expect(received.searchParams.get("code")).toBeTruthy();

  await listener.close();
});

test("creates a new project inline without leaving the page", async ({
  page,
  context,
}) => {
  await signUpAndCreateProject(context);
  const listener = await startLoopbackListener();
  const newProjectName = uniqueName("e2e-inline-project");

  await page.goto(
    authorizeUrl({
      state: "s1",
      redirect_uri: `http://127.0.0.1:${listener.port}/callback`,
      code_challenge: "challenge",
    }),
  );

  await page.getByRole("button", { name: "+ New project" }).click();
  await page.getByLabel("New project name").fill(newProjectName);
  await page.getByRole("button", { name: "Create" }).click();

  const projectSelect = page.getByLabel("Project");
  await expect(async () => {
    const selectedText = await projectSelect.evaluate(
      (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent,
    );
    expect(selectedText).toBe(newProjectName);
  }).toPass();

  await listener.close();
});
