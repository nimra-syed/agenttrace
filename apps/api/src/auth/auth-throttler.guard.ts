import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Keyed on the request's email, not IP. Confirmed live: this project's
// Next.js reverse proxy (next.config.ts rewrites) does not add its own
// trustworthy X-Forwarded-For hop, it relays whatever header the client
// already sent completely unmodified. With no real reverse proxy in
// front of this stack yet, trusting that header for a security decision
// would mean trusting a value any caller can set to anything (rotate it
// per request, bypass the limit entirely) -- worse than not trusting it
// at all. Keying on the account actually being targeted protects the
// thing that matters here (a specific account being brute-forced)
// without relying on a network-layer signal we can't currently trust.
//
// Trimmed but deliberately NOT lowercased: AuthService's own lookup
// (`where: { email: dto.email }` against a plain `String @unique`
// column, no citext, no normalization anywhere in SignupDto/LoginDto)
// is case-sensitive, confirmed by reading it directly. Lowercasing here
// would bucket together two request strings that findUnique() would
// treat as two different accounts -- an inconsistency with what this
// guard is actually meant to key on. Only trimming, not case-folding,
// keeps the tracker's notion of "same target" matching auth's own,
// rather than introducing a different, looser one. See ADR-0014.
//
// req.ip is only a fallback for a malformed/missing email, which can't
// target a specific account through AuthService's lookup anyway; if
// req.ip itself is ever missing (shouldn't happen for a real HTTP
// request), falls back further to a fixed string rather than ever
// resolving to undefined.
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const ip = typeof req.ip === 'string' && req.ip ? req.ip : 'unknown-ip';
    return Promise.resolve(email || ip);
  }
}
