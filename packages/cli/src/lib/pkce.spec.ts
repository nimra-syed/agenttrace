import { createHash } from "node:crypto";
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./pkce";

describe("computeCodeChallenge", () => {
  it("matches SHA-256 + base64url computed independently, the same algorithm apps/api's pkce.util.ts uses server-side", () => {
    const verifier = "a-fixed-verifier-value";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(computeCodeChallenge(verifier)).toBe(expected);
  });

  it("is deterministic: the same verifier always produces the same challenge", () => {
    const verifier = "another-fixed-verifier";
    expect(computeCodeChallenge(verifier)).toBe(computeCodeChallenge(verifier));
  });

  it("produces different challenges for different verifiers", () => {
    expect(computeCodeChallenge("verifier-a")).not.toBe(
      computeCodeChallenge("verifier-b"),
    );
  });
});

describe("generateCodeVerifier", () => {
  it("never repeats", () => {
    const values = new Set(
      Array.from({ length: 20 }, () => generateCodeVerifier()),
    );
    expect(values.size).toBe(20);
  });
});

describe("generateState", () => {
  it("never repeats", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateState()));
    expect(values.size).toBe(20);
  });
});
