import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildAuditRows,
  buildAuditCsv,
  buildAuditReport,
  sha256,
  CSV_HEADER,
  svgBars,
} from '../src/audit.js';
import { buildAnalytics } from '../src/analytics.js';

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-audit-'));
  return path.join(dir, name);
}

function sampleAnalytics() {
  return {
    generatedAt: '2026-06-12T00:00:00.000Z',
    totals: {
      sessions: 3,
      tokens: 1_500_000,
      cost: 4.2,
      firstTs: '2026-05-01T10:00:00Z',
      lastTs: '2026-06-10T09:00:00Z',
      percentile: { label: 'top 20%' },
      usage: { input: 200000, output: 100000, cacheWrite: 0, cacheRead: 0 },
    },
    byProject: [
      {
        label: 'my-project',
        path: '/home/u/my-project',
        sessions: 2,
        cost: 3.0,
        tokens: 1_000_000,
        usage: { input: 600000, output: 400000, cacheWrite: 0, cacheRead: 0 },
        firstTs: '2026-05-01T10:00:00Z',
        lastTs: '2026-06-09T12:00:00Z',
      },
      {
        // A malicious project label that a spreadsheet would treat as a formula.
        label: '=cmd|/c calc!A1',
        path: '/home/u/evil',
        sessions: 1,
        cost: 1.2,
        tokens: 500000,
        usage: { input: 300000, output: 200000, cacheWrite: 0, cacheRead: 0 },
        firstTs: '2026-06-08T08:00:00Z',
        lastTs: '2026-06-10T09:00:00Z',
      },
    ],
    byModel: [{ model: 'claude-opus-4-8-20260101', cost: 4.2, tokens: 1500000 }],
    byDay: [
      { day: '2026-06-09', sessions: 1, cost: 1.0, tokens: 400000 },
      { day: '2026-06-10', sessions: 2, cost: 3.2, tokens: 1100000 },
    ],
    archetype: { name: 'The Builder' },
  };
}

test('buildAuditRows: header order is the contract, one row per project', () => {
  const rows = buildAuditRows(sampleAnalytics());
  assert.deepEqual(rows[0], CSV_HEADER);
  assert.equal(rows.length, 3); // header + 2 projects
  // first project row values
  assert.equal(rows[1][0], 'my-project');
  assert.equal(rows[1][1], 2); // sessions
  assert.equal(rows[1][2], 600000); // input (+cache)
  assert.equal(rows[1][3], 400000); // output
  assert.equal(rows[1][4], 1000000); // total
  assert.equal(rows[1][5], 3.0); // cost
  assert.equal(rows[1][6], '2026-05-01T10:00:00Z'); // firstSeen
  assert.equal(rows[1][7], '2026-06-09T12:00:00Z'); // lastSeen
});

