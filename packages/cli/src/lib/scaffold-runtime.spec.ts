import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { scaffoldFiles } from "./scaffold";

// Deliberately heavier than this package's usual pure-unit tests
// (scaffold.spec.ts): these actually run the generated content through
// a real `tsc` and a real `node`, in a temp directory nested inside
// this package so module resolution reaches the real, workspace-linked
// `@agenttraceai/sdk` and `dotenv`. Found live during M17's own
// verification, not by any test up to that point: a plain string/
// content assertion ("contains `AgentTraceClient`") cannot catch a
// generated file that parses and reads correctly but still crashes the
// moment a real developer actually runs it. These tests exist
// specifically to close that gap.
//
// Temp dirs are created next to this file (inside packages/cli) rather
// than in the OS temp directory, precisely so Node's/TypeScript's
// module resolution walks up to this package's own node_modules and
// finds the real, workspace-linked packages, not a mock or a stub.
describe("generated scaffold, executed for real", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // A dummy value that fails to connect immediately (nothing listens
  // on this port), exercising the SDK's real fail-open behavior
  // (ADR-0009) rather than a mocked one. This is also the most
  // realistic first-run scenario: right after `init` scaffolds a
  // project, the developer trying the example hasn't necessarily
  // confirmed connectivity yet.
  const DUMMY_ENV = "AGENTTRACE_API_KEY=test-key\nAGENTTRACE_BASE_URL=http://127.0.0.1:1\n";

  it("typechecks cleanly for a TypeScript project", () => {
    dir = mkdtempSync(join(__dirname, ".scaffold-ts-"));
    for (const file of scaffoldFiles({ isTypeScript: true, isESM: false })) {
      writeFileSync(join(dir, file.fileName), file.content);
    }
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "commonjs",
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
        },
        include: ["*.ts"],
      }),
    );

    expect(() =>
      execFileSync(
        process.execPath,
        [require.resolve("typescript/bin/tsc"), "--noEmit", "-p", dir],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  }, 30000);

  it("runs the generated example without crashing for a CommonJS project", () => {
    dir = mkdtempSync(join(__dirname, ".scaffold-cjs-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "cjs-test" }));
    writeFileSync(join(dir, ".env"), DUMMY_ENV);
    for (const file of scaffoldFiles({ isTypeScript: false, isESM: false })) {
      writeFileSync(join(dir, file.fileName), file.content);
    }

    expect(existsSync(join(dir, "agenttrace.js"))).toBe(true);
    expect(() =>
      execFileSync(process.execPath, ["agenttrace.example.js"], {
        cwd: dir,
        stdio: "pipe",
        timeout: 10000,
      }),
    ).not.toThrow();
  }, 15000);

  it("runs the generated example without crashing for an ESM project", () => {
    dir = mkdtempSync(join(__dirname, ".scaffold-esm-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "esm-test", type: "module" }),
    );
    writeFileSync(join(dir, ".env"), DUMMY_ENV);
    for (const file of scaffoldFiles({ isTypeScript: false, isESM: true })) {
      writeFileSync(join(dir, file.fileName), file.content);
    }

    expect(() =>
      execFileSync(process.execPath, ["agenttrace.example.js"], {
        cwd: dir,
        stdio: "pipe",
        timeout: 10000,
      }),
    ).not.toThrow();
  }, 15000);
});
