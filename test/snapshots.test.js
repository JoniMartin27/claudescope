import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotPath, readSnapshots, recordSnapshot, computeStreak } from '../src/snapshots.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs-snap-'));
}

/** Local-time YYYY-MM-DD offset by `delta` days from a base Date. */
function dayKey(base, delta) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test('computeStreak counts consecutive days up to today and stops at a gap', () => {
  const now = new Date();
  // today, yesterday, day-before -> streak 3
  const consecutive = [
    { date: dayKey(now, 0) },
    { date: dayKey(now, -1) },
    { date: dayKey(now, -2) },
  ];
  assert.equal(computeStreak(consecutive, now), 3);

  // gap: today present, but -1 missing, -2 present -> streak 1
  const gapped = [{ date: dayKey(now, 0) }, { date: dayKey(now, -2) }];
  assert.equal(computeStreak(gapped, now), 1);

  // today missing -> streak 0 even with recent days
  const noToday = [{ date: dayKey(now, -1) }, { date: dayKey(now, -2) }];
  assert.equal(computeStreak(noToday, now), 0);

  // empty / garbage -> 0, no throw
  assert.equal(computeStreak([], now), 0);
  assert.equal(computeStreak(undefined, now), 0);
  assert.equal(computeStreak([{ nope: 1 }, null], now), 0);
});

test('recordSnapshot upserts by date (one per day) and persists', () => {
  const dir = tmpDir();
  recordSnapshot({ date: '2026-06-01', sessions: 1, cost: 1, tokens: 100 }, dir);
  recordSnapshot({ date: '2026-06-02', sessions: 2, cost: 2, tokens: 200 }, dir);
  // Same date again -> overwrites, not appends.
  recordSnapshot({ date: '2026-06-01', sessions: 9, cost: 9, tokens: 999 }, dir);

  const snaps = readSnapshots(dir);
  assert.equal(snaps.length, 2, 'one snapshot per date');
  const june1 = snaps.find((s) => s.date === '2026-06-01');
  assert.equal(june1.sessions, 9, 'upserted to the latest values');
  assert.equal(june1.cost, 9);
  assert.equal(june1.tokens, 999);
  // Sorted ascending by date.
  assert.deepEqual(snaps.map((s) => s.date), ['2026-06-01', '2026-06-02']);

  // File actually exists at the expected override path.
  assert.ok(fs.existsSync(snapshotPath(dir)));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('recordSnapshot keeps at most ~400 most-recent snapshots', () => {
  const dir = tmpDir();
  for (let i = 0; i < 450; i++) {
    recordSnapshot({ date: dayKey(new Date(2025, 0, 1), i), sessions: i, cost: 0, tokens: 0 }, dir);
  }
  const snaps = readSnapshots(dir);
  assert.equal(snaps.length, 400, 'trimmed to 400');
  // The most-recent ones survive; the oldest are dropped.
  assert.equal(snaps[snaps.length - 1].sessions, 449);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('readSnapshots returns [] on missing / corrupt files (never throws)', () => {
  const dir = tmpDir();
  // Missing file.
  assert.deepEqual(readSnapshots(dir), []);
  // Corrupt JSON.
  fs.writeFileSync(snapshotPath(dir), 'not json {{{');
  assert.deepEqual(readSnapshots(dir), []);
  // Valid JSON but not an array.
  fs.writeFileSync(snapshotPath(dir), '{"a":1}');
  assert.deepEqual(readSnapshots(dir), []);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
