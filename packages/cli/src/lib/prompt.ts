import { createInterface } from "node:readline/promises";

export class NonInteractiveError extends Error {
  constructor(flagHint: string) {
    super(
      `Not running in an interactive terminal; pass ${flagHint} to confirm non-interactively.`,
    );
    this.name = "NonInteractiveError";
  }
}

export interface ConfirmOptions {
  assumeYes: boolean;
  flagHint: string;
  // If set, a non-interactive stdin resolves to this value instead of
  // throwing. Only appropriate when declining is always the safe
  // choice (e.g. "open the dashboard now?"); everything else should
  // fail loudly rather than silently pick an answer with real
  // consequences (overwriting .env, proceeding with an install).
  defaultWhenNonInteractive?: boolean;
}

// Every confirmation in this package goes through here. Found on
// review of the M16 design (docs/architecture/cli-init-design.md
// section 6): connect's original inline overwrite prompt had no guard
// against running with no interactive terminal attached, which meant
// a scripted run without --force would hang on stdin forever instead
// of failing. Centralizing the check here means it fails fast and
// identically everywhere instead of being one command's problem to
// remember to handle.
export async function confirm(
  message: string,
  options: ConfirmOptions,
): Promise<boolean> {
  if (options.assumeYes) return true;

  if (!process.stdin.isTTY) {
    if (options.defaultWhenNonInteractive !== undefined) {
      return options.defaultWhenNonInteractive;
    }
    throw new NonInteractiveError(options.flagHint);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${message} `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}
