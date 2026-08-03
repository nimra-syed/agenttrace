import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveLabel } from "./label";

describe("deriveLabel", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenttrace-cli-label-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers package.json's name field when present", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "beautylab" }),
    );
    expect(deriveLabel(dir)).toBe("beautylab");
  });

  it("falls back to the directory name when package.json has no usable name", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "" }));
    expect(deriveLabel(dir)).toBe(dir.split("/").pop());
  });

  it("falls back to the directory name when package.json does not exist", () => {
    expect(deriveLabel(dir)).toBe(dir.split("/").pop());
  });

  it("falls back to the directory name when package.json is malformed", () => {
    writeFileSync(join(dir, "package.json"), "{ not valid json");
    expect(deriveLabel(dir)).toBe(dir.split("/").pop());
  });

  it("never throws even for a directory that does not exist at all", () => {
    expect(() => deriveLabel("/this/path/does/not/exist/at/all")).not.toThrow();
  });
});
