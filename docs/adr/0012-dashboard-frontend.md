# ADR-0012: Dashboard frontend (auth pages, projects, runs list)

Status: Accepted

## Context

M7 also needed a frontend: a way for a signed-in person to actually use
the endpoints from ADR-0011 and earlier milestones, rather than calling
them with curl. That means login/signup pages, a project list, and the
runs dashboard with filters and pagination, all in `apps/web` (Next.js,
App Router).

## Decision

### Same-origin reverse proxy instead of CORS

`apps/web`'s `next.config.ts` rewrites `/api/:path*` to the NestJS API
(`http://localhost:3000` in dev). The frontend's `fetch` calls always
target `/api/...`, never the API's own origin directly.

Session cookies are `SameSite=Lax` (ADR-0005). A cross-origin `fetch`
from `localhost:3001` to `localhost:3000` would not reliably send or
receive that cookie without loosening it to `SameSite=None; Secure`,
which needs HTTPS and adds CSRF surface for no real benefit in this
setup. Making the browser see one origin for everything sidesteps the
cookie problem and CORS configuration entirely.

### `proxy.ts` is a convenience redirect, not authentication

Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`,
and the exported function from `middleware` to `proxy` (found the hard
way: a failed build pointing at
`https://nextjs.org/docs/messages/middleware-to-proxy`, not something
carried over from prior Next.js versions).

`proxy.ts` checks only whether a session cookie is present, redirecting
signed-out visitors away from protected pages and signed-in visitors
away from `/login` and `/signup`. It never checks whether that cookie
is still valid server-side, doing so would mean an extra network call
on every navigation just to save a client-side redirect the app would
do anyway once the page's own data fetch 401s. The real authentication
check is the API's 401 response, handled once, centrally, in
`apps/web/src/lib/api.ts`.

### A found-and-fixed bug: expired-session redirect loop

Manual testing (deliberately expiring a session server-side while the
browser still held its cookie, simulating what a real session timeout
looks like) surfaced a real bug in this split: `request()` in `api.ts`
handled a 401 by navigating straight to `/login`. `proxy.ts` intercepted
that navigation, saw the (stale, but still present) cookie, and
redirected `/login` back to `/projects`, which 401'd again, forever.
Confirmed live: the browser's console showed dozens of `[HMR] connected`
reconnects firing every ~150ms, the fingerprint of a tight redirect
loop, not something visible from reading either file in isolation.

Fixed on both sides:
- `apps/web/src/lib/api.ts`: `redirectToLogin()` now calls
  `POST /api/auth/logout` first (clearing the cookie via the API's
  `Set-Cookie`) before navigating, so `proxy.ts` no longer sees a
  cookie on the next request and lets `/login` through.
- `apps/api/src/auth/auth.controller.ts`: `POST /auth/logout` is now
  `@Public()`. It was previously guarded by `SessionGuard`, which
  rejected the request with its own 401 whenever the session was
  already expired or invalid, before the handler ever reached
  `res.clearCookie()`. A route whose entire job is ending a session
  must not itself require a valid one; `AuthService.logout()` already
  no-ops safely on a token that matches no session row.

Verified live: expired a session in the database, reloaded a protected
page, and the browser landed cleanly on `/login` with a stable page,
no loop. Re-ran the same steps before the fix to confirm the loop was
real, then again after to confirm it was gone.

### TanStack Query for data fetching

`useQuery` for the project list, `useInfiniteQuery` for the runs table.
`useInfiniteQuery`'s `getNextPageParam` reads `nextCursor` off the last
page's response (ADR-0011) directly, so a "Load more" button is just
`fetchNextPage()`, no manual cursor bookkeeping in component state.

### Filters live in the URL, not component state

`RunFilters` writes `status`, `agentName`, `from`, and `to` to the URL's
query string via `router.push`, and the runs page reads them back with
`useSearchParams`. This was a requirement going in: a filtered view
needs to survive a refresh and be shareable as a link, which plain
`useState` cannot do.

`datetime-local` inputs use local time with no seconds or timezone
(`YYYY-MM-DDTHH:mm`); the URL and the API use full ISO 8601 strings.
`toIsoOrUndefined` / `toDatetimeLocalValue` in `run-filters.tsx` convert
between the two at the edges, so the rest of the app only ever deals in
real ISO strings.

## Alternatives considered

- **`SameSite=None; Secure` cookies with CORS**, calling the API's own
  origin directly. Rejected: needs HTTPS even in local dev, and adds
  CSRF considerations the same-origin proxy avoids by construction.
- **Have `proxy.ts` validate the session against the database on every
  request.** Rejected: turns every navigation into an extra network
  round trip to save a redirect the app already has to handle anyway on
  the client side; the convenience check exists to make the common case
  (no cookie at all) fast, not to replace real authentication.
- **Client-side cookie deletion instead of calling `/auth/logout`.**
  Not viable: the session cookie is `httpOnly` by design (ADR-0005), so
  no client-side script can read or clear it. Ending a session has to
  go through the server.

## Consequences

- Gain: a working login/signup/dashboard flow verified against a real
  browser and real data (seeded traces with varied statuses, agents,
  and timestamps), not just a passing typecheck and build.
- Gain: a previously-undetectable auth bug (the redirect loop) caught
  before it reached a real user, plus a small correctness fix to
  logout that outlives this milestone.
- Give up: `proxy.ts`'s convenience check means a signed-out visitor
  briefly reaches a protected page's shell before the real 401 kicks in
  redirects them, in the rare case their cookie was cleared between the
  proxy check and the page's own data fetch. Acceptable, this is a
  narrower window than the alternative of validating on every request.
