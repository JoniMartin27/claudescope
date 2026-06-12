// Audit export: turn a built analytics payload into (a) an AGGREGATE CSV and
// (b) a self-contained, printable HTML audit report.
//
// PRIVACY / DATA MINIMIZATION (GDPR by design): the audit surfaces only
// AGGREGATED figures — per-project session counts, token totals, cost, and
// first/last-seen dates. It never emits raw prompts, transcript bodies, titles,
// or any free-text a user typed. The only path to raw session content remains
// the explicit, opt-in `--dump-sessions` flag. This keeps the audit artifact
// safe to attach to compliance records / expense reports / data-portability
// requests.
//
// INTEGRITY: the report embeds the sha256 of the exact CSV bytes it describes,
// so a reviewer can re-export the CSV and verify nothing was altered between
// the figures in the HTML and the machine-readable data.
//
// Zero deps: only node:crypto (a built-in) is used, and only for the hash.

import { createHash } from 'node:crypto';
import { toCsv } from './csv.js';

/** Columns of the aggregate-by-project audit CSV (header order is the contract). */
export const CSV_HEADER = [
  'project',
  'sessions',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'costUsd',
  'firstSeen',
  'lastSeen',
];

/** Round a cost to cents-precision integers-of-USD without float drift noise. */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Build the aggregate audit rows (array-of-arrays incl. header) from analytics.
 * One row per project. firstSeen/lastSeen come from per-project min/max session
 * timestamps when available, else fall back to the global window so the column
 * is never silently blank.
 *
 * @param {object} analytics  output of buildAnalytics()
 * @returns {Array<Array<*>>}
 */
export function buildAuditRows(analytics) {
  const a = analytics || {};
  const projects = Array.isArray(a.byProject) ? a.byProject : [];
  const tGlobal = a.totals || {};

  const rows = [CSV_HEADER.slice()];
  for (const p of projects) {
    const u = p.usage || {};
    const input = (u.input || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0);
    const output = u.output || 0;
    const total = p.tokens != null ? p.tokens : input + output;
    rows.push([
      p.label || p.path || '(unknown)',
      p.sessions || 0,
      input,
      output,
      total,
      money(p.cost || 0),
      p.firstTs || tGlobal.firstTs || '',
      p.lastTs || tGlobal.lastTs || '',
    ]);
  }
  return rows;
}

/**
 * The canonical CSV bytes for the audit export. The SAME function feeds the
 * on-disk/stdout `--csv` and the sha256 the report embeds, so they can never
 * diverge.
 * @param {object} analytics
 * @param {object} [opts] { bom?: boolean }
 * @returns {string}
 */
export function buildAuditCsv(analytics, opts = {}) {
  return toCsv(buildAuditRows(analytics), { bom: opts.bom !== false });
}

/** sha256 hex of a string (utf8 bytes). */
export function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// HTML audit report (self-contained, no scripts, no network, printable)
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

function fmtUsd(n) {
  const v = Number(n) || 0;
  return '$' + v.toFixed(2);
}
function fmtInt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}
function modelShort(id) {
  return String(id).replace('claude-', '').replace(/-\d{8}$/, '');
}
function dayShort(d) {
  return String(d).slice(5); // YYYY-MM-DD -> MM-DD
}

/**
 * Hand-drawn SVG bar chart (no client JS, no library). Bars sized to the max
 * value; labels under each bar; an accessible <title>. Returns an SVG string.
 *
 * @param {Array<{label:string,value:number}>} data
 * @param {object} [opts] { width, barH, valueFmt, color, title }
 */
export function svgBars(data, opts = {}) {
  const rows = (data || []).filter((d) => d && Number.isFinite(Number(d.value)));
  const width = opts.width || 720;
  const barH = opts.barH || 22;
  const gap = 6;
  const labelW = opts.labelW || 150;
  const valW = 90;
  const chartW = Math.max(40, width - labelW - valW - 16);
  const color = opts.color || '#3b6db5';
  const fmt = opts.valueFmt || ((v) => String(v));
  const max = rows.reduce((m, d) => Math.max(m, Number(d.value) || 0), 0) || 1;
  const height = Math.max(barH, rows.length * (barH + gap));

  if (!rows.length) {
    return `<svg viewBox="0 0 ${width} ${barH}" role="img" width="100%" height="${barH}"><text x="0" y="15" class="empty">No data in range.</text></svg>`;
  }

  let bars = '';
  rows.forEach((d, i) => {
    const v = Number(d.value) || 0;
    const w = Math.max(1, Math.round((v / max) * chartW));
    const y = i * (barH + gap);
    bars +=
      `<text x="0" y="${y + barH * 0.7}" class="lbl">${escapeHtml(String(d.label).slice(0, 28))}</text>` +
      `<rect x="${labelW}" y="${y}" width="${w}" height="${barH - 4}" rx="2" fill="${color}"><title>${escapeHtml(String(d.label))}: ${escapeHtml(fmt(v))}</title></rect>` +
      `<text x="${labelW + w + 6}" y="${y + barH * 0.7}" class="val">${escapeHtml(fmt(v))}</text>`;
  });

  return `<svg viewBox="0 0 ${width} ${height}" role="img" width="100%" height="${height}">${bars}</svg>`;
}

/**
 * Build the self-contained HTML audit report.
 *
 * @param {object} analytics  built analytics payload
 * @param {object} meta       provenance metadata:
 *   { generatedAt, scope, version, tool, sessionCount, csvSha256 }
 * @returns {string} complete standalone HTML document
 */
