import { createHash, timingSafeEqual } from 'crypto';

// PKCE (RFC 7636), S256 method only: code_challenge =
// BASE64URL(SHA256(code_verifier)). The CLI (a public client, no secret
// it can hold) computes this locally and sends only the challenge at
// authorize time; the raw verifier is never transmitted until the
// token-exchange step, where this same function recomputes the
// challenge from it and the result is compared against what was stored
// at authorize time. See ADR-0017.
export function computeCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

// Same constant-time comparison discipline as csrfTokensMatch
// (auth/csrf.util.ts, ADR-0014): a mismatched length is checked and
// short-circuited first (timingSafeEqual throws on unequal-length
// buffers rather than returning false), so only content-matching time
// is ever observable, not length.
export function codeChallengesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
