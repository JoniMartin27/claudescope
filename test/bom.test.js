import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripBom } from '../src/bom.js';
import { makeDump, mergeDumps } from '../src/merge.js';
import { parseFile } from '../src/parser.js';
import { recordSnapshot, readSnapshots } from '../src/snapshots.js';

const BOM = '﻿';

function tmpDir(prefix = 'cs-bom-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('stripBom removes only a leading BOM, leaves other strings intact', () => {
  assert.equal(stripBom(BOM + '{"a":1}'), '{"a":1}');
  assert.equal(stripBom('{"a":1}'), '{"a":1}');
  assert.equal(stripBom('a' + BOM + 'b'), 'a' + BOM + 'b'); // only leading
  assert.equal(stripBom(''), '');
  assert.equal(stripBom(undefined), undefined);
});

test('mergeDumps loads a dump saved WITH a UTF-8 BOM (Windows-authored)', () => {
  const dir = tmpDir();
  const dump = makeDump(
    [{ sessionId: 's1', usage: { input: 1, output: 2 }, messageCount: 3 }],
    { source: 'win-machine' }
  );
  const file = path.join(dir, 'me.json');
  // What PowerShell Out-File / Notepad produce: a leading BOM.
  fs.writeFileSync(file, BOM + JSON.stringify(dump));

  const skips = [];
  const { sessions, loaded, skipped } = mergeDumps([file], {
    onSkip: (f, reason) => skips.push(reason),
  });
  assert.deepEqual(skips, []);
  assert.equal(skipped.length, 0);
  assert.equal(loaded.length, 1);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 's1');
});

test('parseFile keeps the first line of a .jsonl that carries a BOM', async () => {
  const dir = tmpDir('cs-bom-jsonl-');
  const file = path.join(dir, 't.jsonl');
  const userLine = JSON.stringify({
    type: 'user',
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00Z',
    message: { content: 'hello first line' },
  });
  const asstLine = JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:01Z',
    message: { id: 'm1', model: 'claude-x', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10 } },
  });
  fs.writeFileSync(file, BOM + userLine + '\n' + asstLine + '\n');

  const { sessions } = await parseFile(file, 'proj');
  assert.equal(sessions.length, 1);
  // Without the fix the BOM-prefixed first line is dropped -> userMsgs 0, no title.
  assert.equal(sessions[0].userMsgs, 1);
  assert.equal(sessions[0].title, 'hello first line');
});

test('readSnapshots reads a snapshots.json saved with a BOM', () => {
  const dir = tmpDir('cs-bom-snap-');
  // Seed a snapshot, then re-save the file WITH a BOM to mimic a Windows editor.
  recordSnapshot({ date: '2026-01-01', sessions: 5, cost: 1, tokens: 100 }, dir);
  const file = path.join(dir, 'snapshots.json');
  const body = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, BOM + body);

  const snaps = readSnapshots(dir);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].date, '2026-01-01');
  assert.equal(snaps[0].sessions, 5);
});
