import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentTraceClient } from "@agenttraceai/sdk";
import open from "open";
import { runConnectFlow } from "../lib/connect-flow.js";
import { readEnvValue, setEnvValues } from "../lib/env-file.js";
import { deriveLabel } from "../lib/label.js";
import {
  buildInstallCommand,
  detectPackageManager,
  hasDependency,
  installDependency,
} from "../lib/package-manager.js";
import { confirm } from "../lib/prompt.js";
import {
  detectProjectFormat,
  runExampleCommand,
  scaffoldFiles,
  writeScaffoldFiles,
} from "../lib/scaffold.js";
import {
  ConnectionInvalidError,
  type ConnectionContext,
  verifyConnection,
} from "../lib/verify-connection.js";

export interface InitOptions {
  envFile: string;
  name?: string;
  assumeYes: boolean;
  force: boolean;
  dashboardUrl: string;
  apiUrl: string;
}

const SDK_PACKAGE_NAME = "@agenttraceai/sdk";

// Composes the pieces M13-M15 already built (the connect flow, the
// smoke trace) with two new ones (dependency installation, scaffold
// generation), so a developer ends up with a working, connected SDK
// setup and a real example to copy from, not just a credential. See
// docs/architecture/cli-init-design.md.
export async function init(options: InitOptions): Promise<void> {
  const cwd = process.cwd();

  // A stricter precondition than `connect` needs: deriveLabel already
  // tolerates a missing package.json gracefully, fine for connect since
  // it never writes a dependency declaration anywhere. init does, so it
  // needs a real package.json to exist first.
  if (!existsSync(join(cwd, "package.json"))) {
    console.log(
      "No package.json found here. Run `npm init` (or your package manager's equivalent) first, then re-run `agenttrace init`.",
    );
    process.exitCode = 1;
    return;
  }

  const needsInstall = !hasDependency(cwd, SDK_PACKAGE_NAME);

  const existingKey = readEnvValue(options.envFile, "AGENTTRACE_API_KEY");
  const existingBaseUrl = readEnvValue(options.envFile, "AGENTTRACE_BASE_URL");
  const existingContext = await resolveExistingConnection(
    existingKey,
    existingBaseUrl,
  );
  const needsConnect = existingContext === null;

  const format = detectProjectFormat(cwd);
  const files = scaffoldFiles(format);
  const filesToWrite = files.filter(
    (file) => options.force || !existsSync(join(cwd, file.fileName)),
  );
  const filesToWriteNames = new Set(filesToWrite.map((f) => f.fileName));

  // A fast, safe no-op when everything's already in place: this is what
  // makes re-running `init` idempotent in the fully-set-up case. Never
  // reached under --force, since that always includes every scaffold
  // file in filesToWrite regardless of whether it already exists.
  if (!needsInstall && !needsConnect && filesToWrite.length === 0) {
    console.log("Already set up.");
    console.log(`Project: ${(existingContext as ConnectionContext).projectId}`);
    console.log(
      `View it at ${new URL(`/projects/${(existingContext as ConnectionContext).projectId}/runs`, options.dashboardUrl).toString()}`,
    );
    return;
  }

  printPlan({
    needsInstall,
    needsConnect,
    existingProjectId: existingContext?.projectId,
    files,
    filesToWriteNames,
  });

  const proceed = await confirm("Continue? [Y/n]", {
    assumeYes: options.assumeYes,
    flagHint: "--yes",
  });
  if (!proceed) {
    console.log("Cancelled. Nothing was changed.");
    return;
  }

  if (needsInstall) {
    const manager = detectPackageManager(cwd);
    const install = buildInstallCommand(manager, SDK_PACKAGE_NAME);
    console.log(
      `Installing ${SDK_PACKAGE_NAME} (${install.command} ${install.args.join(" ")})...`,
    );
    await installDependency(cwd, install);
  }

  const label = options.name ?? deriveLabel(cwd);

  let token: string;
  let projectId: string;
  if (needsConnect) {
    const result = await runConnectFlow({
      label,
      dashboardUrl: options.dashboardUrl,
      apiUrl: options.apiUrl,
    });
    token = result.token;
    projectId = result.projectId;

    if ((existingKey ?? existingBaseUrl) && !options.force) {
      const overwrite = await confirm(
        `${options.envFile} already has a connection configured. Overwrite it? [y/N]`,
        { assumeYes: false, flagHint: "--force" },
      );
      if (!overwrite) {
        console.log(
          "Connected, but kept the existing .env unchanged. Update it manually if you want to use the new connection.",
        );
        return;
      }
    }
    setEnvValues(options.envFile, {
      AGENTTRACE_API_KEY: token,
      AGENTTRACE_BASE_URL: options.apiUrl,
    });
    console.log(`Saved your connection to ${options.envFile}.`);
  } else {
    // existingContext is non-null whenever needsConnect is false.
    token = existingKey as string;
    projectId = (existingContext as ConnectionContext).projectId;
  }

  const { written, skipped } = writeScaffoldFiles(cwd, format, options.force);
  for (const fileName of written) console.log(`Generated ${fileName}.`);
  for (const fileName of skipped) {
    console.log(`Skipped ${fileName} (already exists, use --force to regenerate).`);
  }

  console.log("Sending a smoke trace...");
  const client = new AgentTraceClient({
    apiKey: token,
    baseUrl: options.apiUrl,
  });
  await client.trace(
    { name: "agenttrace-cli-init-smoke-test", agentName: label },
    async (trace) => {
      trace.setOutput("Connected via `agenttrace init`.");
    },
  );

  const runsUrl = new URL(`/projects/${projectId}/runs`, options.dashboardUrl);
  console.log(`Done! View your project at ${runsUrl.toString()}`);
  console.log("Next steps:");
  console.log(`  Import { agenttrace } from "./agenttrace" in your code.`);
  console.log(
    `  See ${files[1].fileName} for a worked example, or run \`${runExampleCommand(format)}\` to try it now.`,
  );

  const openNow = await confirm("Open the dashboard now? [Y/n]", {
    assumeYes: options.assumeYes,
    flagHint: "--yes",
    defaultWhenNonInteractive: false,
  });
  if (openNow) {
    await open(runsUrl.toString()).catch(() => {
      // Non-fatal: the printed link above already gave them the URL.
    });
  }
}