export function buildAuditReport(analytics, meta = {}) {
  const a = analytics || {};
  const t = a.totals || {};
  const esc = escapeHtml;

  const generatedAt = meta.generatedAt || new Date().toISOString();
  const tool = meta.tool || 'claudescope';
  const version = meta.version || '';
  const scope = meta.scope || '(default ~/.claude)';
  const sessionCount = meta.sessionCount != null ? meta.sessionCount : t.sessions || 0;
  const csvSha = meta.csvSha256 || '';

  const arch = a.archetype || {};
  const pct = (t.percentile && t.percentile.label) || '—';
  const streak = meta.streak != null ? meta.streak : null;

  // ---- summary cards ----
  const cards = [
    ['Sessions', fmtInt(sessionCount)],
    ['Total tokens', fmtTokens(t.tokens || 0)],
    ['Est. cost (USD)', fmtUsd(t.cost || 0)],
    ['Percentile', esc(pct)],
    ['Archetype', esc(arch.name || '—')],
  ];
  if (streak != null) cards.push(['Streak (days)', fmtInt(streak)]);

  // ---- chart data ----
  const byDay = Array.isArray(a.byDay) ? a.byDay : [];
  const costByDay = byDay.map((d) => ({ label: dayShort(d.day), value: d.cost || 0 }));
  const tokByDay = byDay.map((d) => ({ label: dayShort(d.day), value: d.tokens || 0 }));
  const byProject = (Array.isArray(a.byProject) ? a.byProject : []).slice(0, 12);
  const costByProject = byProject.map((p) => ({ label: p.label || p.path || '(unknown)', value: p.cost || 0 }));
  const byModel = Array.isArray(a.byModel) ? a.byModel : [];
  const costByModel = byModel.map((m) => ({ label: modelShort(m.model), value: m.cost || 0 }));

  const usd = (v) => fmtUsd(v);
  const tok = (v) => fmtTokens(v);

  const chart = (heading, svg) =>
    `<section class="chart"><h3>${esc(heading)}</h3>${svg}</section>`;

  const charts = [
    chart('Cost per day', svgBars(costByDay, { valueFmt: usd, color: '#3b6db5' })),
    chart('Tokens per day', svgBars(tokByDay, { valueFmt: tok, color: '#5a8a4a' })),
    chart('Cost per project (top 12)', svgBars(costByProject, { valueFmt: usd, color: '#9a6a2a' })),
  ];
  if (costByModel.length) {
    charts.push(chart('Cost per model', svgBars(costByModel, { valueFmt: usd, color: '#7a4a8a' })));
  }

  // ---- per-project table ----
  const rows = buildAuditRows(a).slice(1); // drop header row
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td>${esc(r[0])}</td><td class="n">${fmtInt(r[1])}</td>` +
        `<td class="n">${fmtInt(r[2])}</td><td class="n">${fmtInt(r[3])}</td>` +
        `<td class="n">${fmtInt(r[4])}</td><td class="n">${fmtUsd(r[5])}</td>` +
        `<td>${esc(String(r[6]).slice(0, 10))}</td><td>${esc(String(r[7]).slice(0, 10))}</td></tr>`
    )
    .join('');

  const cardsHtml = cards
    .map(([k, v]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`)
    .join('');

  // Provenance block — everything an auditor needs to trust the artifact.
  const provenance = `
    <dl class="prov">
      <dt>Generated at (UTC)</dt><dd>${esc(generatedAt)}</dd>
      <dt>Scope</dt><dd>${esc(scope)}</dd>
      <dt>Sessions in scope</dt><dd>${fmtInt(sessionCount)}</dd>
      <dt>Tool</dt><dd>${esc(tool)}${version ? ' v' + esc(version) : ''}</dd>
      <dt>CSV sha256</dt><dd class="mono">${esc(csvSha)}</dd>
    </dl>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClaudeScope — Audit Report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 32px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 14px 0 6px; color: #444; font-weight: 600; }
  .sub { color: #666; margin: 0 0 20px; }
  .prov { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; padding: 12px 16px; background: #f6f7f9; border: 1px solid #e3e6ea; border-radius: 6px; }
  .prov dt { font-weight: 600; color: #555; }
  .prov dd { margin: 0; }
  .mono, .prov dd.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  .card { flex: 1 1 140px; border: 1px solid #e3e6ea; border-radius: 6px; padding: 10px 12px; background: #fff; }
  .card .k { color: #666; font-size: 12px; }
  .card .v { font-size: 20px; font-weight: 700; }
  .chart { margin: 12px 0 18px; }
  .chart text.lbl { font-size: 11px; fill: #333; }
  .chart text.val { font-size: 11px; fill: #555; }
  .chart text.empty { font-size: 12px; fill: #999; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 6px; }
  th, td { border: 1px solid #e3e6ea; padding: 5px 8px; text-align: left; }
  th { background: #f6f7f9; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  footer { margin-top: 28px; color: #888; font-size: 11px; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } .chart, table { page-break-inside: avoid; } }
</style>
</head>
<body>
  <h1>ClaudeScope — Audit Report</h1>
  <p class="sub">Aggregate usage export. No prompts or transcript bodies are included (data minimization by design).</p>

  <h2>Provenance</h2>
  ${provenance}

  <h2>Summary</h2>
  <div class="cards">${cardsHtml}</div>

  <h2>Charts</h2>
  ${charts.join('\n')}

  <h2>By project</h2>
  <table>
    <thead><tr><th>Project</th><th>Sessions</th><th>Input tok</th><th>Output tok</th><th>Total tok</th><th>Cost</th><th>First seen</th><th>Last seen</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="8">No projects in scope.</td></tr>'}</tbody>
  </table>

  <footer>
    Generated locally by ${esc(tool)}${version ? ' v' + esc(version) : ''}. Zero network. The CSV sha256 above lets a reviewer verify the machine-readable export this report describes.
  </footer>
</body>
</html>`;
}
