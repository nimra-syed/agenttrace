# CLI onboarding and installation credentials: design document

Status: Draft, pre-implementation. Not an ADR yet, on purpose: this
covers a milestone (or a few) that hasn't started, and this project's own
convention is to write an ADR at the milestone where a decision is
actually implemented, not before. Writing this doc now, and turning
parts of it into real ADRs once each milestone below is built, avoids
the exact gap M12 hit (code comments referencing "ADR-0016" for weeks
before the ADR itself existed).

## 1. Problem statement

BeautyLab (a separate, real application using the AgentTrace SDK) proved
the core product works end to end: real Gemini traces, an OpenAI trace
that failed on billing and was still correctly recorded as an `ERROR`,
agent-name filtering, and evaluation, all verified live. Getting
BeautyLab connected required manually creating a project API key in the
dashboard and pasting it into a `.env` file by hand.

That's fine for one person setting up one app once. It doesn't scale to
a team, a research lab, a university course, or an open-source project
with many contributors, because the only two options today are:

- **Share one project API key** across everyone. Nobody can tell whose
  traffic is whose, revoking access for one person revokes it for
  everyone, and the raw secret ends up copy-pasted into more places
  (Slack, email, shared docs) than anyone can track.
- **An admin manually creates N keys**, one per person, and hands each
  one out of band. This doesn't scale operationally past a handful of
  people, and every manual handoff of a raw secret is itself a leak
  surface, the same reasoning this project's own credential-hygiene
  rule already applies to local dev secrets.

The goal: a self-service `agenttrace connect` flow where a person
authenticates as themselves (not with a shared secret), picks a project
they already have access to, and gets their own individually-revocable
credential, with no raw secret ever manually typed, copied, or shared.

## 2. Challenging the assumption in the proposed UX

The prompt that led to this doc describes a device-flow-shaped UX:
"browser opens, user signs in, picks a project, CLI receives a
credential." That's the right shape, but it's worth being precise about
*which* OAuth-family pattern actually fits, because there are two real,
IETF-standardized options that look similar but solve different
problems:

- **RFC 8628, OAuth 2.0 Device Authorization Grant.** The user runs the
  CLI on one device (often headless: an SSH session, a smart TV, a CI
  runner), the CLI shows a short code, and the user enters that code on
  a *different* device's browser. Built for the case where the CLI's own
  device has no browser and can't receive a redirect.
- **RFC 8252, OAuth 2.0 for Native Apps**, using a loopback
  (`127.0.0.1`) redirect URI and PKCE. Built for the case where the CLI
  runs on the *same* machine as the browser, and can start a temporary
  local HTTP server to receive the redirect directly, no code to type,
  no polling loop.

