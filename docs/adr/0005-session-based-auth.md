# ADR-0005: Session based auth, hashed tokens, no Passport

Status: Accepted

## Context

AgentTrace needs a way to know who is making a request, so it can enforce
that a user only sees their own organization's data. We wanted a real
learning opportunity here (how login actually works under the hood), not
a black box library.

## Decision

We built our own session system instead of using a library like Passport.

How it works:

1. On login, the server makes a random token (32 bytes, generated with
   Node's `crypto.randomBytes`).
2. The server hashes that token with SHA-256 and saves only the hash in
   the `Session` table.
3. The raw token goes to the browser as an httpOnly cookie. The browser
   sends it back automatically on every request.
4. On every request, the server hashes the cookie's token again and looks
   up a matching `Session` row by that hash.

We never store the raw token in the database, only its hash. This is the
same pattern we already used for API keys. If the database were ever
leaked or backed up somewhere insecure, the stored hashes alone are not
enough to log in as anyone.

httpOnly on the cookie means client side JavaScript cannot read it. Even
if there were an XSS bug somewhere on a future frontend, a malicious
script could not just grab the cookie and steal the session.

We also registered the session check as a global guard, using Nest's
`APP_GUARD` mechanism, with a `@Public()` decorator to mark the handful of
routes that should skip it (signup, login, health check). This means
every new route we add from now on is protected by default, unless
someone deliberately opts it out. That is safer than the alternative,
where you have to remember to add a guard to every new protected route
and it is easy to forget one.

## Alternatives considered

- **JWT (signed tokens with no database lookup).** Rejected for now. JWTs
  verify themselves without touching the database, which is faster, but
  you cannot revoke one early. If we wanted to force someone to log out
  right now (say, a compromised account), a JWT already handed out stays
  valid until it expires. A database backed session can be deleted
  instantly. Since this project is explicitly meant to teach sessions,
  and revocation is a real, teachable tradeoff, we picked sessions.
- **Passport.js.** Rejected for now. Passport is the standard NestJS way
  to do this, but it would hide the exact mechanics we are trying to
  learn (what is actually happening when a request comes in with a
  cookie). We may reach for it later if auth needs grow (OAuth providers,
  for example), but for email and password login it added a layer of
  abstraction we did not need yet.
- **Storing the raw session token in the database.** Rejected. Hashing
  costs almost nothing and protects against a real class of problem
  (database leaks), so there is no good reason to skip it.

## Known limitations, on purpose

- No CSRF token library yet. We are relying on `SameSite=Lax` cookies as
  a baseline. This matters more once there is a real frontend calling
  these endpoints from the browser. Worth revisiting then.
- No login rate limiting yet. Brute force protection is planned as part
  of a later hardening milestone, not bundled into this one.
- Sessions have a fixed 7 day expiry, no sliding renewal or "remember me"
  option. Simple on purpose for now.

## Consequences

- Gain: a session system we fully understand, with a security pattern
  (hashed opaque tokens) that is consistent with how API keys already
  work in this project.
- Give up: every authenticated request does a database lookup. Fine at
  our scale, would need caching (like Redis) if this ever became a
  bottleneck.
- Later: if we ever add OAuth login (GitHub sign in, for example),
  Passport or a similar library becomes a much more reasonable choice,
  since OAuth flows have a lot of protocol detail worth not
  reimplementing by hand.
