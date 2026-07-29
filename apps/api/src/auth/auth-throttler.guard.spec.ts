import { AuthThrottlerGuard } from './auth-throttler.guard';

// AuthThrottlerGuard only overrides getTracker; the rest of its
// behavior (counting, storage, throwing on limit) comes from
// @nestjs/throttler's ThrottlerGuard and isn't re-tested here. See
// ADR-0014 for why this guard exists at all: the Next.js reverse proxy
// doesn't add a trustworthy X-Forwarded-For hop, so keying on req.ip
// would be trivially bypassable by rotating the header, while keying on
// the account actually being targeted (email) isn't.
describe('AuthThrottlerGuard.getTracker', () => {
  // getTracker is protected; cast to access it directly rather than
  // exercising the full canActivate/storage machinery just to reach it.
  function tracker() {
    return (
      AuthThrottlerGuard.prototype as unknown as {
        getTracker: (req: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker;
  }

  it('keys on the trimmed email from the request body, without folding case', async () => {
    // Deliberately NOT lowercased: AuthService's own lookup is
    // case-sensitive (a plain `String @unique` column, no citext, no
    // normalization anywhere in the DTOs), confirmed by reading it
    // directly. Folding case here would bucket together two strings
    // that findUnique() treats as different accounts. See ADR-0014.
    const key = await tracker().call(undefined, {
      body: { email: '  Demo@AgentTrace.dev  ' },
      ip: '203.0.113.5',
    });
    expect(key).toBe('Demo@AgentTrace.dev');
  });

  it('falls back to req.ip when the body has no email', async () => {
    const key = await tracker().call(undefined, {
      body: {},
      ip: '203.0.113.5',
    });
    expect(key).toBe('203.0.113.5');
  });

  it('falls back to req.ip when there is no body at all', async () => {
    const key = await tracker().call(undefined, { ip: '203.0.113.5' });
    expect(key).toBe('203.0.113.5');
  });

  it('falls back to req.ip when email is a non-string value, without throwing', async () => {
    const malformedEmails = [123, null, ['a@b.com'], { toString: () => 'x' }];
    for (const malformedEmail of malformedEmails) {
      const key = await tracker().call(undefined, {
        body: { email: malformedEmail },
        ip: '203.0.113.5',
      });
      expect(key).toBe('203.0.113.5');
    }
  });

  it('falls back to req.ip when email is whitespace-only', async () => {
    const key = await tracker().call(undefined, {
      body: { email: '   ' },
      ip: '203.0.113.5',
    });
    expect(key).toBe('203.0.113.5');
  });

  it('never resolves to undefined, even with no email and no req.ip', async () => {
    const key = await tracker().call(undefined, {});
    expect(typeof key).toBe('string');
    expect(key).toBe('unknown-ip');
  });
});
