import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProjectFormat,
  runExampleCommand,
  scaffoldFiles,
  writeScaffoldFiles,
} from "./scaffold";

describe("scaffold", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenttrace-cli-scaffold-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("detectProjectFormat", () => {
    it("detects TypeScript from a tsconfig.json", () => {
      writeFileSync(join(dir, "tsconfig.json"), "{}");
      expect(detectProjectFormat(dir).isTypeScript).toBe(true);
    });

    it("detects JavaScript when there is no tsconfig.json", () => {
      expect(detectProjectFormat(dir).isTypeScript).toBe(false);
    });

    it("detects ESM from package.json's type field", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      expect(detectProjectFormat(dir).isESM).toBe(true);
    });

    it("defaults to CommonJS when type is absent", () => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({}));
      expect(detectProjectFormat(dir).isESM).toBe(false);
    });

    it("defaults to CommonJS when package.json does not exist", () => {
      expect(detectProjectFormat(dir).isESM).toBe(false);
    });
  });

  describe("scaffoldFiles content", () => {
    it("generates .ts files using import/export for a TypeScript project", () => {
      const files = scaffoldFiles({ isTypeScript: true, isESM: false });
      expect(files[0].fileName).toBe("agenttrace.ts");
      expect(files[0].content).toContain(
        'import { AgentTraceClient } from "@agenttraceai/sdk"',
      );
      expect(files[0].content).toContain("export const agenttrace");
      expect(files[1].fileName).toBe("agenttrace.example.ts");
      expect(files[1].content).toContain(
        'import { agenttrace } from "./agenttrace"',
      );
    });

    it("generates .js files using import/export for an ESM JavaScript project", () => {
      const files = scaffoldFiles({ isTypeScript: false, isESM: true });
      expect(files[0].fileName).toBe("agenttrace.js");
      expect(files[0].content).toContain(
        'import { AgentTraceClient } from "@agenttraceai/sdk"',
      );
      expect(files[0].content).toContain("export const agenttrace");
      expect(files[1].content).toContain(
        'import { agenttrace } from "./agenttrace"',
      );
    });

    it("generates .js files using require/module.exports for a CommonJS project", () => {
      const files = scaffoldFiles({ isTypeScript: false, isESM: false });
      expect(files[0].fileName).toBe("agenttrace.js");
      expect(files[0].content).toContain(
        'const { AgentTraceClient } = require("@agenttraceai/sdk")',
      );
      expect(files[0].content).toContain("module.exports = { agenttrace }");
      expect(files[1].content).toContain(
        'const { agenttrace } = require("./agenttrace")',
      );
    });

    it("never has the example file import anything but the generated client file", () => {
      const files = scaffoldFiles({ isTypeScript: true, isESM: false });
      expect(files[1].content).not.toContain("@agenttraceai/sdk");
    });
  });

  describe("writeScaffoldFiles", () => {
    const format = { isTypeScript: true, isESM: false };

    it("writes both files when neither exists", () => {
      const result = writeScaffoldFiles(dir, format, false);
      expect(result.written.sort()).toEqual(
        ["agenttrace.example.ts", "agenttrace.ts"].sort(),
      );
      expect(result.skipped).toEqual([]);
      expect(readFileSync(join(dir, "agenttrace.ts"), "utf8")).toContain(
        "AgentTraceClient",
      );
    });

    it("skips a file that already exists, leaving its content untouched", () => {
      writeFileSync(join(dir, "agenttrace.ts"), "// hand-edited by a developer\n");
      const result = writeScaffoldFiles(dir, format, false);
      expect(result.skipped).toContain("agenttrace.ts");
      expect(result.written).toContain("agenttrace.example.ts");
      expect(readFileSync(join(dir, "agenttrace.ts"), "utf8")).toBe(
        "// hand-edited by a developer\n",
      );
    });

    it("regenerates an existing file when force is true", () => {
      writeFileSync(join(dir, "agenttrace.ts"), "// stale\n");
      const result = writeScaffoldFiles(dir, format, true);
      expect(result.written).toContain("agenttrace.ts");
      expect(result.skipped).toEqual([]);
      expect(readFileSync(join(dir, "agenttrace.ts"), "utf8")).toContain(
        "AgentTraceClient",
      );
    });
  });

  describe("runExampleCommand", () => {
    it("suggests tsx for TypeScript", () => {
      expect(runExampleCommand({ isTypeScript: true, isESM: false })).toBe(
        "npx tsx agenttrace.example.ts",
      );
    });

    it("suggests node for JavaScript", () => {
      expect(runExampleCommand({ isTypeScript: false, isESM: true })).toBe(
        "node agenttrace.example.js",
      );
    });
  });
});
