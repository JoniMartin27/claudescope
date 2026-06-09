import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportHtml } from '../public/report.js';

// Minimal copies of the dashboard helpers the builder depends on. These match
// public/app.js (escapeHtml is byte-identical; fmt is a deterministic subset).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const fmt = {
  num: (n) => String(n == null || isNaN(n) ? 0 : n),
  int: (n) => String(n == null || isNaN(n) ? 0 : Math.round(n)),
  money: (n) => '$' + (n == null || isNaN(n) ? 0 : n).toFixed(2),
  pct: (x) => (x * 100).toFixed(0) + '%',
  date: (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '—'),
};

function sampleAnalytics() {
  return {
    generatedAt: '2026-06-09T12:00:00.000Z',
    totals: {
      sessions: 12,
      messages: 340,
      userMsgs: 120,
      assistantMsgs: 220,
      tokens: 1_500_000,
      cost: 4.2,
      cacheSavings: 1.1,
      cacheHitRate: 0.62,
      tools: 88,
      firstTs: '2026-05-01T10:00:00Z',
      lastTs: '2026-06-09T09:00:00Z',
      usage: { input: 200000, output: 100000, cacheWrite: 300000, cacheRead: 900000 },
      percentile: { label: 'top 15%', monthlyTokens: 1200000 },
    },
    byModel: [{ model: 'claude-opus-4-8-20260101', cost: 3.0, tokens: 1000000, messages: 150, sessions: 8 }],
    byProject: [{ label: 'my-project', cost: 4.2, tokens: 1500000, sessions: 12 }],
    byTool: [{ tool: 'Bash', count: 50 }, { tool: 'Read', count: 38 }],
    archetype: { emoji: '🛠', name: 'The Builder', blurb: 'ships code' },
    insights: ['You cache a lot.', 'Bash is your top tool.'],
  };
}

test('buildReportHtml produces a self-contained HTML document with the headline stats', () => {
  const a = sampleAnalytics();
  const html = buildReportHtml(a, { fmt, escapeHtml }, { rangeLabel: 'Last 30 days', apiMode: false, generatedAt: a.generatedAt });

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<style>/, 'inline style block');
  // Zero network: no external resource refs and no executable scripts.
  assert.doesNotMatch(html, /<script/i, 'no scripts');
  assert.doesNotMatch(html, /<link\b/i, 'no <link> external refs');
  assert.doesNotMatch(html, /\b(src|href)\s*=/i, 'no src/href attributes');
  assert.doesNotMatch(html, /https?:\/\//, 'no network URLs');

  // Range label + headline stats present.
  assert.match(html, /Last 30 days/);
  assert.match(html, /Sessions/);
  assert.match(html, /Messages/);
  assert.match(html, /Tokens/);
  assert.match(html, /Est\. API cost/);
  assert.match(html, /Saved by cache/);
  assert.match(html, /top 15%/, 'percentile');

  // Tables + sections.
  assert.match(html, /Model spend/);
  assert.match(html, /opus-4-8/, 'model short name');
  assert.match(html, /Top projects/);
  assert.match(html, /my-project/);
  assert.match(html, /Token mix/);
  assert.match(html, /Tools used/);
  assert.match(html, /Bash/);
  // Archetype + insights.
  assert.match(html, /The Builder/);
  assert.match(html, /You cache a lot\./);
});

test('apiMode toggles the cost label', () => {
  const a = sampleAnalytics();
  const off = buildReportHtml(a, { fmt, escapeHtml }, { apiMode: false });
  const on = buildReportHtml(a, { fmt, escapeHtml }, { apiMode: true });
  assert.match(off, /Est\. API cost/);
  assert.doesNotMatch(off.replace(/Est\. API cost/g, ''), /(^|>)API cost</);
  assert.match(on, /(^|>)API cost</);
});

test('transcript-derived strings are HTML-escaped (no injection)', () => {
  const a = sampleAnalytics();
  const xss = '<img src=x onerror=alert(1)>';
  a.byProject[0].label = xss;
  a.byModel[0].model = xss;
  a.byTool[0].tool = xss;
  a.insights[0] = xss;
  a.archetype.name = xss;
  a.archetype.blurb = xss;

  const html = buildReportHtml(a, { fmt, escapeHtml }, {});
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/, 'raw payload must not appear');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'payload appears escaped');
  // And still no executable script slipped in via injection.
  assert.doesNotMatch(html, /<script/i);
});

test('tolerates an empty / zero analytics payload without throwing', () => {
  const empty = {
    generatedAt: '2026-06-09T00:00:00Z',
    totals: { sessions: 0, messages: 0, userMsgs: 0, assistantMsgs: 0, tokens: 0, cost: 0, cacheSavings: 0, cacheHitRate: 0, tools: 0, firstTs: null, lastTs: null, usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } },
    byModel: [], byProject: [], byTool: [], archetype: null, insights: [],
  };
  const html = buildReportHtml(empty, { fmt, escapeHtml }, {});
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /No model activity in range\./);
  assert.match(html, /No projects in range\./);
});