AgentTrace's actual primary scenario, a developer running `npx
@agenttrace/cli connect` on their own laptop, right next to the browser
they'll authenticate in, is exactly the RFC 8252 case, not the RFC 8628
case. Device-flow's typed-code-and-poll UX exists to solve a problem
(no local browser) that doesn't apply here. Building it first would mean
more moving parts (a polling loop, a code-expiry countdown, a
rate-limited poll endpoint) for a worse UX in the common case.

**Recommendation: build the loopback+PKCE flow (RFC 8252) first.** It's
simpler to implement, simpler to use, and is what `gh auth login`,
`vercel login`, `wrangler login`, `supabase login`, and `railway login`
all actually do today for exactly this scenario. Device-flow is a real,
worthwhile addition later for headless/remote-dev cases (SSH'd into a
devbox, Codespaces, a container with no loopback reachable from the
host's browser), and is called out under Future extensibility below,
not dropped.

A second assumption worth surfacing explicitly: **this flow is not a
replacement for project API keys.** It solves the "a human is sitting at
a laptop connecting their own dev environment" case. It does nothing for
the "no human is present" case: a CI pipeline, a deployed production
agent, a scheduled job. Those need an impersonal, purpose-scoped,
admin-provisioned credential, which is exactly what today's `ApiKey`
already is. The design below keeps both credential types, on purpose,
because they answer different questions ("which human connected this"
vs "which system is this credential for") and have different revocation
and rotation needs. This isn't a "pick a winner" decision.

## 3. Overall architecture

Three new pieces, layered on top of everything M1-M12 already built,
reusing rather than replacing the existing org/project/session model:

1. **`Installation`**, a new database model: a project-scoped,
   user-attributed, individually-revocable credential, authenticated the
   same way `ApiKey` is (a bearer token, hashed at rest, checked by a
   guard on the ingestion path). Distinct from `ApiKey` because it
   answers a different question (see above), but deliberately
   authenticated through the same mechanism so ingestion code and the
   SDK need zero changes.
2. **A loopback OAuth-style authorize/approve/exchange flow**, entirely
   new backend surface (a browser-facing authorize page, a
   session-authenticated approve action, a token exchange endpoint), reusing the
   existing session auth, CSRF protection, and project-authorization
   logic (`ProjectsService.findOwnedProject` style checks) that already
   gate everything else in the dashboard.
3. **`@agenttrace/cli`**, a new publishable package: starts a local
   loopback server, opens the browser, receives the callback, exchanges
   the code for a real credential, writes it into the target app's
   `.env`, and sends one real smoke trace to confirm the whole path
   works.

None of this touches `packages/sdk`, `packages/shared-types`'
trace/span contracts, or the existing `ApiKey`/session/CSRF systems.
It's additive.

## 4. Authentication flow, step by step

1. `agenttrace connect` starts a temporary HTTP server bound to
   `127.0.0.1` on an OS-assigned free port. It generates a random
   `state` value (CSRF protection on the callback) and a PKCE
   `code_verifier`/`code_challenge` pair (RFC 7636). PKCE matters even
   for a first-party flow: it's cheap, and it's exactly the defense this
   scenario calls for, since any other local process could in principle
   try to race the CLI for the redirect.
2. The CLI opens the system browser to
   `https://app.agenttrace.dev/cli/authorize?state=...&redirect_uri=http://127.0.0.1:PORT/callback&code_challenge=...`.
3. If the browser doesn't already have a valid session, the existing
   login page (ADR-0005) handles that first, then returns to the
   authorize page.
4. The authorize page (new, dashboard-side) shows which projects the
   signed-in user actually has access to (reusing the existing
   `GET /projects` authorization scoping, no new access-control logic
   needed) and lets them pick one. It should also make clear this is a
   new CLI connection request, so approving it is a deliberate act, not
   a blind click-through.
5. Approving calls a new, session-authenticated, CSRF-protected endpoint
   that creates an `Installation` row (project + the approving user +
   an auto-generated label like "Nimra's MacBook, 2026-07-31") and a
   short-lived, single-use authorization code bound to it and to the
   PKCE `code_challenge`. The raw installation secret is *not* returned
   here.
6. The browser is redirected to
   `http://127.0.0.1:PORT/callback?code=...&state=...`. The CLI checks
   `state` matches what it generated before doing anything else.
7. The CLI calls a token-exchange endpoint directly (not through the
   browser) with the `code` and its own `code_verifier`, and gets back
   the raw installation secret, exactly once.
8. The CLI writes that secret into the target app's `.env` (never
   printing it to the terminal, matching this project's existing
   credential-hygiene rule verbatim) and sends one real trace through
   the normal ingestion API to confirm the connection actually works.
9. It prints a plain confirmation and a link to view that trace in the
   dashboard.

**Why the indirection in steps 5-7 (a short-lived code, not the secret,
in the redirect)?** The redirect URL is a comparatively unsafe channel
for a long-lived secret: it can land in browser history, and it's the
one hop in this whole flow that isn't the CLI-to-API HTTPS channel this
project already trusts everywhere else. A code that's single-use,
short-lived (on the order of a minute), and useless without the PKCE
verifier only the requesting CLI process holds is the standard mitigation,
and it's why every real OAuth flow works this way rather than putting
the final token straight in a redirect.

## 5. Installation credential lifecycle

- **Created** at browser-approval time (step 5 above), scoped to exactly
  one project, attributed to exactly one user.
- **Used** on every ingestion request via the same bearer-token header
  ingestion already expects; `lastUsedAt` updates with the same
  once-per-hour throttling `ApiKey` already uses (ADR-0008), no new
  behavior to invent there.
