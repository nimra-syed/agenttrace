// Internal shared secret gating apps/api -> apps/eval-worker calls,
// distinct from ApiKey (external SDK/script callers of ingestion) and
// from session/CSRF (browser-facing). See ADR-0016.
const MIN_SECRET_LENGTH = 32;

const KNOWN_PLACEHOLDER_VALUES = new Set([
  'changeme',
  'change-me',
  'secret',
  'your-secret-here',
]);

export function validateEvalWorkerSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      'EVAL_WORKER_SECRET is not set. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(${MIN_SECRET_LENGTH}).toString('hex'))"`,
    );
  }
  if (KNOWN_PLACEHOLDER_VALUES.has(secret.toLowerCase())) {
    throw new Error(
      'EVAL_WORKER_SECRET looks like a placeholder value, not a generated secret.',
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `EVAL_WORKER_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

export function validateEvalWorkerUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('EVAL_WORKER_URL is not set.');
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`EVAL_WORKER_URL is not a valid URL: ${url}`);
  }
  return url;
}
