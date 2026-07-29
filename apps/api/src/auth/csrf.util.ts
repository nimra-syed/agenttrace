import { createHmac, timingSafeEqual } from 'crypto';

// Non-httpOnly on purpose: unlike the session cookie, frontend JS has to
// be able to read this one, to echo it back as a header. See
// ADR-0014 for why the cookie's value plays no role in server-side
// validation (the guard recomputes the expected value itself; the
// cookie only exists to get that value into the browser).
export const CSRF_COOKIE_NAME = 'agenttrace_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

// 32 random bytes, hex-encoded, so length is a simple, unambiguous
// check (64 hex characters == 32 bytes exactly, no base64
// padding/charset ambiguity to account for).
const MIN_SECRET_BYTES = 32;
const MIN_SECRET_HEX_LENGTH = MIN_SECRET_BYTES * 2;

// Catches an obvious mistake (a placeholder left in from .env.example,
// a value copied from documentation), not a proof of randomness. There
// is no way to verify true entropy from a string alone after the fact;
// "aaaa...a" repeated 64 times would pass every check below except this
// one. The actual entropy guarantee comes from how the value is
// generated (see .env.example's comment), not from this function.
const KNOWN_PLACEHOLDER_VALUES = new Set([
  'changeme',
  'change-me',
  'secret',
  'your-secret-here',
  '0'.repeat(MIN_SECRET_HEX_LENGTH),
]);

export function validateCsrfSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      'CSRF_SECRET is not set. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(${MIN_SECRET_BYTES}).toString('hex'))"`,
    );
  }
  if (KNOWN_PLACEHOLDER_VALUES.has(secret.toLowerCase())) {
    throw new Error(
      'CSRF_SECRET looks like a placeholder value, not a generated secret.',
    );
  }
  if (!/^[0-9a-f]+$/i.test(secret) || secret.length < MIN_SECRET_HEX_LENGTH) {
    throw new Error(
      `CSRF_SECRET must be at least ${MIN_SECRET_HEX_LENGTH} hex characters ` +
        `(${MIN_SECRET_BYTES} random bytes).`,
    );
  }
  return secret;
}

// Keyed on the session row's own id, not the raw session token: only
// the token's *hash* is ever stored (ADR-0005), so the server cannot
// re-derive the raw token on a later request even if it wanted to.
// Deriving from it would only work once, at issuance, and GET
// /auth/csrf (recovering a lost CSRF cookie for an existing session)
// would be impossible. session.id is stable for the session's
// lifetime, already loaded by SessionGuard on every request, and isn't
// itself a sensitive bearer credential the way the raw token is. See
// ADR-0014.
export function computeCsrfToken(sessionId: string): string {
  const secret = validateCsrfSecret(process.env.CSRF_SECRET);
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

// Buffer.length differing would make timingSafeEqual throw rather than
// return false; checked first and short-circuited, which is the
// standard, accepted pattern here. Leaking the *length* via timing
// isn't the concern this guards against, only leaking how many leading
// bytes of *content* matched.
export function csrfTokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