- **Status shown in the dashboard is derived, not a new column.**
  "Pending" means the row exists but `lastUsedAt` is still null (approved
  in the browser, but the CLI hasn't successfully sent anything yet).
  "Connected" means `lastUsedAt` is set and `revokedAt` is null.
  "Revoked" means `revokedAt` is set. This is what makes the onboarding
  flow feel immediate without any push infrastructure: the row appears
  the instant the browser approval happens, so someone with the
  dashboard open would see "Pending" turn into "Connected" a moment
  later, purely from data that already exists.
- **Revoked**, not deleted: sets `revokedAt` (and, new here,
  `revokedByUserId`, so the dashboard can show who revoked it, not just
  when). A revoked installation must fail authentication with the exact
  same generic message as a missing, malformed, or unknown credential,
  the same "don't let one error message reveal more than another"
  discipline `ApiKeyGuard` already follows, extended to cover this new
  credential type.
- **Revocation is a server-side control, not a client-side one.** The
  CLI's own `disconnect` command is a convenience (it can call the
  revoke endpoint itself, using the credential to revoke itself), but
  the actual security boundary is the dashboard's revoke action. A
  leaked local `.env` must be revocable from the dashboard with zero
  cooperation from wherever the leak happened.

## 6. Local configuration strategy

Two genuinely different "local state" concerns, worth keeping separate:

- **The target application's credential** lives in that application's
  own `.env` (or `--env-file`), in exactly the variable name
  `packages/sdk` already reads. This means the SDK needs no changes at
  all to consume an installation credential: from its perspective it's
  just a bearer token, the same shape an `ApiKey` already is.
- **The CLI's own transient state** (the PKCE verifier, the `state`
  value, the local server) only needs to live for the duration of one
  `connect` invocation. It does not need a separate, persistent,
  cross-invocation session store: `whoami`, `status`, and `disconnect`
  should all just read whatever `.env` they're pointed at and ask the
  API "what does this credential resolve to," rather than maintaining a
  second source of truth that could drift from the `.env` file. One
  source of truth (the `.env`) is simpler and cannot get out of sync
  with itself.

## 7. CLI command design

Package: `packages/cli`, published as `@agenttrace/cli`, alongside
`packages/sdk` and `packages/shared-types` in the existing workspace
convention (a reusable, installable tool, not a running service, so
`packages/`, not `apps/`).

- `agenttrace connect [--project <id>] [--env-file <path>] [--name <label>]`:
  the flow above. `--project` skips the picker for someone who already
  knows which project they want (the browser approval step still
  happens, this only trims a UI step, not the auth). `--env-file`
  targets a non-default location. The application's user-facing label
  (what shows up as "Connected Applications" in the dashboard) is
  auto-derived with zero prompting: the target directory's
  `package.json` `name` field if present, otherwise the directory's own
  name, otherwise `<user>@<hostname>`. This is what produces
  app-shaped names ("BeautyLab," "reference-agent") in the common case
  instead of device-shaped ones, without asking the person running
  `connect` to type anything. `--name` overrides it explicitly; it can
  also be renamed later from the dashboard. The CLI prints whatever name
  it chose ("Connecting as \"BeautyLab\"...") so it's never a silent
  guess.
- `agenttrace whoami` / `agenttrace status`: reads the target `.env`,
  asks the API to resolve that credential, prints project/org and
  installation label. Fails with a clear message if the credential is
  missing or has been revoked.
- `agenttrace disconnect`: revokes the credential (self-revocation,
  possessing a valid credential is sufficient proof to revoke itself)
  and removes it from the `.env`.
- `agenttrace test`: (re-)sends a smoke trace using whatever credential
  is currently configured. Useful standalone, not just as the last step
  of `connect`.

## 8. Dashboard changes

### Naming: "Installation" internally, "Connected Applications" in the UI

`Installation` stays the model, service, module, and route name
(`InstallationsService`, `/projects/:id/installations`), matching this
project's own naming everywhere else. Only user-facing surfaces, the
React component and its copy, say "Connected Applications." This is the
same split M10 already established without stating it explicitly:
`ApiKeysPanel` shows an "API Keys" heading over what the backend calls
an `ApiKey`; here, the component would be named
`ConnectedApplicationsPanel`, showing a "Connected Applications"
heading, while still calling `listInstallations`/`revokeInstallation`
underneath. Stating the rule explicitly this time so it doesn't drift
inconsistently across the three milestones that touch it.

### Pages and panels

