import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFile as parseClaudeFile, parseAll } from '../src/parser.js';
import claudeAdapter from '../src/sources/claude-code.js';
import codexAdapter from '../src/sources/codex.js';
import copilotAdapter from '../src/sources/copilot.js';
import { parseAllSources, ADAPTERS } from '../src/sources/index.js';
import { buildAnalytics, search } from '../src/analytics.js';
import { newSession, newMessage } from '../src/sources/shape.js';

// ---- a minimal Claude Code fixture, reused to prove byte-identical output ----
function claudeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-src-claude-'));
  const proj = 'C--Users-test-demo';
  const projDir = path.join(dir, 'projects', proj);
  fs.mkdirSync(projDir, { recursive: true });
  const lines = [
    { type: 'user', sessionId: 's1', timestamp: '2026-06-01T10:00:00.000Z', cwd: 'C:\\Users\\test\\demo', message: { role: 'user', content: 'fix the bug' } },
    { type: 'assistant', sessionId: 's1', timestamp: '2026-06-01T10:00:05.000Z', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', name: 'Read' }], usage: { input_tokens: 10, output_tokens: 20 } } },
  ];
  fs.writeFileSync(path.join(projDir, 'session.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, proj, file: path.join(projDir, 'session.jsonl') };
}

test('claude-code adapter output equals the raw parser (plus a source tag)', async () => {
  const { proj, file } = claudeFixture();
  const raw = await parseClaudeFile(file, proj);
  const viaAdapter = await claudeAdapter.parseFile(file);

  // Same session count + identical core fields; the ONLY new field is `source`.
  assert.equal(viaAdapter.sessions.length, raw.sessions.length);
  const a = viaAdapter.sessions[0];
  const r = raw.sessions[0];
  assert.equal(a.source, 'claude-code');
  // Strip source and compare the rest byte-for-byte (parser already sets it now).
  const { source: _s, ...aRest } = a;
  const { source: _r, ...rRest } = r;
  assert.deepEqual(aRest, rRest);
  assert.equal(viaAdapter.messages.length, raw.messages.length);
  for (const m of viaAdapter.messages) assert.equal(m.source, 'claude-code');
  fs.rmSync(path.dirname(path.dirname(file)), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

// ---- a synthetic NON-claude source, written as a custom adapter ----
// Proves the normalized shape + source tagging without depending on any real
// CLI being installed on the test machine.
function syntheticAdapter(transcriptPath) {
  const ID = 'synthcli';
  return {
    id: ID,
    name: 'Synthetic CLI',
    locate: () => (fs.existsSync(transcriptPath) ? [transcriptPath] : []),
    async parseFile(p) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const sessionId = 'synth-1';
      const s = newSession({ sessionId, source: ID, projectLabel: 'synthproj', projectPath: '/tmp/synthproj' });
      const messages = [];
      for (const m of doc.messages) {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        s.messageCount++;
        if (role === 'user') {
          s.userMsgs++;
          if (!s.title) s.title = m.text.slice(0, 120);
        } else {
          s.assistantMsgs++;
          s.models['synth-model'] = (s.models['synth-model'] || 0) + 1;
        }
        if (!s.firstTs || m.ts < s.firstTs) s.firstTs = m.ts;
        if (!s.lastTs || m.ts > s.lastTs) s.lastTs = m.ts;
        messages.push(newMessage({ sessionId, source: ID, projectLabel: 'synthproj', ts: m.ts, role, text: m.text }));
      }
      return { sessions: [s], messages };
    },
  };
}

test('a synthetic non-claude adapter normalizes + tags source; analytics gains bySource', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-synth-'));
  const p = path.join(tmp, 'synth.json');
  fs.writeFileSync(p, JSON.stringify({
    messages: [
      { role: 'user', ts: '2026-06-02T09:00:00.000Z', text: 'synthetic prompt about widgets' },
      { role: 'assistant', ts: '2026-06-02T09:00:03.000Z', text: 'synthetic reply' },
    ],
  }));

  const { sessions, messages } = await syntheticAdapter(p).parseFile(p);
  // Normalized shape: every field analytics reads is present + source-tagged.
  const s = sessions[0];
  assert.equal(s.source, 'synthcli');
  assert.equal(s.userMsgs, 1);
  assert.equal(s.assistantMsgs, 1);
  assert.equal(s.projectLabel, 'synthproj');
  assert.ok('usage' in s && 'heat' in s && 'tools' in s && 'modelUsage' in s);
  for (const m of messages) assert.equal(m.source, 'synthcli');

  // buildAnalytics produces a bySource breakdown.
  const a = buildAnalytics(sessions);
  const sb = a.bySource.find((x) => x.source === 'synthcli');
  assert.ok(sb, 'bySource has the synthetic source');
  assert.equal(sb.sessions, 1);
  assert.equal(sb.messages, 2);

  // Source-filtered search.
  const hit = search(messages, 'widgets', { source: 'synthcli' });
  assert.equal(hit.total, 1);
  assert.equal(hit.results[0].source, 'synthcli');
  assert.equal(search(messages, 'widgets', { source: 'other' }).total, 0);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('parseAllSources stays Claude-Code-only behavior on a claude fixture and tags source', async () => {
  const { dir } = claudeFixture();
  // Point the other adapters at empty dirs so this is deterministic regardless
  // of what CLIs are installed on the test machine.
  const prev = { CODEX_HOME: process.env.CODEX_HOME, COPILOT_CONFIG_DIR: process.env.COPILOT_CONFIG_DIR, GEMINI_DIR: process.env.GEMINI_DIR, CURSOR_HOME: process.env.CURSOR_HOME, AIDER_CHAT_HISTORY_FILE: process.env.AIDER_CHAT_HISTORY_FILE };
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-empty-'));
  process.env.CODEX_HOME = empty;
  process.env.COPILOT_CONFIG_DIR = empty;
  process.env.GEMINI_DIR = empty;
  process.env.CURSOR_HOME = empty;
  process.env.AIDER_CHAT_HISTORY_FILE = path.join(empty, 'nope.md');
  try {
    const { sessions, messages, sources } = await parseAllSources(dir);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].source, 'claude-code');
    assert.ok(messages.every((m) => m.source === 'claude-code'));
    assert.deepEqual(sources.map((s) => s.id), ['claude-code']);

    // And it equals the legacy claude-only parseAll for the same dir.
    const legacy = await parseAll(dir);
    assert.equal(legacy.sessions.length, sessions.length);
    assert.equal(buildAnalytics(legacy.sessions).totals.cost, buildAnalytics(sessions).totals.cost);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(empty, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('every registered adapter has the required interface and locate() never throws', () => {
  for (const a of ADAPTERS) {
    assert.equal(typeof a.id, 'string');
    assert.equal(typeof a.name, 'string');
    assert.equal(typeof a.locate, 'function');
    assert.equal(typeof a.parseFile, 'function');
    assert.ok(Array.isArray(a.locate('/no/such/dir/at/all')));
  }
  // The two JSONL adapters we have real fixtures for export sane ids.
  assert.equal(codexAdapter.id, 'codex');
  assert.equal(copilotAdapter.id, 'copilot');
});

test('adapters tolerate a missing/garbage file without throwing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-garbage-'));
  const bad = path.join(tmp, 'bad.jsonl');
  fs.writeFileSync(bad, 'not json at all\n{also broken\n');
  for (const a of [codexAdapter, copilotAdapter]) {
    const r = await a.parseFile(bad);
    assert.ok(Array.isArray(r.sessions) && Array.isArray(r.messages));
    assert.equal(r.sessions.length, 0);
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
