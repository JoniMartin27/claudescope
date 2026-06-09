/**
 * Estimated API-equivalent pricing for Claude models, in USD per 1M tokens.
 *
 * IMPORTANT: Most Claude Code users are on a flat-rate Max/Pro subscription,
 * so these numbers are NOT a bill — they estimate what the same token volume
 * would have cost on the pay-as-you-go API. Treat them as a relative gauge of
 * intensity, not an invoice.
 *
 * Cache rates follow Anthropic's published multipliers:
 *   - cache WRITE (cache_creation_input_tokens) = 1.25x the base input rate
 *   - cache READ  (cache_read_input_tokens)     = 0.10x the base input rate
 */

// Base list prices (input / output) per 1M tokens.
// Source: Anthropic published pricing (Claude API skill, cached 2026-05-26).
//   Opus 4.x   → $5 / $25
//   Sonnet 4.x → $3 / $15
//   Haiku 4.5  → $1 / $5
// Older families kept for completeness so historic transcripts still price.
const PRICES = [
  { match: /opus-4/i, input: 5, output: 25 },
  { match: /opus-3|claude-3-opus/i, input: 15, output: 75 },
  { match: /opus/i, input: 5, output: 25 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku-4/i, input: 1, output: 5 },
  { match: /haiku/i, input: 0.25, output: 1.25 },
];

export const CACHE_WRITE_MULT = 1.25;
export const CACHE_READ_MULT = 0.1;

export function priceForModel(model) {
  if (!model) return null;
  for (const p of PRICES) {
    if (p.match.test(model)) return p;
  }
  return null;
}

/**
 * Cost in USD for a single usage object.
 * usage = { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 */
export function costForUsage(model, usage) {
  const p = priceForModel(model);
  if (!p || !usage) return 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const M = 1_000_000;
  return (
    (input * p.input) / M +
    (output * p.output) / M +
    (cacheWrite * p.input * CACHE_WRITE_MULT) / M +
    (cacheRead * p.input * CACHE_READ_MULT) / M
  );
}

/** Total billable tokens (everything that hits the wire) for a usage object. */
export function totalTokens(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0)
  );
}