- A new `/cli/authorize` page: a project picker, an explicit approve
  action, and an inline "+ New project" option right there (so
  connecting a brand-new setup never requires leaving to a separate
  dashboard tab and coming back). One clarification worth being precise
  about: ADR-0006 gives every user exactly one organization, created
  automatically at signup. "Choose or create an organization" in the
  ideal onboarding flow, today, means "your one organization already
  exists from signup, choose or create a project within it," not
  multi-organization support, since nothing here needs that to change.
- A new "Connected Applications" panel in project settings, next to the
  existing API Keys panel (M10), following the exact same UX
  conventions already established there: list view (application name,
  connecting user, created, last used, status), inline confirm/cancel
  revoke (not a native `confirm()` dialog, for the same reason M10
  chose that), no "view secret again" affordance, since there's no
  backend guarantee to support one. Status shown per row is Pending,
  Connected, or Revoked (section 5).

## 9. Backend/API changes

- A new module (`InstallationsModule`, or folded alongside a
  generalized credentials concept) providing: the authorize page's
  project-listing data (reuses `ProjectsService`), the approve action
  (creates `Installation` + a short-lived code), the token-exchange
  endpoint (public, but rate-limited, and only ever succeeds once per
  code), list and revoke actions for the dashboard panel.
- **A real decision to make explicitly, not bury in implementation**:
  does ingestion's existing `ApiKeyGuard` grow a second lookup path (for
  `Installation.tokenHash` alongside `ApiKey.tokenHash`), or is there a
  more generalized `Credential` lookup both tables satisfy? Either
  works. The guard-level generalization keeps `ApiKey` and
  `Installation` as separate, purpose-built tables (recommended, see
  the schema sketch below) while presenting one authentication surface
  to every route that doesn't care which kind of credential
  authenticated the request, exactly the same way `SessionGuard` and
  `ApiKeyGuard` today don't need to know about each other.
- New named throttlers (the authorize/approve/exchange endpoints likely
  need their own rate limits) are a concrete, immediate case where the
  M12-discovered `ThrottlerGuard` cumulative-throttler behavior applies
  again: adding a new named throttler here means re-auditing every
  other already-throttled route for a matching `@SkipThrottle()`, not
  just adding the new one. Worth remembering before, not after, this
  time.

## 10. Database/schema changes (illustrative, not final)

```
model Installation {
  id              String    @id @default(uuid())
  projectId       String
  createdByUserId String
  label           String
  tokenHash       String    @unique
  lastUsedAt      DateTime?
  revokedAt       DateTime?
  revokedByUserId String?
  createdAt       DateTime  @default(now())

  project        Project @relation(fields: [projectId], references: [id])
  createdByUser  User    @relation("InstallationCreatedBy", fields: [createdByUserId], references: [id])
  revokedByUser  User?   @relation("InstallationRevokedBy", fields: [revokedByUserId], references: [id])

  @@index([projectId])
}

model CliAuthorizationCode {
  id             String   @id @default(uuid())
  codeHash       String   @unique
  installationId String   @unique
  codeChallenge  String
  expiresAt      DateTime
  usedAt         DateTime?
  createdAt      DateTime @default(now())
}
```

Same conventions as everything already in the schema: hashed secrets at
rest (never the raw code or token), `revokedAt`/`usedAt` rather than
deletion, so the row itself is the audit trail.

**New addition, worth flagging on its own**: a nullable
`Trace.installationId`, set only when a trace is ingested using an
Installation credential, always null for `ApiKey`-authenticated
ingestion and for every trace that exists before this migration. This
is what would eventually let the Connected Applications panel show
"last active 2 minutes ago, reporting as `skincare-agent`," not just a
bare timestamp. It's cheap to add now, purely additive, and doesn't
touch the existing `ApiKey` ingestion path at all; it would be
expensive to retrofit later, since traces ingested before the column
existed could never get it backfilled. Whether the UI actually surfaces
this in M14 or waits, the column is worth adding in M13's migration
regardless, since that's the one moment it's nearly free.

## 11. Security considerations

- PKCE (RFC 7636) on the authorization code exchange.
- `state` parameter, checked before the CLI does anything else with the
  callback.
- Authorization codes: short-lived, single-use, hashed at rest, bound to
  one pre-created `Installation` row and one `code_challenge`.
- The local server binds to `127.0.0.1` only, never `0.0.0.0`, so it's
  unreachable from the network, only from the same machine.
