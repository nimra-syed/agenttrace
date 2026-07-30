import {
  validateEvalWorkerSecret,
  validateEvalWorkerUrl,
} from './evaluation-worker.util';

const VALID_SECRET = 'a'.repeat(32);

describe('validateEvalWorkerSecret', () => {
  it('accepts a value of sufficient length', () => {
    expect(validateEvalWorkerSecret(VALID_SECRET)).toBe(VALID_SECRET);
  });

  it('rejects a missing secret', () => {
    expect(() => validateEvalWorkerSecret(undefined)).toThrow(/not set/);
  });

  it('rejects a secret shorter than 32 characters', () => {
    expect(() => validateEvalWorkerSecret('too-short')).toThrow(/at least 32/);
  });

  it('rejects known placeholder values', () => {
    expect(() => validateEvalWorkerSecret('changeme')).toThrow(/placeholder/);
  });
});

describe('validateEvalWorkerUrl', () => {
  it('accepts a well-formed URL', () => {
    expect(validateEvalWorkerUrl('http://localhost:8000')).toBe(
      'http://localhost:8000',
    );
  });

  it('rejects a missing URL', () => {
    expect(() => validateEvalWorkerUrl(undefined)).toThrow(/not set/);
  });

  it('rejects a malformed URL', () => {
    expect(() => validateEvalWorkerUrl('not-a-url')).toThrow(/not a valid URL/);
  });
});
