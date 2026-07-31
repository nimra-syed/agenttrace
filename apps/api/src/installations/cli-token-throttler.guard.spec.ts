import { hashToken } from '../common/hash-token.util';
import { CliTokenThrottlerGuard } from './cli-token-throttler.guard';

// Same reasoning as auth-throttler.guard.spec.ts/evaluation-throttler.guard.spec.ts:
// only getTracker is overridden, the rest of the throttling behavior
// comes from @nestjs/throttler's ThrottlerGuard and isn't re-tested here.
describe('CliTokenThrottlerGuard.getTracker', () => {
  function tracker() {
    return (
      CliTokenThrottlerGuard.prototype as unknown as {
        getTracker: (req: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker;
  }

  it('keys on a hash of the submitted code, never the raw value', async () => {
    const key = await tracker().call(undefined, {
      body: { code: 'the-raw-code' },
    });
    expect(key).toBe(hashToken('the-raw-code'));
    expect(key).not.toContain('the-raw-code');
  });

  it('gives two different codes separate buckets', async () => {
    const keyA = await tracker().call(undefined, { body: { code: 'code-a' } });
    const keyB = await tracker().call(undefined, { body: { code: 'code-b' } });
    expect(keyA).not.toBe(keyB);
  });

  it('falls back to a fixed placeholder without throwing when the code is missing', async () => {
    const key = await tracker().call(undefined, {});
    expect(key).toBe('missing-code');
  });
});
