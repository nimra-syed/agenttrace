import { createHash, randomBytes } from "node:crypto";

// The exact same algorithm apps/api/src/installations/pkce.util.ts
// implements server-side (RFC 7636, S256 method): code_challenge =
// BASE64URL(SHA256(code_verifier)). Confirmed by reading that file
// directly, not re-derived from the RFC alone -- interop with the
// backend depends on both sides agreeing on this exactly. See
// ADR-0017.
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function computeCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

// Used for the OAuth-style state parameter (CSRF protection on the
// loopback callback): a value only this CLI invocation could have
// generated, checked again when the callback arrives.
export function generateState(): string {
  return randomBytes(16).toString("hex");
}
