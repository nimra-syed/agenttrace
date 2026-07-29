import {
  computeCsrfToken,
  csrfTokensMatch,
  validateCsrfSecret,
} from './csrf.util';

const VALID_SECRET = 'a'.repeat(63) + 'b'; // 64 hex chars, not the all-zero placeholder

describe('validateCsrfSecret', () => {
  it('accepts a valid 64-character hex secret', () => {
    expect(validateCsrfSecret(VALID_SECRET)).toBe(VALID_SECRET);
  });

  it('rejects a missing secret', () => {
    expect(() => validateCsrfSecret(undefined)).toThrow(/not set/);
  });

  it('rejects a secret shorter than 64 hex characters', () => {
    expect(() => validateCsrfSecret('a'.repeat(32))).toThrow(/64 hex/);
  });

  it('rejects a non-hex secret of otherwise sufficient length', () => {
    expect(() => validateCsrfSecret('z'.repeat(64))).toThrow(/64 hex/);
  });

  it('rejects known placeholder values', () => {
    expect(() => validateCsrfSecret('changeme')).toThrow(/placeholder/);
    expect(() => validateCsrfSecret('0'.repeat(64))).toThrow(/placeholder/);
  });
});

describe('computeCsrfToken', () => {
  const originalSecret = process.env.CSRF_SECRET;

  beforeEach(() => {
    process.env.CSRF_SECRET = VALID_SECRET;
  });

  afterAll(() => {
    process.env.CSRF_SECRET = originalSecret;
  });

  it('is deterministic for the same session id', () => {
    expect(computeCsrfToken('session-1')).toBe(computeCsrfToken('session-1'));
  });

  it('differs between two different session ids', () => {
    // Proves the token is bound to the specific session row, not a
    // global secret-derived constant shared across every session (or
    // every session belonging to the same user).
    expect(computeCsrfToken('session-1')).not.toBe(
      computeCsrfToken('session-2'),
    );
  });

  it('throws if CSRF_SECRET is invalid at computation time, not just at startup', () => {
    process.env.CSRF_SECRET = 'too-short';
    expect(() => computeCsrfToken('session-1')).toThrow();
  });
});

describe('csrfTokensMatch', () => {
  it('returns true for identical strings', () => {
    expect(csrfTokensMatch('abc123', 'abc123')).toBe(true);
  });

  it('returns false for a mismatched length without throwing', () => {
    expect(() => csrfTokensMatch('short', 'a-lot-longer-value')).not.toThrow();
    expect(csrfTokensMatch('short', 'a-lot-longer-value')).toBe(false);
  });

  it('returns false for equal-length but different content', () => {
    expect(csrfTokensMatch('abcabc', 'abcabd')).toBe(false);
  });
});
