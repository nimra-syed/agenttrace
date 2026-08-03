import { readFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { basename, join } from "node:path";

// Zero-prompt by design: connecting an application should feel
// effortless, not ask the person running `connect` to type a name for
// something they didn't come here to name. Falls back through
// increasingly generic sources, never throws, always returns
// something. See docs/architecture/cli-onboarding-design.md section 7.
export function deriveLabel(cwd: string): string {
  const packageJsonName = readPackageJsonName(cwd);
  if (packageJsonName) return packageJsonName;

  const dirName = basename(cwd).trim();
  if (dirName) return dirName;

  try {
    return `${userInfo().username}@${hostname()}`;
  } catch {
    return "Unnamed connection";
  }
}

function readPackageJsonName(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      typeof (parsed as { name: unknown }).name === "string"
    ) {
      const name = (parsed as { name: string }).name.trim();
      return name || null;
    }
    return null;
  } catch {
    return null;
  }
}
