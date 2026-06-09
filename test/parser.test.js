import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFile, parseAll } from '../src/parser.js';
import { buildAnalytics, search } from '../src/analytics.js';
import { decodeProjectName, shortProjectLabel } from '../src/paths.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudescope-'));
  const proj = 'C--Users-test-Desktop-demo';
  const projDir = path.join(dir, 'projects', proj);
  fs.mkdirSync(projDir, { recursive: true });
  const lines = [
    { type: 'queue-operation', operation: 'enqueue', content: 'noise' },
    {
      type: 'user',
      sessionId: 's1',
      timestamp: '2026-06-01T10:00:00.000Z',
      cwd: 'C:\\Users\\test\\Desktop\\demo',
      version: '2.1.0',
      gitBranch: 'main',
      message: { role: 'user', content: 'Help me fix the parser bug please' },
    },
    {
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-06-01T10:00:05.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [
          { type: 'text', text: 'Sure, looking now.' },
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Edit' },
        ],
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 },
      },
    },
    {
      type: 'user',
      sessionId: 's1',
      timestamp: '2026-06-01T10:00:10.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'file contents here' }] },
    },
    { not: 'json parseable', broken: true }, // will be written as a broken line below
  ];
  const body =
    lines
      .slice(0, 4)
      .map((l) => JSON.stringify(l))
      .join('\n') +
    '\n{ this is not valid json\n' +
    JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-06-01T10:00:20.000Z',
      message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'Done.' }], usage: { output_tokens: 100 } },
    }) +
    '\n';
  fs.writeFileSync(path.join(projDir, 'session.jsonl'), body);
  return { dir, proj };
}

test('decodeProjectName + shortProjectLabel', () => {
  assert.equal(decodeProjectName('C--Users-test-Desktop-demo'), 'C:/Users/test/Desktop/demo');
  assert.equal(shortProjectLabel('C--Users-test-Desktop-demo'), 'demo');
});

test('parseFile extracts sessions, tools, usage and tolerates broken lines', async () => {
  const { dir, proj } = fixture();
  const file = path.join(dir, 'projects', proj, 'session.jsonl');
  const { sessions, messages } = await parseFile(file, proj);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.sessionId, 's1');
  assert.equal(s.userMsgs, 1); // tool_result user turn not counted as human
  assert.equal(s.assistantMsgs, 2);
  assert.equal(s.tools.Read, 1);
  assert.equal(s.tools.Edit, 1);
  assert.equal(s.models['claude-sonnet-4-6'], 1);
  assert.equal(s.models['claude-opus-4-8'], 1);
  assert.equal(s.gitBranch, 'main');
  assert.ok(s.title.startsWith('Help me fix'));
  assert.ok(s.cost > 0);
  assert.ok(messages.length >= 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseAll + buildAnalytics + search end to end', async () => {
  const { dir } = fixture();
  const { sessions, messages } = await parseAll(dir);
  const a = buildAnalytics(sessions);
  assert.equal(a.totals.sessions, 1);
  assert.equal(a.byProject[0].label, 'demo');
  assert.ok(a.byTool.find((t) => t.tool === 'Read'));
  assert.ok(a.totals.cost > 0);
  const hits = search(messages, 'parser bug');
  assert.ok(hits.results.length >= 1);
  assert.equal(hits.results[0].role, 'user');
  assert.equal(search(messages, 'zzz-no-match').results.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
