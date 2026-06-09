import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAll } from '../src/parser.js';
import { buildAnalytics, search } from '../src/analytics.js';

function write(dir, encoded, file, lines) {
  const pd = path.join(dir, 'projects', encoded);
  fs.mkdirSync(pd, { recursive: true });
  fs.writeFileSync(path.join(pd, file), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('distinct projects that share a last path segment do NOT merge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-collide-'));
  write(dir, 'C--work-foo-api', 's1.jsonl', [
    { type: 'user', sessionId: 'w1', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\work\\foo\\api',
      message: { role: 'user', content: 'work api session' } },
    { type: 'assistant', sessionId: 'w1', timestamp: '2026-06-01T10:00:01Z',
      message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'ok' }], usage: { output_tokens: 10 } } },
  ]);
  write(dir, 'C--personal-bar-api', 's2.jsonl', [
    { type: 'user', sessionId: 'p1', timestamp: '2026-06-02T10:00:00Z', cwd: 'C:\\personal\\bar\\api',
      message: { role: 'user', content: 'personal api session' } },
  ]);
  const { sessions } = await parseAll(dir);
  const a = buildAnalytics(sessions);
  const apis = a.byProject.filter((p) => p.label === 'api');
  assert.equal(apis.length, 2, 'two distinct "api" projects must remain separate rows');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cwd recovers a hyphenated folder label that the encoded name would split', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-hyphen-'));
  write(dir, 'C--Users-x-dynafeet-web', 's.jsonl', [
    { type: 'user', sessionId: 'h1', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\Users\\x\\dynafeet-web',
      message: { role: 'user', content: 'hi' } },
  ]);
  const { sessions } = await parseAll(dir);
  assert.equal(sessions[0].projectLabel, 'dynafeet-web');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('search finds terms far beyond the first 2000 characters', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-deep-'));
  const filler = 'x'.repeat(5000);
  write(dir, 'C--p', 's.jsonl', [
    { type: 'user', sessionId: 'd1', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\p',
      message: { role: 'user', content: `${filler} NEEDLEWORD ${filler}` } },
  ]);
  const { messages } = await parseAll(dir);
  assert.equal(search(messages, 'needleword').length, 1, 'must match a term ~5000 chars in');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('heatmap attributes each reply to its own hour and ignores assistant-less sessions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-heat-'));
  // Two assistant replies in different hours + one user-only session.
  write(dir, 'C--p', 's.jsonl', [
    { type: 'user', sessionId: 'a', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\p', message: { role: 'user', content: 'q' } },
    { type: 'assistant', sessionId: 'a', timestamp: '2026-06-01T10:30:00Z', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'a1' }], usage: { output_tokens: 1 } } },
    { type: 'assistant', sessionId: 'a', timestamp: '2026-06-01T13:30:00Z', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'a2' }], usage: { output_tokens: 1 } } },
    { type: 'user', sessionId: 'b', timestamp: '2026-06-01T22:00:00Z', cwd: 'C:\\p', message: { role: 'user', content: 'only user' } },
  ]);
  const { sessions } = await parseAll(dir);
  const a = buildAnalytics(sessions);
  const total = a.heatmap.flat().reduce((s, v) => s + v, 0);
  assert.equal(total, 2, 'exactly the two assistant replies count — no phantom for the user-only session');
  // local time buckets: verify the two replies landed in two different hours
  const nonZero = a.heatmap.flat().filter((v) => v > 0);
  assert.equal(nonZero.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