- Installation secrets: same generation (`crypto.randomBytes`) and
  storage (hashed, never plaintext) discipline as every existing
  session token and API key. Nothing new invented here on purpose.
- The revoked/unknown/missing/malformed credential error message stays
  uniform, extending the existing `ApiKeyGuard` rule to cover
  `Installation` too.
- The authorize page must show what's being approved (which project,
  ideally some identifying info about the requesting device) clearly
  enough that approving isn't a blind click-through.

## 12. Audit logging

Worth scoping honestly rather than folding a much bigger feature into
this one. Two different things are both called "audit logging" here:

- **Minimum viable, in scope for this work**: `Installation`'s own
  fields (`createdByUserId`, `createdAt`, `revokedAt`,
  `revokedByUserId`) already answer "who connected this, when, who
  revoked it, when," which is most of what matters for this specific
  feature.
- **A general, cross-cutting audit log** (every login, every project
  created, every key or installation created or revoked, every
  evaluation triggered, in one append-only event table) is a
  meaningfully bigger, separate capability that would benefit the whole
  product, not just this feature. Recommendation: don't build it as part
  of installation credentials. Treat it as its own future milestone once
  there's a concrete enough need to shape its design around, the same
  reasoning this project already applies to every other piece of
  deferred infrastructure.

## 13. SDK implications

