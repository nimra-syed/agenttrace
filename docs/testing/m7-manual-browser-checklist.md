# M7 manual browser test checklist

This is the manual test pass for the M7 dashboard frontend: login,
signup, project list, and the runs dashboard. Automated tests (Jest,
backend) cover the API layer; this checklist covers what only a real
browser can confirm: rendering, navigation, cookies, and redirects.

Run this after any change that touches `apps/web`, `proxy.ts`, or the
auth endpoints in `apps/api`.

## Setup

1. `pnpm db:up`
2. `pnpm dev:api` (port 3000)
3. `pnpm dev:web` (port 3001, or whatever port Next.js picks if 3000 is
   taken)
4. Open the app in a browser at the web port.

## Signup and login

- [ ] Visiting `/` with no session cookie redirects to `/login`.
- [ ] `/signup` renders the name, email, password, and organization name
      fields.
- [ ] Submitting signup with a new email creates the account, sets the
      session cookie, and redirects to `/projects`.
- [ ] Logging out, then visiting `/login`, then logging back in with the
      same credentials redirects to `/projects` and shows the correct
      email in the header.
- [ ] While signed in, visiting `/login` or `/signup` directly redirects
      back to `/projects` (the convenience redirect in `proxy.ts`).

## Projects

- [ ] A brand-new account sees the empty state ("You don't have any
      projects yet...") on `/projects`.
- [ ] Creating a project with a name adds it to the list immediately
      (no manual refresh needed) and clears the input.
- [ ] Clicking a project in the list navigates to
      `/projects/:projectId/runs`.

## Runs dashboard

Seed a project with a mix of trace data first (varied `status` values,
more than one `agentName`, timestamps spread across a wide enough range
to test filtering, and enough rows to exceed the default page size so
"Load more" appears). The backend has no seed script for this yet; use
the API directly with an API key created via
`POST /projects/:projectId/api-keys`.

- [ ] A project with no traces shows "No runs match these filters yet."
- [ ] A project with traces renders them in a table: name, agent,
      status badge, started time, duration, tokens, cost.
- [ ] Cost renders as a real number formatted like `$0.1234`, not the
      string Prisma's `Decimal` type would otherwise produce.
- [ ] Duration renders as `450ms` for sub-second durations and `7.3s`
      for durations over a second; rows with no `durationMs` show `-`.
- [ ] Filtering by status shows only matching rows, and the URL updates
      to `?status=...`.
- [ ] Reloading the page with a filtered URL (e.g. pasting
      `?status=ERROR` directly) reproduces the same filtered view and
      the status dropdown reflects the active filter.
- [ ] Filtering by agent name narrows the results correctly.
- [ ] Clearing filters restores the full unfiltered list and resets the
      URL.
- [ ] With more rows than the default page size, "Load more" appears;
      clicking it appends the next page's rows with no duplicates or
      gaps, and the button disappears once every row has loaded.

## Session handling

- [ ] Logging out redirects to `/login` and clears the session; a
      direct navigation to `/projects` afterward redirects back to
      `/login`.
- [ ] Simulate an expired session: while signed in, expire or delete
      the session row in the database directly (the browser's cookie is
      unaffected). Reload any protected page. Expected: the browser
      lands cleanly on `/login`, with no redirect loop between `/login`
      and `/projects`. Check the console for a stream of `[HMR]
      connected` messages firing in rapid succession; that pattern is
      the signature of the redirect loop this test guards against (see
      ADR-0012).

## Console check

- [ ] No errors in the browser console during any of the above (React
      DevTools and HMR informational messages are expected and fine).
