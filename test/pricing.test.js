import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costForUsage, priceForModel, totalTokens } from '../src/pricing.js';

test('priceForModel matches families with current Anthropic rates', () => {
  // Opus 4.x = $5 / $25 (NOT the legacy Opus-3 $15/$75)
  assert.equal(priceForModel('claude-opus-4-8').input, 5);
  assert.equal(priceForModel('claude-opus-4-8').output, 25);
  assert.equal(priceForModel('claude-opus-4-7').input, 5);
  // Legacy Opus 3 keeps its historic $15/$75
  assert.equal(priceForModel('claude-3-opus-20240229').output, 75);
  assert.equal(priceForModel('claude-sonnet-4-6').input, 3);
  assert.equal(priceForModel('claude-haiku-4-5').input, 1);
  assert.equal(priceForModel('claude-haiku-4-5').output, 5);
  assert.equal(priceForModel('claude-3-haiku').input, 0.25);
  assert.equal(priceForModel('mystery-model'), null);
});

test('costForUsage applies cache multipliers', () => {
  // 1M output on sonnet = $15
  assert.equal(costForUsage('claude-sonnet-4-6', { output_tokens: 1_000_000 }), 15);
  // 1M cache read on sonnet = input rate (3) * 0.1 = $0.30
  assert.ok(Math.abs(costForUsage('claude-sonnet-4-6', { cache_read_input_tokens: 1_000_000 }) - 0.3) < 1e-9);
  // 1M cache write on sonnet = 3 * 1.25 = $3.75
  assert.ok(Math.abs(costForUsage('claude-sonnet-4-6', { cache_creation_input_tokens: 1_000_000 }) - 3.75) < 1e-9);
  // 1M output on opus 4.x = $25 (verifies the corrected Opus rate)
  assert.equal(costForUsage('claude-opus-4-8', { output_tokens: 1_000_000 }), 25);
});

test('costForUsage returns 0 for unknown model or missing usage', () => {
  assert.equal(costForUsage('mystery', { output_tokens: 5 }), 0);
  assert.equal(costForUsage('claude-opus-4-8', null), 0);
});

test('totalTokens sums every field', () => {
  assert.equal(
    totalTokens({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }),
    10
  );
});
