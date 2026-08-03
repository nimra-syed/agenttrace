import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvValue, removeEnvValues, setEnvValues } from "./env-file";

describe("env-file", () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenttrace-cli-env-test-"));
    envPath = join(dir, ".env");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("readEnvValue", () => {
    it("returns null when the file does not exist", () => {
      expect(readEnvValue(envPath, "FOO")).toBeNull();
    });

    it("returns null when the key is not present", () => {
      writeFileSync(envPath, "OTHER=value\n");
      expect(readEnvValue(envPath, "FOO")).toBeNull();
    });

    it("reads an existing value", () => {
      writeFileSync(envPath, "FOO=bar\n");
      expect(readEnvValue(envPath, "FOO")).toBe("bar");
    });
  });

  describe("setEnvValues", () => {
    it("creates the file when it does not exist", () => {
      setEnvValues(envPath, { FOO: "bar" });
      expect(readFileSync(envPath, "utf8")).toBe("FOO=bar\n");
    });

    it("appends a new key without disturbing existing lines, comments, or blanks", () => {
      writeFileSync(envPath, "# a comment\nEXISTING=value\n\nOTHER=thing\n");
      setEnvValues(envPath, { FOO: "bar" });
      const contents = readFileSync(envPath, "utf8");
      expect(contents).toContain("# a comment");
      expect(contents).toContain("EXISTING=value");
      expect(contents).toContain("OTHER=thing");
      expect(contents).toContain("FOO=bar");
    });

    it("updates an existing key in place, leaving every other line untouched", () => {
      writeFileSync(envPath, "BEFORE=1\nFOO=old-value\nAFTER=2\n");
      setEnvValues(envPath, { FOO: "new-value" });
      const lines = readFileSync(envPath, "utf8").trim().split("\n");
      expect(lines).toEqual(["BEFORE=1", "FOO=new-value", "AFTER=2"]);
    });

    it("sets multiple keys in one call", () => {
      setEnvValues(envPath, { FOO: "1", BAR: "2" });
      const contents = readFileSync(envPath, "utf8");
      expect(contents).toContain("FOO=1");
      expect(contents).toContain("BAR=2");
    });
  });

  describe("removeEnvValues", () => {
    it("is a no-op when the file does not exist", () => {
      expect(() => removeEnvValues(envPath, ["FOO"])).not.toThrow();
    });

    it("removes only the given keys, leaving every other line untouched", () => {
      writeFileSync(envPath, "KEEP=1\nFOO=remove-me\nALSO_KEEP=2\n");
      removeEnvValues(envPath, ["FOO"]);
      const contents = readFileSync(envPath, "utf8");
      expect(contents).not.toContain("FOO=");
      expect(contents).toContain("KEEP=1");
      expect(contents).toContain("ALSO_KEEP=2");
    });

    it("is a no-op when the key is not present", () => {
      writeFileSync(envPath, "KEEP=1\n");
      removeEnvValues(envPath, ["DOES_NOT_EXIST"]);
      expect(readFileSync(envPath, "utf8")).toBe("KEEP=1\n");
    });
  });

  // A real bug, found during review: an earlier version rejoined every
  // line with a plain "\n" regardless of the source file's own style,
  // so a CRLF file kept CRLF only on the lines it never touched, and
  // any line this tool rewrote or appended came back LF-only, a mixed-
  // ending file. Fixed by detecting the file's existing line ending and
  // reapplying it to every line, touched or not. These are exact,
  // byte-for-byte assertions on purpose, not substring checks, since a
  // substring check can't tell "\r\n" from "\n" apart.
  describe("line-ending preservation", () => {
    it("keeps LF endings on an LF file when updating an existing key", () => {
      writeFileSync(envPath, "BEFORE=1\nAGENTTRACE_API_KEY=old\nAFTER=2\n");
      setEnvValues(envPath, { AGENTTRACE_API_KEY: "new" });
      expect(readFileSync(envPath, "utf8")).toBe(
        "BEFORE=1\nAGENTTRACE_API_KEY=new\nAFTER=2\n",
      );
    });

    it("keeps LF endings on an LF file when appending a new key", () => {
      writeFileSync(envPath, "BEFORE=1\n");
      setEnvValues(envPath, { NEW_KEY: "value" });
      expect(readFileSync(envPath, "utf8")).toBe("BEFORE=1\nNEW_KEY=value\n");
    });

    it("keeps CRLF endings on a CRLF file when updating an existing key", () => {
      writeFileSync(
        envPath,
        "BEFORE=1\r\nAGENTTRACE_API_KEY=old\r\nAFTER=2\r\n",
      );
      setEnvValues(envPath, { AGENTTRACE_API_KEY: "new" });
      expect(readFileSync(envPath, "utf8")).toBe(
        "BEFORE=1\r\nAGENTTRACE_API_KEY=new\r\nAFTER=2\r\n",
      );
    });

    it("keeps CRLF endings on a CRLF file when appending a new key", () => {
      writeFileSync(envPath, "BEFORE=1\r\n");
      setEnvValues(envPath, { NEW_KEY: "value" });
      expect(readFileSync(envPath, "utf8")).toBe(
        "BEFORE=1\r\nNEW_KEY=value\r\n",
      );
    });

    it("keeps CRLF endings when removing a key from a CRLF file", () => {
      writeFileSync(envPath, "KEEP=1\r\nREMOVE_ME=x\r\nALSO_KEEP=2\r\n");
      removeEnvValues(envPath, ["REMOVE_ME"]);
      expect(readFileSync(envPath, "utf8")).toBe("KEEP=1\r\nALSO_KEEP=2\r\n");
    });

    it("defaults to LF for a file that does not exist yet", () => {
      setEnvValues(envPath, { FOO: "bar" });
      expect(readFileSync(envPath, "utf8")).toBe("FOO=bar\n");
    });

    it("adds a final newline to a file that had none, using LF", () => {
      writeFileSync(envPath, "EXISTING=value");
      setEnvValues(envPath, { FOO: "bar" });
      expect(readFileSync(envPath, "utf8")).toBe("EXISTING=value\nFOO=bar\n");
    });

    it("reads a clean value (no trailing \\r) from a CRLF file", () => {
      writeFileSync(envPath, "FOO=bar\r\n");
      expect(readEnvValue(envPath, "FOO")).toBe("bar");
    });
  });
});
