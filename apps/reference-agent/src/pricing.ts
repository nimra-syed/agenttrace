// Approximate per-model pricing (USD per 1M tokens), for a rough cost
// estimate only, not fetched live and not billing-accurate. Verify
// against https://ai.google.dev/gemini-api/docs/pricing before relying
// on this; prices change over time.
//
// gemini-3-flash-preview (the current DEFAULT_MODEL) is deliberately
// NOT in this table: as a preview model, there is no pricing here that
// has actually been verified against Google's current docs, and a
// guessed number would misreport cost with false confidence. Running
// with this model records real prompt/completion token counts, but
// costUsd will be undefined until a verified price is added.
//
// gemini-2.5-flash's price is left below for reference, but as of live
// testing during M6, this model returned 404 "no longer available to
// new users" for a newly created API key, so it may not be usable with
// a fresh key even though the price itself may still be accurate for
// accounts that do have access.
const PRICE_TABLE_USD_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
};

// Returns undefined for a model not in the table above (for example, a
// different model set via GEMINI_MODEL) rather than silently applying
// another model's pricing to it, that would misreport cost with false
// confidence instead of just not reporting one.
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | undefined {
  const price = PRICE_TABLE_USD_PER_MILLION_TOKENS[model];
  if (!price) {
    return undefined;
  }

  const inputCost = (promptTokens / 1_000_000) * price.input;
  const outputCost = (completionTokens / 1_000_000) * price.output;
  // Rounded to 6 decimal places to match the Decimal(10, 6) cost columns
  // (ADR-0003).
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
