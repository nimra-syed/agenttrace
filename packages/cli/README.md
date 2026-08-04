# @agenttraceai/cli

Connects a local application to an AgentTrace project without ever
manually copying a secret, and scaffolds the SDK setup itself. See
`docs/architecture/cli-onboarding-design.md`, `docs/architecture/cli-init-design.md`,
and ADR-0017.

## Usage

```bash
agenttrace init [--env-file <path>] [--name <label>] [--yes] [--force]
agenttrace connect [--env-file <path>] [--name <label>] [--force]
agenttrace whoami
agenttrace disconnect
agenttrace test
```

`init` installs `@agenttraceai/sdk` if it's missing, connects the
project (or reuses an existing working connection), generates
`agenttrace.ts`/`.js` (a configured client) and
`agenttrace.example.ts`/`.js` (a copy-from usage example) in the
current directory, and sends a smoke trace. It shows exactly what it's
about to do, built from what's actually missing, before doing any of
it. Existing scaffold files are left alone by default; pass `--force`
to regenerate them.

`connect` does the credential half of the same flow on its own, for a
project that already has the SDK wired up and just needs a connection.
Both write `AGENTTRACE_API_KEY`/`AGENTTRACE_BASE_URL` into `.env` (or
whatever `--env-file` points at). The connection name shown in the
dashboard is auto-derived from `package.json`'s `name` field, falling
back to the directory name, then `user@hostname`; override with
`--name`.

If `.env` already has a connection configured, `connect`/`init` ask
before overwriting it. Pass `--force` to skip that prompt; pass `--yes`
to skip `init`'s upfront plan confirmation too (for non-interactive/CI
use). Every prompt requires a real interactive terminal or the
relevant flag — it fails fast with a clear message rather than hanging
if neither is available.

`disconnect` only removes the credential locally: fully revoking it
still requires the project's Connected Applications settings in the
dashboard (see ADR-0017 for why no self-revoke endpoint exists yet).

## Local development

```bash
pnpm --filter @agenttraceai/cli build
node packages/cli/dist/bin.js init
```

Defaults to `http://localhost:3001` (dashboard) and
`http://localhost:3000` (API); override with `--dashboard-url`/
`--api-url` or `AGENTTRACE_DASHBOARD_URL`/`AGENTTRACE_CLI_API_URL`.
