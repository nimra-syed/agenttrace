import { createInterface } from "node:readline/promises";
import { confirm, NonInteractiveError } from "./prompt";

jest.mock("node:readline/promises");

const mockCreateInterface = createInterface as jest.MockedFunction<
  typeof createInterface
>;

describe("confirm", () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    jest.restoreAllMocks();
  });

  it("returns true immediately when assumeYes is set, without touching stdin", () => {
    process.stdin.isTTY = false;
    return expect(
      confirm("Continue?", { assumeYes: true, flagHint: "--yes" }),
    ).resolves.toBe(true);
  });

  it("throws NonInteractiveError when stdin is not a TTY and there is no default", async () => {
    process.stdin.isTTY = false;
    await expect(
      confirm("Continue?", { assumeYes: false, flagHint: "--yes" }),
    ).rejects.toThrow(NonInteractiveError);
  });

  it("includes the provided flag hint in the error message", async () => {
    process.stdin.isTTY = false;
    await expect(
      confirm("Continue?", { assumeYes: false, flagHint: "--force" }),
    ).rejects.toThrow(/--force/);
  });

  it("returns the default value when stdin is not a TTY and a default is provided", async () => {
    process.stdin.isTTY = false;
    await expect(
      confirm("Open the dashboard now?", {
        assumeYes: false,
        flagHint: "--yes",
        defaultWhenNonInteractive: false,
      }),
    ).resolves.toBe(false);
  });

  it("reads a real interactive answer when stdin is a TTY", async () => {
    process.stdin.isTTY = true;
    const question = jest.fn().mockResolvedValue("y");
    const close = jest.fn();
    mockCreateInterface.mockReturnValue({ question, close } as never);

    const result = await confirm("Continue?", {
      assumeYes: false,
      flagHint: "--yes",
    });

    expect(result).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it("treats anything other than 'y' as a decline", async () => {
    process.stdin.isTTY = true;
    const question = jest.fn().mockResolvedValue("n");
    const close = jest.fn();
    mockCreateInterface.mockReturnValue({ question, close } as never);

    const result = await confirm("Continue?", {
      assumeYes: false,
      flagHint: "--yes",
    });

    expect(result).toBe(false);
  });
});
