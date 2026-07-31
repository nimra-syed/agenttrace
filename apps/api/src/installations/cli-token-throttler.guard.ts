import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { hashToken } from '../common/hash-token.util';

// Keyed on the submitted authorization code, not IP -- same reasoning
// as AuthThrottlerGuard and EvaluationThrottlerGuard (ADR-0014,
// ADR-0016): this project's Next.js proxy does not add a trustworthy
// X-Forwarded-For hop, so IP-based keying would be trivially spoofable.
// This endpoint is public (no session, no API key), so there's no
// user/project identity to key on either; the code itself is the thing
// actually worth protecting from repeated guessing, which per-code
// keying does directly -- hashed, so the tracker key never holds the
// raw code value itself. See ADR-0017.
@Injectable()
export class CliTokenThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { code?: unknown } | undefined;
    const code = typeof body?.code === 'string' ? body.code : '';
    return Promise.resolve(code ? hashToken(code) : 'missing-code');
  }
}
