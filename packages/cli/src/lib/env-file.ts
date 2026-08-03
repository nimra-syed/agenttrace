import { existsSync, readFileSync, writeFileSync } from "node:fs";

// A small, purpose-built .env editor, not dotenv (which only loads
// values into process.env, it doesn't write files back). Every
// function here preserves every line it doesn't need to change,
// including comments, blank lines, unrelated keys, and the file's own
// line-ending style -- this project has no tolerance for a tool that
// silently clobbers someone's existing .env file.

type LineEnding = "\n" | "\r\n";

// Detected from the existing file, not assumed: a file already using
// CRLF keeps CRLF, including on lines this tool rewrites or appends,
// not just the lines it leaves untouched. Defaults to LF for a file
// that doesn't exist yet or has no line ending to detect, matching
// this project's own target platforms (macOS/Linux throughout, nothing
// here considers Windows).
function detectLineEnding(contents: string): LineEnding {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

// Normalizes CRLF to LF before splitting, so every parsed line is
// guaranteed free of a stray trailing \r regardless of the source
// file's own line-ending style -- keyOf/readEnvValue never have to
// think about it, and the detected line ending (above) is reapplied
// uniformly to every line, touched or not, at write time instead.
// Also strips exactly the one trailing empty element split("\n")
// produces for a file ending in a newline (the normal case), so
// callers work with "real" lines only and re-add a single trailing
// line ending themselves on write. Shared by both mutating functions
// below, deliberately not duplicated: a fix to either of these two
// off-by-ones belongs in one place, not two functions that could
// silently drift apart.
function parseLines(contents: string): string[] {
  if (contents.length === 0) return [];
  const normalized = contents.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function keyOf(line: string): string | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
  return match ? match[1] : null;
}

export function readEnvValue(filePath: string, key: string): string | null {
  if (!existsSync(filePath)) return null;
  const lines = parseLines(readFileSync(filePath, "utf8"));
  for (const line of lines) {
    if (keyOf(line) === key) {
      return line.slice(key.length + 1);
    }
  }
  return null;
}

// Updates every key in `values` in place if already present (leaving
// its original position and every other line untouched), appending
// any key not already present as a new line at the end. Creates the
// file (and nothing else on disk) if it doesn't exist yet.
export function setEnvValues(
  filePath: string,
  values: Record<string, string>,
): void {
  const existing = existsSync(filePath)
    ? readFileSync(filePath, "utf8")
    : "";
  const lineEnding = detectLineEnding(existing);
  const lines = parseLines(existing);

  const remaining = new Map(Object.entries(values));
  const updatedLines = lines.map((line) => {
    const key = keyOf(line);
    if (key && remaining.has(key)) {
      const value = remaining.get(key) as string;
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  for (const [key, value] of remaining) {
    updatedLines.push(`${key}=${value}`);
  }

  const output =
    updatedLines.length > 0
      ? updatedLines.join(lineEnding) + lineEnding
      : "";
  writeFileSync(filePath, output);
}

// Removes the given keys entirely (their whole line), leaving every
// other line, and the file's line-ending style, untouched. A no-op,
// not an error, if the file or the keys don't exist.
export function removeEnvValues(filePath: string, keys: string[]): void {
  if (!existsSync(filePath)) return;
  const existing = readFileSync(filePath, "utf8");
  const lineEnding = detectLineEnding(existing);
  const keySet = new Set(keys);
  const lines = parseLines(existing);
  const filtered = lines.filter((line) => {
    const key = keyOf(line);
    return !(key && keySet.has(key));
  });
  const output =
    filtered.length > 0 ? filtered.join(lineEnding) + lineEnding : "";
  writeFileSync(filePath, output);
}
