import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession } from '../src/sources/shape.js';
import { buildAnalytics } from '../src/analytics.js';
import { makeDump, extractSessions, mergeDumps, DUMP_KIND } from '../src/merge.js';

/** A synthetic normalized session with known totals (1 session, set usage/cost). */
function synthSession(id, { input = 100, output = 50, cost = 1, project = 'demo' } = {}) {
  const s = newSession({
    sessionId: id,
    source: 'claude-code',
    projectLabel: project,
    projectPath: '/work/' + project,
    project: '/work/' + project,
    file: id + '.jsonl',
  });
  s.firstTs = '2026-06-01T10:00:00.000Z';
  s.lastTs = '2026-06-01T10:05:00.000Z';
  s.messageCount = 4;
  s.userMsgs = 2;
  s.assistantMsgs = 2;
  s.models = { 'claude-sonnet-4-6': 2 };
  s.usage = { input, output, cacheWrite: 0, cacheRead: 0 };
  s.cost = cost;
  s.modelUsage = {
    'claude-sonnet-4-6': { messages: 2, usage: { input, output, cacheWrite: 0, cacheRead: 0 }, cost },
  };
  s.tools = { Read: 1 };
  s.heat = { [3 * 24 + 10]: 2 };
  return s;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs-merge-'));
}

test('extractSessions: accepts envelope, bare array; rejects analytics/junk', () => {
  const sessions = [synthSession('a'), synthSession('b')];
  const dump = makeDump(sessions, { source: 'machineA' });
  assert.equal(dump.kind, DUMP_KIND);
  assert.equal(extractSessions(dump).length, 2);
  // bare array of sessions also works
  assert.equal(extractSessions(sessions).length, 2);
  // analytics output is NOT a session dump
  const analytics = buildAnalytics(sessions);
  assert.equal(extractSessions(analytics), null);
  // random junk
  assert.equal(extractSessions({ hello: 'world' }), null);
  assert.equal(extractSessions(42), null);
});

test('dump -> merge round-trips: merging two dumps sums totals', () => {
  const dir = tmpDir();
  // Person A: 2 sessions. Person B: 1 session. Distinct ids so nothing dedupes.
  const a = [synthSession('a1', { cost: 1 }), synthSession('a2', { cost: 2 })];
  const b = [synthSession('b1', { cost: 4 })];
  const fileA = path.join(dir, 'alice.json');
  const fileB = path.join(dir, 'bob.json');
  fs.writeFileSync(fileA, JSON.stringify(makeDump(a, { source: 'alice' })));
  fs.writeFileSync(fileB, JSON.stringify(makeDump(b, { source: 'bob' })));

  const { sessions, loaded, skipped } = mergeDumps([dir]);
  assert.equal(skipped.length, 0);
  assert.equal(loaded.length, 2);
  assert.equal(sessions.length, 3);

  const merged = buildAnalytics(sessions);
  // Totals are the SUM of the two dumps run separately.
  const ta = buildAnalytics(a).totals;
  const tb = buildAnalytics(b).totals;
  assert.equal(merged.totals.sessions, 3);
  assert.equal(merged.totals.sessions, ta.sessions + tb.sessions);
  assert.equal(merged.totals.cost, ta.cost + tb.cost);
  assert.equal(merged.totals.tokens, ta.tokens + tb.tokens);
  assert.equal(merged.totals.messages, ta.messages + tb.messages);

  // Provenance is tagged from the envelope source.
  assert.ok(sessions.every((s) => s.dumpSource === 'alice' || s.dumpSource === 'bob'));
});

test('merge tolerates a junk file (skips with a reason, keeps good data)', () => {
  const dir = tmpDir();
  const good = [synthSession('g1', { cost: 3 })];
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(makeDump(good)));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not valid json ');
  fs.writeFileSync(path.join(dir, 'notadump.json'), JSON.stringify({ totals: { sessions: 5 } }));
  // a non-.json file in the dir is ignored entirely
  fs.writeFileSync(path.join(dir, 'README.txt'), 'hello');

  const skips = [];
  const { sessions, loaded, skipped } = mergeDumps([dir], {
    onSkip: (file, reason) => skips.push({ file, reason }),
  });

  assert.equal(loaded.length, 1);
  assert.equal(sessions.length, 1);
  assert.equal(skipped.length, 2); // broken.json + notadump.json
  assert.equal(skips.length, 2);
  assert.ok(skipped.some((s) => /json/i.test(s.reason)));
  assert.ok(skipped.some((s) => /session dump/i.test(s.reason)));
  // The good data still aggregates correctly.
  assert.equal(buildAnalytics(sessions).totals.cost, 3);
});

test('merge reports a missing path instead of throwing', () => {
  const { sessions, loaded, skipped } = mergeDumps([path.join(os.tmpdir(), 'does-not-exist-xyz.json')]);
  assert.equal(sessions.length, 0);
  assert.equal(loaded.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /no such file/i);
});

test('merge accepts explicit file paths and a bare-array dump', () => {
  const dir = tmpDir();
  const a = [synthSession('a1')];
  const bareFile = path.join(dir, 'bare.json');
  fs.writeFileSync(bareFile, JSON.stringify(a)); // bare array, no envelope
  const { sessions, loaded } = mergeDumps([bareFile]);
  assert.equal(loaded.length, 1);
  assert.equal(sessions.length, 1);
  // dumpSource falls back to the file basename when there's no envelope source.
  assert.equal(sessions[0].dumpSource, 'bare.json');
});
