import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAnthropicCost, __test } from '../src/anthropic.js';

const { parseCostReport, isoDayMaybe } = __test;

test('fetchAnthropicCost throws on a missing key WITHOUT touching the network', async () => {
  // Sabotage global fetch: if the connector tries the network, the test fails
  // loudly instead of silently making a request.
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    throw new Error('network should not be reached');
  };
  try {
    await assert.rejects(() => fetchAnthropicCost({}), /Missing Anthropic admin key/);
    await assert.rejects(() => fetchAnthropicCost({ apiKey: '' }), /Missing Anthropic admin key/);
    await assert.rejects(() => fetchAnthropicCost({ apiKey: '   ' }), /Missing Anthropic admin key/);
    assert.equal(fetched, false, 'no network request was attempted');
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchAnthropicCost surfaces a clear Error on a non-200 response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async text() {
      return 'unauthorized';
    },
  });
  try {
    await assert.rejects(() => fetchAnthropicCost({ apiKey: 'sk-ant-admin-x' }), /401/);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchAnthropicCost wraps network failures in a clear Error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  try {
    await assert.rejects(() => fetchAnthropicCost({ apiKey: 'sk-ant-admin-x' }), /Network error contacting Anthropic/);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchAnthropicCost parses a well-formed bucketed payload', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: [
          { starting_at: '2026-06-01', results: [{ amount: '1.50', currency: 'USD' }] },
          { starting_at: '2026-06-02', results: [{ amount: 2.25, currency: 'USD' }] },
        ],
      };
    },
  });
  try {
    const out = await fetchAnthropicCost({ apiKey: 'sk-ant-admin-x', days: 7 });
    assert.equal(out.currency, 'USD');
    assert.ok(Math.abs(out.totalCost - 3.75) < 1e-9);
    assert.equal(out.days.length, 2);
    assert.deepEqual(out.days.map((d) => d.day), ['2026-06-01', '2026-06-02']);
  } finally {
    globalThis.fetch = original;
  }
});

test('parseCostReport is defensive: unknown shapes yield total 0, never throw', () => {
  assert.deepEqual(parseCostReport(null), { totalCost: 0, days: [] });
  assert.deepEqual(parseCostReport({}), { totalCost: 0, days: [] });
  assert.deepEqual(parseCostReport({ data: 'nope' }), { totalCost: 0, days: [] });
  assert.deepEqual(parseCostReport({ data: [null, 1, 'x'] }), { totalCost: 0, days: [] });
  // Top-level total fallback.
  assert.equal(parseCostReport({ total_cost: '4.20' }).totalCost, 4.2);
  // Non-USD buckets are skipped.
  assert.equal(parseCostReport({ data: [{ amount: 9, currency: 'EUR' }] }).totalCost, 0);
});

test('isoDayMaybe normalizes assorted date forms (UTC) and rejects junk', () => {
  assert.equal(isoDayMaybe('2026-06-09'), '2026-06-09');
  assert.equal(isoDayMaybe('2026-06-09T12:34:56Z'), '2026-06-09');
  assert.equal(isoDayMaybe('not a date'), null);
  assert.equal(isoDayMaybe(12345), null);
});
