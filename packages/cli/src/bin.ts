#!/usr/bin/env node
import { connect } from "./commands/connect.js";
import { disconnect } from "./commands/disconnect.js";
import { init } from "./commands/init.js";
import { testConnection } from "./commands/test.js";
import { whoami } from "./commands/whoami.js";

const DEFAULT_DASHBOARD_URL = "http://localhost:3001";
const DEFAULT_API_URL = "http://localhost:3000";

interface ParsedArgs {
  command?: string;
  envFile?: string;
  name?: string;
  force: boolean;
  assumeYes: boolean;
  dashboardUrl?: string;
  apiUrl?: string;
}

// Hand-rolled on purpose: four subcommands, three flags total is small
// enough that adding a dependency (commander/yargs/cac) for this would
// be more code and more install weight than parsing argv directly.
// Nothing suitable is already present in this monorepo either
// (confirmed by checking every package.json and the lockfile).
function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const args: ParsedArgs = { command, force: false, assumeYes: false };

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case "--env-file":
        args.envFile = rest[++i];
        break;
      case "--name":
        args.name = rest[++i];
        break;
      case "--force":
        args.force = true;
        break;
      case "--yes":
        args.assumeYes = true;
        break;
      case "--dashboard-url":
        args.dashboardUrl = rest[++i];
        break;
      case "--api-url":
        args.apiUrl = rest[++i];
        break;
      default:
        console.error(`Unrecognized argument: ${flag}`);
        process.exitCode = 1;
        return args;
    }
  }

  return args;
}

// No command at all, `--help`, or `-h` all print usage as a deliberate,
// successful action, not an error: exit 0. Anything else unrecognized
// (a typo, a command that doesn't exist) also prints usage, but exits
// 1, since that's a real failure to act on the given input. Exported
// and pure so this exact contract is unit-testable without exercising
// real command dispatch or process.exit().
export function usageExitCode(command: string | undefined): number {
  return command === undefined || command === "--help" || command === "-h"
    ? 0
    : 1;
}

function printUsage(): void {
  console.log(`Usage: agenttrace <command> [options]

Commands:
  init         Install the SDK, connect, and scaffold example files
  connect      Connect this application to an AgentTrace project
  whoami       Show which project this application is connected to
  status       Alias for whoami
  disconnect   Remove the locally stored connection
  test         Send a test trace using the stored connection

Options:
  --env-file <path>       Path to the .env file to read/write (default: ./.env)
  --name <label>          Override the auto-derived connection name (connect, init)
  --force                 Skip confirmations that would overwrite something
                          (an existing .env connection for connect/init; also
                          regenerates existing scaffold files for init)
  --yes                   Skip init's upfront plan confirmation (non-interactive use)
  --dashboard-url <url>   Default: ${DEFAULT_DASHBOARD_URL}
  --api-url <url>         Default: ${DEFAULT_API_URL}
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (process.exitCode) return;

  const envFile = args.envFile ?? "./.env";
  const dashboardUrl =
    args.dashboardUrl ??
    process.env.AGENTTRACE_DASHBOARD_URL ??
    DEFAULT_DASHBOARD_URL;
  const apiUrl =
    args.apiUrl ?? process.env.AGENTTRACE_CLI_API_URL ?? DEFAULT_API_URL;

  switch (args.command) {
    case "init":
      await init({
        envFile,
        name: args.name,
        assumeYes: args.assumeYes,
        force: args.force,
        dashboardUrl,
        apiUrl,
      });
      break;
    case "connect":
      await connect({
        envFile,
        name: args.name,
        force: args.force,
        dashboardUrl,
        apiUrl,
      });
      break;
    case "whoami":
    case "status":
      await whoami({ envFile, dashboardUrl });
      break;
    case "disconnect":
      await disconnect({ envFile });
      break;
    case "test":
      await testConnection({ envFile });
      break;
    default:
      printUsage();
      process.exitCode = usageExitCode(args.command);
  }
}

// Guarded so importing this module (e.g. from a test, to reach
// `usageExitCode`) never triggers a real CLI run or the explicit
// process.exit() below. True only when this file is actually executed
// as the entry point, exactly as `node dist/bin.js` (or the shebang
// itself) does, in both the raw source and esbuild's bundled output.
if (require.main === module) {
  main()
    .catch((err: unknown) => {
      console.error(
        err instanceof Error ? err.message : "Something went wrong.",
      );
      process.exitCode = 1;
    })
    .finally(() => {
      // An explicit exit, not just letting the event loop drain on its
      // own: confirmed live that Node's built-in fetch (undici) can leave
      // an idle keep-alive socket open well past when this CLI's actual
      // work is done, which would otherwise leave the process hanging
      // indefinitely instead of returning control to the shell. This is
      // expected, benign fetch/undici behavior, not a leak in this code
      // (every timeout this package sets is explicitly cleared, and the
      // loopback server is explicitly closed before this point) -- the
      // right fix for a CLI (never a long-running server) is to exit
      // explicitly once real work is finished, not to chase closing a
      // socket undici manages internally.
      process.exit(process.exitCode ?? 0);
    });
}