// A stale or revoked credential doesn't silently count as "already
// connected": only a real, currently-verifying connection is reused,
// matching this project's existing rule that success is always
// confirmed independently, never assumed from a credential's mere
// presence (ADR-0009's fail-open SDK is exactly why this can't be
// skipped).
async function resolveExistingConnection(
  apiKey: string | null,
  baseUrl: string | null,
): Promise<ConnectionContext | null> {
  if (!apiKey || !baseUrl) return null;
  try {
    return await verifyConnection(apiKey, baseUrl);
  } catch (err) {
    if (err instanceof ConnectionInvalidError) return null;
    throw err;
  }
}

function printPlan(state: {
  needsInstall: boolean;
  needsConnect: boolean;
  existingProjectId: string | undefined;
  files: { fileName: string }[];
  filesToWriteNames: Set<string>;
}): void {
  const actionLines: string[] = [];
  if (state.needsInstall) actionLines.push(`Install ${SDK_PACKAGE_NAME}`);
  if (state.needsConnect) actionLines.push("Connect this project");
  for (const file of state.files) {
    if (state.filesToWriteNames.has(file.fileName)) {
      actionLines.push(`Generate ${file.fileName}`);
    }
  }
  actionLines.push("Send a smoke trace");

  const statusLines: string[] = [];
  if (!state.needsInstall) {
    statusLines.push(`${SDK_PACKAGE_NAME} is already installed.`);
  }
  if (!state.needsConnect) {
    statusLines.push(`Already connected to project ${state.existingProjectId}.`);
  }
  for (const file of state.files) {
    if (!state.filesToWriteNames.has(file.fileName)) {
      statusLines.push(`${file.fileName} already exists (skipping).`);
    }
  }

  console.log("AgentTrace will:");
  for (const line of actionLines) console.log(`  ${line}`);
  if (statusLines.length > 0) {
    console.log();
    for (const line of statusLines) console.log(line);
  }
  console.log();
}
