import { EvaluationThrottlerGuard } from './evaluation-throttler.guard';

// Same reasoning as auth-throttler.guard.spec.ts: only getTracker is
// overridden, the rest of the throttling behavior comes from
// @nestjs/throttler's ThrottlerGuard and isn't re-tested here.
describe('EvaluationThrottlerGuard.getTracker', () => {
  function tracker() {
    return (
      EvaluationThrottlerGuard.prototype as unknown as {
        getTracker: (req: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker;
  }

  it('keys on the authenticated user id and the project id together', async () => {
    const key = await tracker().call(undefined, {
      user: { id: 'user-1' },
      params: { projectId: 'project-1' },
    });
    expect(key).toBe('user-1:project-1');
  });

  it('gives two different users evaluating the same project separate buckets', async () => {
    const keyA = await tracker().call(undefined, {
      user: { id: 'user-a' },
      params: { projectId: 'project-1' },
    });
    const keyB = await tracker().call(undefined, {
      user: { id: 'user-b' },
      params: { projectId: 'project-1' },
    });
    expect(keyA).not.toBe(keyB);
  });

  it('gives the same user working in two different projects separate buckets', async () => {
    const keyA = await tracker().call(undefined, {
      user: { id: 'user-1' },
      params: { projectId: 'project-a' },
    });
    const keyB = await tracker().call(undefined, {
      user: { id: 'user-1' },
      params: { projectId: 'project-b' },
    });
    expect(keyA).not.toBe(keyB);
  });

  it('falls back to fixed placeholders without throwing when user or params are missing', async () => {
    const key = await tracker().call(undefined, {});
    expect(key).toBe('unknown-user:unknown-project');
  });
});
