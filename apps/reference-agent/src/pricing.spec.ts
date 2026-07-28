import { DEFAULT_MODEL } from './llm.js';
import { estimateCostUsd } from './pricing.js';

const KNOWN_MODEL = 'gemini-2.5-flash';

describe('estimateCostUsd', () => {
  it('returns 0 for no token usage on a known model', () => {
    expect(estimateCostUsd(KNOWN_MODEL, 0, 0)).toBe(0);
  });

  it('weights output tokens more heavily than input tokens', () => {
    const inputOnly = estimateCostUsd(KNOWN_MODEL, 1000, 0) as number;
    const outputOnly = estimateCostUsd(KNOWN_MODEL, 0, 1000) as number;
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });

  it('rounds to 6 decimal places', () => {
    const cost = estimateCostUsd(KNOWN_MODEL, 123, 45) as number;
    const decimalPlaces = cost.toString().split('.')[1]?.length ?? 0;
    expect(decimalPlaces).toBeLessThanOrEqual(6);
  });

  it('returns undefined for a model with no known pricing, instead of guessing', () => {
    expect(estimateCostUsd('some-other-model', 1000, 1000)).toBeUndefined();
  });

  it('returns undefined for the current default model, since its pricing is not yet verified', () => {
    // gemini-3-flash-preview, as of M6: no verified price, deliberately
    // not in the table. Update this test (and the table) once a real
    // price has been checked against Google's current docs.
    expect(estimateCostUsd(DEFAULT_MODEL, 1000, 1000)).toBeUndefined();
  });
});
