import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn";

// Detected from lockfile presence in cwd only, not walking up parent
// directories -- the same cwd-only scope limit label.ts already
// established for application-name derivation. See docs/architecture/
// cli-init-design.md section 7.
export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

// Read from package.json's own declared dependencies, not node_modules:
// node_modules can be stale, hoisted from somewhere unrelated in a
// monorepo, or simply missing after a fresh clone even though the
// declaration is correct. A declaration is what actually matters here.
export function hasDependency(cwd: string, packageName: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return false;
    const record = parsed as Record<string, unknown>;
    return (
      isRecordWithKey(record.dependencies, packageName) ||
      isRecordWithKey(record.devDependencies, packageName)
    );
  } catch {
    return false;
  }
}

function isRecordWithKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && key in value;
}

export interface InstallCommand {
  command: string;
  args: string[];
}

export function buildInstallCommand(
  manager: PackageManager,
  packageName: string,
): InstallCommand {
  switch (manager) {
    case "pnpm":
      return { command: "pnpm", args: ["add", packageName] };
    case "yarn":
      return { command: "yarn", args: ["add", packageName] };
    case "npm":
      return { command: "npm", args: ["install", packageName] };
  }
}

export class InstallFailedError extends Error {
  constructor(command: string, exitCode: number | null) {
    super(`\`${command}\` exited with code ${exitCode ?? "unknown"}.`);
    this.name = "InstallFailedError";
  }
}

// Runs the real install command with inherited stdio, so the package
// manager's own progress and real errors are visible directly to
// whoever is running init, never swallowed and re-summarized. A
// failure here stops the whole init flow rather than continuing on as
// though the dependency were actually present (docs/architecture/
// cli-init-design.md section 7).
export function installDependency(
  cwd: string,
  install: InstallCommand,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(install.command, install.args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new InstallFailedError(install.command, code));
      }
    });
  });
}
