import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentileForMonthlyTokens,
  monthlyTokenRate,
  topPercent,
} from '../src/percentile.js';
import { buildAnalytics } from '../src/analytics.js';

test('percentileForMonthlyTokens is bounded to 0..100', () => {
  for (const t of [-100, 0, 1, 1e3, 5e6, 1e9, 1e12, Infinity, NaN]) {
    const p = percentileForMonthlyTokens(t);
    assert.ok(Number.isInteger(p), `not integer for ${t}: ${p}`);
    assert.ok(p >= 0 && p <= 100, `out of range for ${t}: ${p}`);
  }
});

test('percentileForMonthlyTokens is monotonic non-decreasing', () => {
  let prev = -1;
  for (let t = 0; t <= 2_000_000_000; t += 137_000) {
    const p = percentileForMonthlyTokens(t);
    assert.ok(p >= prev, `decreased at ${t}: ${p} < ${prev}`);
    prev = p;
  }
});

test('percentileForMonthlyTokens fixed expectations', () => {
  // Zero usage sits at the bottom.
  assert.equal(percentileForMonthlyTokens(0), 0);
  // An exact anchor returns its tabulated percentile.
  assert.equal(percentileForMonthlyTokens(6_000_000), 75);
  // Beyond the top anchor clamps to 100.
  assert.equal(percentileForMonthlyTokens(5_000_000_000), 100);
  // A light user is low; a heavy user is high.
  assert.ok(percentileForMonthlyTokens(50_000) < 20);
  assert.ok(percentileForMonthlyTokens(50_000_000) >= 90);
});

test('monthlyTokenRate normalizes to 30 days using the active span', () => {
  // 10 days of span, 1,000,000 tokens -> ~3,000,000 / 30d.
  const a = {
    totals: {
      tokens: 1_000_000,
      firstTs: '2026-06-01T00:00:00Z',
      lastTs: '2026-06-11T00:00:00Z',
    },
  };
  const rate = monthlyTokenRate(a);
  assert.ok(Math.abs(rate - 3_000_000) < 1, `got ${rate}`);
});

test('monthlyTokenRate clamps span to at least 1 day and handles zero', () => {
  // Same instant -> span clamps to 1 day -> tokens * 30.
  const same = monthlyTokenRate({ totals: { tokens: 10, firstTs: '2026-06-01T00:00:00Z', lastTs: '2026-06-01T00:00:00Z' } });
  assert.equal(same, 300);
  // No tokens -> 0.
  assert.equal(monthlyTokenRate({ totals: { tokens: 0 } }), 0);
  assert.equal(monthlyTokenRate({}), 0);
});

test('topPercent returns percentile, monthlyTokens and a "top X%" label', () => {
  const a = {
    totals: {
      tokens: 60_000_000,
      firstTs: '2026-06-01T00:00:00Z',
      lastTs: '2026-07-01T00:00:00Z', // ~30 days, so rate ~= tokens
    },
  };
  const r = topPercent(a);
  assert.ok(r.monthlyTokens > 0);
  assert.ok(r.percentile >= 0 && r.percentile <= 100);
  assert.match(r.label, /^top \d+%$/);
  // Never claims "top 0%".
  assert.ok(parseInt(r.label.match(/\d+/)[0], 10) >= 1);
  // Heavy user -> small top X.
  assert.ok(parseInt(r.label.match(/\d+/)[0], 10) <= 10);
});

test('topPercent label is monotonic: higher volume => smaller (or equal) "top X%"', () => {
  const mk = (tokens) => ({
    totals: { tokens, firstTs: '2026-06-01T00:00:00Z', lastTs: '2026-07-01T00:00:00Z' },
  });
  const topN = (a) => parseInt(topPercent(a).label.match(/\d+/)[0], 10);
  let prev = 101;
  for (const tok of [10_000, 500_000, 3_000_000, 12_000_000, 60_000_000, 500_000_000]) {
    const n = topN(mk(tok));
    assert.ok(n >= 1 && n <= 100, `top ${n} within 1..100`);
    assert.ok(n <= prev, `top X non-increasing as volume grows (${n} <= ${prev})`);
    prev = n;
  }
});

// ---- integration: buildAnalytics exposes totals.percentile ----

function fakeSession(overrides = {}) {
  return {
    sessionId: 's1',
    title: 't',
    project: 'p',
    projectLabel: 'p',
    projectPath: 'C:\\p',
    messageCount: 2,
    userMsgs: 1,
    assistantMsgs: 1,
    usage: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 4_000_000 },
    cost: 1,
    firstTs: '2026-06-01T00:00:00Z',
    lastTs: '2026-07-01T00:00:00Z',
    models: { 'claude-sonnet-4-6': 1 },
    modelUsage: { 'claude-sonnet-4-6': { usage: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 4_000_000 }, cost: 1 } },
    tools: {},
    heat: {},
    version: '1.0.0',
    gitBranch: 'main',
    interrupted: 0,
    ...overrides,
  };
}

test('buildAnalytics exposes totals.percentile', () => {
  const a = buildAnalytics([fakeSession()]);
  assert.ok(a.totals.percentile, 'percentile present');
  const p = a.totals.percentile;
  assert.ok(Number.isInteger(p.percentile));
  assert.ok(p.percentile >= 0 && p.percentile <= 100);
  assert.ok(p.monthlyTokens > 0);
  assert.match(p.label, /^top \d+%$/);
});

test('buildAnalytics with no sessions still yields a valid percentile object', () => {
  const a = buildAnalytics([]);
  assert.ok(a.totals.percentile);
  assert.equal(a.totals.percentile.percentile, 0);
  assert.equal(a.totals.percentile.label, 'top 100%');
});
