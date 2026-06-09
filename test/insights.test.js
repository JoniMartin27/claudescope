import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../src/insights.js';

function heatmap(day, hour, count) {
  const h = Array.from({ length: 7 }, () => new Array(24).fill(0));
  h[day][hour] = count;
  return h;
}

test('buildInsights returns a non-empty array of plain strings', () => {
  const a = {
    totals: {
      sessions: 20,
      tokens: 1_000_000,
      cost: 50,
      interruptedSessions: 4,
      usage: { input: 100, output: 200, cacheWrite: 0, cacheRead: 700_000 },
    },
    byProject: [
      { label: 'alpha', cost: 30 },
      { label: 'beta', cost: 20 },
    ],
    byModel: [{ model: 'claude-opus-4-8', cost: 40 }],
    byDay: [{ day: '2026-06-01' }, { day: '2026-06-02' }],
    heatmap: heatmap(1, 14, 9), // Monday 2pm
  };
  const out = buildInsights(a);
  assert.ok(Array.isArray(out));
  assert.ok(out.length >= 4 && out.length <= 6, `expected 4-6 insights, got ${out.length}`);
  for (const s of out) {
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 0);
    // No raw HTML tags leak into the plain-text insight strings.
    assert.ok(!/[<>]/.test(s), `insight contains angle brackets: ${s}`);
  }
  // Sanity: the busiest-hour insight names the right weekday.
  assert.ok(out.some((s) => s.includes('Monday')));
});

test('buildInsights guards empty/zero data without throwing', () => {
  const out = buildInsights({});
  assert.ok(Array.isArray(out));
  assert.ok(out.length >= 1);
  assert.equal(typeof out[0], 'string');
});
