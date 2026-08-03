# @agenttrace/cli

Connects a local application to an AgentTrace project without ever
manually copying a secret. See
`docs/architecture/cli-onboarding-design.md` and ADR-0017.

## Usage

```bash
agenttrace connect [--env-file <path>] [--name <label>] [--force]
agenttrace whoami
agenttrace disconnect
agenttrace test
```

`connect` opens your browser to approve the connection, then writes
`AGENTTRACE_API_KEY`/`AGENTTRACE_BASE_URL` into `.env` (or whatever
`--env-file` points at) in the current directory. The connection name
shown in the dashboard is auto-derived from `package.json`'s `name`
field, falling back to the directory name, then `user@hostname`;
override with `--name`.

If `.env` already has a connection configured, `connect` asks before
overwriting it. Pass `--force` to skip that prompt (for scripted use).

`disconnect` only removes the credential locally: fully revoking it
still requires the project's Connected Applications settings in the
dashboard (see ADR-0017 for why no self-revoke endpoint exists yet).

## Local development

```bash
pnpm --filter @agenttrace/cli build
node packages/cli/dist/bin.js connect
```

Defaults to `http://localhost:3001` (dashboard) and
`http://localhost:3000` (API); override with `--dashboard-url`/
`--api-url` or `AGENTTRACE_DASHBOARD_URL`/`AGENTTRACE_CLI_API_URL`.
