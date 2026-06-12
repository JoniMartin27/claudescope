import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAll, parseFile, readConversation } from '../src/parser.js';
import { buildAnalytics, search } from '../src/analytics.js';

function tmp(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-v02-'));
  const pd = path.join(dir, 'projects', 'C--proj');
  fs.mkdirSync(pd, { recursive: true });
  const file = path.join(pd, 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, file };
}

// One assistant response split across 3 lines sharing message.id + identical usage.
function splitAssistant(id, model, usage) {
  return [
    { type: 'assistant', sessionId: 'x', timestamp: '2026-06-01T10:00:01Z',
      message: { id, model, content: [{ type: 'thinking', thinking: 'hmm' }], usage } },
    { type: 'assistant', sessionId: 'x', timestamp: '2026-06-01T10:00:01Z',
      message: { id, model, content: [{ type: 'text', text: 'answer' }], usage } },
    { type: 'assistant', sessionId: 'x', timestamp: '2026-06-01T10:00:01Z',
      message: { id, model, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la /tmp' } }], usage } },
  ];
}

test('usage/cost/replies are counted ONCE per message.id (no split-line inflation)', async () => {
  const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 };
  const { dir } = tmp([
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\proj', message: { role: 'user', content: 'hi' } },
    ...splitAssistant('msg_1', 'claude-opus-4-8', usage),
  ]);
  const { sessions } = await parseAll(dir);
  const s = sessions[0];
  assert.equal(s.assistantMsgs, 1, 'three split lines = one logical reply');
  assert.equal(s.usage.output, 20, 'output counted once, not 3x');
  assert.equal(s.usage.cacheRead, 1000);
  // Bash tool still counted (it lives on its own line)
  assert.equal(s.tools.Bash, 1);
  // model counted once
  assert.equal(s.models['claude-opus-4-8'], 1);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('cache hit-rate, savings, and per-session distribution are computed', async () => {
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
  const { dir } = tmp([
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\proj', message: { role: 'user', content: 'hi' } },
    ...splitAssistant('msg_1', 'claude-sonnet-4-6', usage),
  ]);
  const { sessions } = await parseAll(dir);
  const a = buildAnalytics(sessions);
  // hit rate = cacheRead / (cacheRead + input) = 900 / 1000
  assert.ok(Math.abs(a.totals.cacheHitRate - 0.9) < 1e-9);
  // savings = cacheRead * inputRate(3) * (1 - 0.1) / 1e6 = 900*3*0.9/1e6
  assert.ok(Math.abs(a.totals.cacheSavings - (900 * 3 * 0.9) / 1e6) < 1e-9);
  assert.ok(a.totals.perSession.medianCost >= 0);
  assert.equal(a.totals.perSession.medianMessages, 2); // 1 user + 1 reply
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('search supports role/project filters and returns total + truncated', async () => {
  const { dir } = tmp([
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\proj', message: { role: 'user', content: 'deploy the widget now' } },
    { type: 'assistant', sessionId: 'x', timestamp: '2026-06-01T10:00:01Z', message: { id: 'm', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'deploying the widget' }], usage: { output_tokens: 1 } } },
  ]);
  const { messages } = await parseAll(dir);
  assert.equal(search(messages, 'widget').total, 2);
  assert.equal(search(messages, 'widget', { role: 'user' }).total, 1);
  assert.equal(search(messages, 'widget', { role: 'assistant' }).results[0].role, 'assistant');
  const limited = search(messages, 'widget', { limit: 1 });
  assert.equal(limited.results.length, 1);
  assert.equal(limited.truncated, true);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('search regex mode matches a valid pattern and errors (no throw) on a bad one', async () => {
  const { dir } = tmp([
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\proj', message: { role: 'user', content: 'deploy widget v2' } },
    { type: 'assistant', sessionId: 'x', timestamp: '2026-06-01T10:00:01Z', message: { id: 'm', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'rolling back widget v3' }], usage: { output_tokens: 1 } } },
  ]);
  const { messages } = await parseAll(dir);
  // A working pattern: "widget v" followed by a digit, case-insensitive.
  const ok = search(messages, 'widget v\\d', { regex: true });
  assert.equal(ok.total, 2);
  assert.equal(ok.error, undefined);
  // Anchored regex that substring search could never satisfy.
  assert.equal(search(messages, '^rolling back', { regex: true }).total, 1);
  // An invalid pattern returns the documented error shape and does NOT throw.
  const bad = search(messages, '(', { regex: true });
  assert.deepEqual(bad, { results: [], total: 0, truncated: false, error: 'bad regex' });
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('tool_use input is searchable and interruptions are detected', async () => {
  const { dir } = tmp([
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\proj', message: { role: 'user', content: 'do it' } },
    { type: 'assistant', sessionId: 'x', timestamp: '2026-06-01T10:00:01Z', message: { id: 'm', model: 'claude-sonnet-4-6', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run deploy:prod' } }], usage: { output_tokens: 1 } } },
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:02Z', cwd: 'C:\\proj', message: { role: 'user', content: '[Request interrupted by user]' } },
  ]);
  const { sessions, messages } = await parseAll(dir);
  assert.equal(search(messages, 'deploy:prod').total, 1, 'command text inside tool input is searchable');
  assert.equal(sessions[0].interrupted, 1);
  const a = buildAnalytics(sessions);
  assert.equal(a.totals.interruptedSessions, 1);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('readConversation merges split assistant lines into one turn', async () => {
  const usage = { output_tokens: 5 };
  const { dir, file } = tmp([
    { type: 'user', sessionId: 'x', timestamp: '2026-06-01T10:00:00Z', cwd: 'C:\\proj', message: { role: 'user', content: 'question' } },
    ...splitAssistant('msg_1', 'claude-opus-4-8', usage),
  ]);
  const convo = await readConversation(file, 'x');
  assert.equal(convo.turns.length, 2, 'one user + one merged assistant turn');
  const asst = convo.turns[1];
  assert.equal(asst.role, 'assistant');
  assert.ok(asst.text.includes('answer'));
  assert.ok(asst.tools.includes('Bash'));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