None required. An installation credential authenticates exactly the way
an API key already does (a bearer token in the same header), so
`packages/sdk` needs zero changes to consume one. The only optional,
non-required future enhancement: a clearer client-side error message
when a credential has been revoked specifically (today, and after this
work, a revoked credential and an unknown one return the same generic
401 on purpose, so the SDK can't distinguish them without giving up that
security property, and shouldn't).

## 14. Tradeoffs across the real options

**Permanent project API keys (today's model, ADR-0007).**
Already built, zero new infrastructure, exactly right for the
no-human-present case (CI, deployed agents). Wrong for the many-people
case: either one shared secret (no attribution, no selective
revocation) or an admin manually provisioning and handing out N keys
(doesn't scale, and every handoff is a leak surface).

**Installation credentials, loopback + PKCE (recommended primary flow).**
Self-service, no admin bottleneck, per-install revocation, attributable
to a human, zero manually-typed or copy-pasted secrets, reuses all of
the existing org/project/session authorization logic. The real cost:
this is a genuinely bigger implementation than any single milestone so
far (a new OAuth-shaped flow, a new dashboard page, a new backend
surface, a new publishable package), and it's new security-sensitive
code that needs tests from day one, not deferred, the same standard
this project already holds itself to elsewhere.

**True device-flow (RFC 8628).**
The right tool for headless/remote-dev environments where no local
browser can receive a loopback redirect. Objectively worse UX than
loopback+PKCE when a local browser *is* available (typing/comparing a
code, a polling delay). Worth adding later, not instead of, the loopback
flow.

**Personal access tokens, copy-paste style.**
The simplest possible version of "each person gets their own
credential": a dashboard page generates a token, the person pastes it
into `agenttrace connect --token <value>` once. Still per-user, still
individually revocable, a legitimate, honest fallback if the full
browser flow turns out to be too much to build first. The real
downside is exactly the one manual copy-paste step this whole feature
is trying to remove, and a small residual risk of that paste landing
somewhere unsafe (shell history) if someone isn't careful. Worth naming
as the fast, minimal version if timeline pressure ever calls for
cutting scope.

**Service accounts.**
Not a competing option, a complementary one: exactly what today's
`ApiKey` already is, kept as-is for the automation case. The design
above doesn't ask "which model wins," it keeps both, because they
answer different questions.

## 15. The onboarding experience, made concrete

"Make onboarding feel effortless" is only useful as a goal if it turns
into specific, checkable things, not a vibe to hold in mind while
building. Concretely, for someone starting from nothing:

- **Zero required typing during `connect` itself.** Signing in happens
  in the browser (already how login works, ADR-0005), the application
  name is auto-derived (section 7), and the project picker defaults to
  the one project a brand-new signup already has (ADR-0006's
  auto-created org means there's never a "you have nothing to pick
  from" dead end).
- **No tab-switching to set anything up first.** If someone genuinely
  has nothing yet, "+ New project" lives inline on the authorize page
  itself (section 8), not on a different screen they'd have to
  navigate to and back from.
- **Visible progress, not a silent wait.** The Installation row exists
  the moment the browser approval happens, before the CLI has even
  finished the token exchange. Someone with the dashboard open sees
  Pending flip to Connected within a couple of seconds, from data that
  already exists (section 5), not from new real-time infrastructure.
- **The CLI's own terminal output confirms each step as it happens**
  ("Opening browser...", "Connecting as \"BeautyLab\"...", "Sending a
  test trace...", "Connected. View it at <link>"), so someone watching
  the terminal instead of the dashboard gets the same sense of
  progress.

Notably, none of this requires new infrastructure beyond what M13-M15
already build. "Feels magical" here is really "every step that could
require a manual action (typing a name, finding a project, switching
tabs, wondering whether it worked) has a good enough default or a
visible signal that it removes the need for one," not a new capability
layered on top.

## 16. Recommendation

Build the loopback+PKCE installation-credential flow (RFC 8252 style) as
the primary onboarding path, exactly matching the nine-step UX
described in the original prompt. Keep project API keys unchanged for
the service-account/CI case, don't rename or deprecate anything there.
Defer true device-flow to a later milestone, scoped specifically around
headless/remote-dev support once that's a concrete need, not a
hypothetical one. Defer a general, cross-cutting audit log to its own
future milestone; this feature's own `Installation` row fields are
enough audit trail for what this feature itself needs.

## 17. Proposed milestone breakdown

Mirrors this project's own established rhythm (API keys went backend at
M3, UI at M10; evaluation went backend-then-frontend as two checkpoints
within M12). This feature is bigger than either of those, so it gets
full milestone numbers rather than sub-checkpoints:

### M13: Installation credential backend

Schema (`Installation`, `CliAuthorizationCode`, and the nullable
`Trace.installationId` provenance column), the
authorize/approve/exchange endpoints, list/revoke actions, the
generalized credential lookup on the ingestion path, unit tests for all
of it, an ADR written at this milestone (not before, not after).

**Acceptance criteria**: a session-authenticated user can call the
approve endpoint directly (curl, matching how M3's API keys were
verified before any UI existed), receive a working installation
credential via the code-exchange endpoint, use it to ingest a real trace
through the existing public ingestion API (confirming `installationId`
is actually set on that trace and never set on `ApiKey`-authenticated
ones), and revoke it, all verified live, no dashboard UI or CLI involved
yet.

### M14: Dashboard authorize page and Connected Applications UI

The `/cli/authorize` project-picker-and-approve page (with inline
project creation), and the project settings "Connected Applications"
panel (list, revoke, Pending/Connected/Revoked status), matching M10's
established UX conventions exactly, with the `Installation`-internally
`ConnectedApplications`-in-the-UI naming split from section 8 applied
consistently.

**Acceptance criteria**: a real person, in a real browser, completes the
approve step for a real (manually-simulated, since the CLI doesn't
exist yet) redirect, can create a brand-new project inline during that
flow without leaving the page, and can see (with correct Pending vs.
Connected status) and revoke Connected Applications from project
settings. Verified live in a browser, not just with Playwright.

### M15: `@agenttrace/cli` package and full end-to-end connect flow

The actual CLI: the loopback server, PKCE, opening the browser, the
callback, the code exchange, application-name auto-derivation, writing
the target app's `.env`, sending the smoke trace, per-step terminal
output.

**Acceptance criteria**: `npx @agenttrace/cli connect`, run against a
real separate application (the same role BeautyLab played for the SDK),
genuinely works end to end against the real dashboard with zero required
prompts, produces a sensible auto-derived application name without
being told one, and the resulting Connected Application is visible in
the dashboard immediately after. No raw secret ever manually typed or
copied by the person running it.

### Future extensibility (not yet scoped into a milestone)

- True device-flow (RFC 8628) for headless/remote-dev environments.
- A general, cross-cutting audit log covering more than installation
  credentials.
- Scoped/limited-permission credentials (for example, ingest-only vs
  read-only), if a real need for that distinction ever shows up.
- A CLI `init` command that scaffolds a starter SDK integration, not
  just connects an existing one.
- The SDK surfacing a clearer client-side message when a credential has
  specifically been revoked, if that's ever worth the tradeoff against
  today's deliberately uniform error message.
