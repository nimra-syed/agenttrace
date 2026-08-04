import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInstallCommand,
  detectPackageManager,
  hasDependency,
} from "./package-manager";

describe("package-manager", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenttrace-cli-pm-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("detectPackageManager", () => {
    it("detects pnpm from pnpm-lock.yaml", () => {
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");
      expect(detectPackageManager(dir)).toBe("pnpm");
    });

    it("detects yarn from yarn.lock", () => {
      writeFileSync(join(dir, "yarn.lock"), "");
      expect(detectPackageManager(dir)).toBe("yarn");
    });

    it("detects npm from package-lock.json", () => {
      writeFileSync(join(dir, "package-lock.json"), "");
      expect(detectPackageManager(dir)).toBe("npm");
    });

    it("defaults to npm when no lockfile is present", () => {
      expect(detectPackageManager(dir)).toBe("npm");
    });

    it("prefers pnpm over yarn when both lockfiles somehow exist", () => {
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");
      writeFileSync(join(dir, "yarn.lock"), "");
      expect(detectPackageManager(dir)).toBe("pnpm");
    });
  });

  describe("hasDependency", () => {
    it("returns false when package.json does not exist", () => {
      expect(hasDependency(dir, "@agenttraceai/sdk")).toBe(false);
    });

    it("returns false when package.json is malformed", () => {
      writeFileSync(join(dir, "package.json"), "{ not valid json");
      expect(hasDependency(dir, "@agenttraceai/sdk")).toBe(false);
    });

    it("returns true when the package is a declared dependency", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { "@agenttraceai/sdk": "^1.0.0" } }),
      );
      expect(hasDependency(dir, "@agenttraceai/sdk")).toBe(true);
    });

    it("returns true when the package is a declared devDependency", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ devDependencies: { "@agenttraceai/sdk": "^1.0.0" } }),
      );
      expect(hasDependency(dir, "@agenttraceai/sdk")).toBe(true);
    });

    it("returns false when the package is not declared anywhere", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      );
      expect(hasDependency(dir, "@agenttraceai/sdk")).toBe(false);
    });
  });

  describe("buildInstallCommand", () => {
    it("builds a pnpm add command", () => {
      expect(buildInstallCommand("pnpm", ["@agenttraceai/sdk"])).toEqual({
        command: "pnpm",
        args: ["add", "@agenttraceai/sdk"],
      });
    });

    it("builds a yarn add command", () => {
      expect(buildInstallCommand("yarn", ["@agenttraceai/sdk"])).toEqual({
        command: "yarn",
        args: ["add", "@agenttraceai/sdk"],
      });
    });

    it("builds an npm install command", () => {
      expect(buildInstallCommand("npm", ["@agenttraceai/sdk"])).toEqual({
        command: "npm",
        args: ["install", "@agenttraceai/sdk"],
      });
    });

    it("builds a single install command covering multiple missing packages", () => {
      expect(
        buildInstallCommand("npm", ["@agenttraceai/sdk", "dotenv"]),
      ).toEqual({
        command: "npm",
        args: ["install", "@agenttraceai/sdk", "dotenv"],
      });
    });
  });
});
