import { usageExitCode } from "./bin";

describe("usageExitCode", () => {
  it("exits 0 for no command at all", () => {
    expect(usageExitCode(undefined)).toBe(0);
  });

  it("exits 0 for --help", () => {
    expect(usageExitCode("--help")).toBe(0);
  });

  it("exits 0 for -h", () => {
    expect(usageExitCode("-h")).toBe(0);
  });

  it("exits 1 for an unrecognized command", () => {
    expect(usageExitCode("not-a-real-command")).toBe(1);
  });
});
