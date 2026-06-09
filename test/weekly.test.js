import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekOverWeek, deltaPct } from '../src/analytics.js';

/** Local-time YYYY-MM-DD offset by `delta` days from a base Date. */
function dayKey(base, delta) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test('deltaPct: baseline rules (null when no prior, 0 when both zero)', () => {
  assert.equal(deltaPct(0, 0), 0);
  assert.equal(deltaPct(10, 0), null); // no baseline -> null
  assert.equal(deltaPct(0, 10), -100);
  assert.equal(deltaPct(15, 10), 50);
  assert.equal(deltaPct(5, 10), -50);
});

test('weekOverWeek sums last-7 vs prior-7 local days with correct deltas', () => {
  const now = new Date(2026, 5, 15); // fixed local date (June 15 2026)
  // this-week buckets: today (-0) and -3 ; last-week buckets: -7 and -10.
  const analytics = {
    byDay: [
      { day: dayKey(now, 0), cost: 2, tokens: 200, sessions: 1 },
      { day: dayKey(now, -3), cost: 3, tokens: 300, sessions: 2 },
      { day: dayKey(now, -7), cost: 1, tokens: 100, sessions: 1 },
      { day: dayKey(now, -10), cost: 4, tokens: 400, sessions: 3 },
      // -14 is outside both windows and must be ignored.
      { day: dayKey(now, -14), cost: 99, tokens: 9999, sessions: 99 },
    ],
  };

  const wow = weekOverWeek(analytics, now);

  assert.deepEqual(wow.thisWeek, { cost: 5, tokens: 500, sessions: 3 });
  assert.deepEqual(wow.lastWeek, { cost: 5, tokens: 500, sessions: 4 });
  // cost/tokens flat -> 0%, sessions 3 vs 4 -> -25%.
  assert.equal(wow.deltaPct.cost, 0);
  assert.equal(wow.deltaPct.tokens, 0);
  assert.equal(wow.deltaPct.sessions, deltaPct(3, 4));
});

test('weekOverWeek: empty prior week yields null cost/token deltas', () => {
  const now = new Date(2026, 5, 15);
  const analytics = {
    byDay: [{ day: dayKey(now, -1), cost: 10, tokens: 1000, sessions: 5 }],
  };
  const wow = weekOverWeek(analytics, now);
  assert.deepEqual(wow.thisWeek, { cost: 10, tokens: 1000, sessions: 5 });
  assert.deepEqual(wow.lastWeek, { cost: 0, tokens: 0, sessions: 0 });
  assert.equal(wow.deltaPct.cost, null);
  assert.equal(wow.deltaPct.tokens, null);
  assert.equal(wow.deltaPct.sessions, null);
});

test('weekOverWeek tolerates a missing/empty byDay', () => {
  const now = new Date(2026, 5, 15);
  const wow = weekOverWeek({}, now);
  assert.deepEqual(wow.thisWeek, { cost: 0, tokens: 0, sessions: 0 });
  assert.deepEqual(wow.lastWeek, { cost: 0, tokens: 0, sessions: 0 });
  assert.equal(wow.deltaPct.cost, 0);
});