test('--csv output: has BOM, CRLF rows, and neutralizes a formula-injection label', () => {
  const csv = buildAuditCsv(sampleAnalytics(), { bom: true });
  assert.equal(csv.charCodeAt(0), 0xfeff, 'leading UTF-8 BOM');
  assert.match(csv, /\r\n/, 'CRLF line endings');
  // The =cmd label must be neutralized with a leading apostrophe.
  assert.match(csv, /'=cmd\|\/c calc!A1/, 'formula label neutralized');
  // A normal numeric cell stays raw (no apostrophe, no quotes).
  assert.match(csv, /,600000,/);
});

test('buildAuditCsv defaults to BOM on; can be turned off', () => {
  const withBom = buildAuditCsv(sampleAnalytics());
  const noBom = buildAuditCsv(sampleAnalytics(), { bom: false });
  assert.equal(withBom.charCodeAt(0), 0xfeff);
  assert.notEqual(noBom.charCodeAt(0), 0xfeff);
});

test('sha256 matches node:crypto over the exact CSV bytes', () => {
  const csv = buildAuditCsv(sampleAnalytics(), { bom: true });
  const expected = createHash('sha256').update(csv, 'utf8').digest('hex');
  assert.equal(sha256(csv), expected);
  assert.match(sha256(csv), /^[0-9a-f]{64}$/);
});

test('buildAuditReport: self-contained, provenance block, embedded sha256, charts', () => {
  const a = sampleAnalytics();
  const csv = buildAuditCsv(a, { bom: true });
  const csvSha = sha256(csv);
  const html = buildAuditReport(a, {
    generatedAt: '2026-06-12T00:00:00.000Z',
    tool: 'claudescope',
    version: '0.5.0',
    scope: '/home/u/.claude',
    sessionCount: 3,
    csvSha256: csvSha,
  });

  assert.match(html, /^<!doctype html>/i);
  // Zero network / zero deps client side.
  assert.doesNotMatch(html, /<script/i, 'no scripts');
  assert.doesNotMatch(html, /\b(src|href)\s*=/i, 'no src/href attrs');
  assert.doesNotMatch(html, /https?:\/\//, 'no network URLs');

  // Provenance lines.
  assert.match(html, /2026-06-12T00:00:00\.000Z/, 'generatedAt ISO 8601 UTC');
  assert.match(html, /\/home\/u\/\.claude/, 'scope');
  assert.match(html, /claudescope/);
  assert.match(html, /v0\.5\.0/);
  assert.match(html, new RegExp(csvSha), 'embedded CSV sha256');

  // Summary cards + charts + table.
  assert.match(html, /Sessions/);
  assert.match(html, /top 20%/);
  assert.match(html, /The Builder/);
  assert.match(html, /Cost per day/);
  assert.match(html, /Tokens per day/);
  assert.match(html, /Cost per project/);
  assert.match(html, /Cost per model/);
  assert.match(html, /<svg/, 'hand-drawn SVG charts');
  assert.match(html, /By project/);
});

test('buildAuditReport escapes the formula-injection label (no HTML/script injection)', () => {
  const a = sampleAnalytics();
  a.byProject[0].label = '<img src=x onerror=alert(1)>';
  const html = buildAuditReport(a, { csvSha256: 'deadbeef' });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x/);
});

test('buildAuditReport tolerates an empty analytics payload', () => {
  const html = buildAuditReport(
    { totals: { sessions: 0, tokens: 0, cost: 0 }, byProject: [], byModel: [], byDay: [] },
    { csvSha256: sha256(buildAuditCsv({ byProject: [] })) }
  );
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /No projects in scope\./);
});

test('svgBars returns an <svg> and an empty-state for no data', () => {
  const svg = svgBars([{ label: 'a', value: 3 }, { label: 'b', value: 1 }], { valueFmt: (v) => '$' + v });
  assert.match(svg, /^<svg/);
  assert.match(svg, /<rect/);
  assert.match(svg, /\$3/);
  const empty = svgBars([]);
  assert.match(empty, /No data in range\./);
});

test('end-to-end: CSV written to disk round-trips its own sha256, BOM present', () => {
  const a = sampleAnalytics();
  const csv = buildAuditCsv(a, { bom: true });
  const file = tmpFile('audit.csv');
  fs.writeFileSync(file, csv);
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.equal(onDisk.charCodeAt(0), 0xfeff, 'BOM survives the write');
  assert.equal(sha256(onDisk), sha256(csv), 'hash of written bytes equals computed hash');
});

test('analytics carries per-project firstTs/lastTs for the audit window', () => {
  const sessions = [
    {
      sessionId: 's1',
      projectPath: '/p/a',
      projectLabel: 'a',
      messageCount: 1,
      userMsgs: 1,
      assistantMsgs: 0,
      usage: { input: 10, output: 5, cacheWrite: 0, cacheRead: 0 },
      cost: 0.1,
      models: {},
      modelUsage: {},
      tools: {},
      heat: {},
      firstTs: '2026-06-01T00:00:00Z',
      lastTs: '2026-06-01T01:00:00Z',
    },
    {
      sessionId: 's2',
      projectPath: '/p/a',
      projectLabel: 'a',
      messageCount: 1,
      userMsgs: 1,
      assistantMsgs: 0,
      usage: { input: 10, output: 5, cacheWrite: 0, cacheRead: 0 },
      cost: 0.1,
      models: {},
      modelUsage: {},
      tools: {},
      heat: {},
      firstTs: '2026-06-03T00:00:00Z',
      lastTs: '2026-06-03T02:00:00Z',
    },
  ];
  const analytics = buildAnalytics(sessions);
  const proj = analytics.byProject[0];
  assert.equal(proj.firstTs, '2026-06-01T00:00:00Z', 'min first across sessions');
  assert.equal(proj.lastTs, '2026-06-03T02:00:00Z', 'max last across sessions');
});
