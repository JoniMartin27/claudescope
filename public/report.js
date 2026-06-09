// Self-contained HTML report builder. Pure (no DOM, no network): given a built
// analytics payload plus a few formatting helpers, it returns a SINGLE
// standalone .html document string — inline <style>, no external refs, no
// scripts. Opens in any browser offline. Shared by the dashboard's "HTML
// report" export and by the Node test suite (which is why it lives in its own
// ESM module rather than inline in app.js).
//
// SECURITY: every transcript-derived string (project labels, model ids,
// archetype name/blurb, insight text) is escaped with the injected `escapeHtml`
// before it reaches the markup. Callers must pass the same escapeHtml the
// dashboard uses.

function modelShort(id) {
  return String(id).replace('claude-', '').replace(/-\d{8}$/, '');
}

/**
 * @param {object} a        built analytics payload (totals, byModel, byProject…)
 * @param {object} helpers  { fmt, escapeHtml } — fmt is the dashboard's number
 *                          formatter (num/int/money/pct/date), escapeHtml is the
 *                          shared HTML escaper.
 * @param {object} [opts]   { rangeLabel, apiMode, generatedAt }
 * @returns {string} a complete, standalone HTML document.
 */
export function buildReportHtml(a, helpers, opts = {}) {
  const { fmt, escapeHtml } = helpers;
  const esc = escapeHtml;
  const t = (a && a.totals) || {};
  const u = t.usage || {};
  const rangeLabel = opts.rangeLabel || 'All time';
  const generated = opts.generatedAt ? new Date(opts.generatedAt) : new Date();
  const apiMode = !!opts.apiMode;
  const costLabel = apiMode ? 'API cost' : 'Est. API cost';

  const dateSpan =
    t.firstTs && t.lastTs ? `${fmt.date(t.firstTs)} → ${fmt.date(t.lastTs)}` : '—';

  // --- headline stat tiles ---
  const stats = [
    ['Sessions', fmt.int(t.sessions), ''],
    ['Messages', fmt.num(t.messages), `${fmt.num(t.userMsgs)} prompts · ${fmt.num(t.assistantMsgs)} replies`],
    ['Tokens', fmt.num(t.tokens), 'across the wire'],
    [costLabel, fmt.money(t.cost), apiMode ? 'at list API rates' : 'if billed at list API rates'],
    ['Saved by cache', fmt.money(t.cacheSavings), `${fmt.pct(t.cacheHitRate || 0)} of input from cache`],
    ['Tool calls', fmt.num(t.tools), `${(a.byTool || []).length} distinct tools`],
  ];
  const pct = t.percentile;
  if (pct && pct.label && t.tokens > 0) {
    stats.push(['Percentile (est.)', '~' + pct.label, 'rough offline estimate · token users']);
  }
  const statCards = stats
    .map(
      (s) =>
        `<div class="stat"><div class="k">${esc(s[0])}</div><div class="v">${esc(s[1])}</div>` +
        (s[2] ? `<div class="x">${esc(s[2])}</div>` : '') +
        `</div>`
    )
    .join('');

  // --- per-model table ---
  const modelRows = (a.byModel || [])
    .slice(0, 12)
    .map(
      (m) =>
        `<tr><td>${esc(modelShort(m.model))}</td><td class="num">${fmt.money(m.cost)}</td>` +
        `<td class="num">${fmt.num(m.tokens)}</td><td class="num">${fmt.num(m.messages)}</td>` +
        `<td class="num">${fmt.num(m.sessions)}</td></tr>`
    )
    .join('');
  const modelTable = modelRows
    ? `<table><thead><tr><th>Model</th><th class="num">${esc(costLabel)}</th><th class="num">Tokens</th><th class="num">Replies</th><th class="num">Sessions</th></tr></thead><tbody>${modelRows}</tbody></table>`
    : '<p class="muted">No model activity in range.</p>';

  // --- top-projects table ---
  const projRows = (a.byProject || [])
    .slice(0, 12)
    .map(
      (p) =>
        `<tr><td>${esc(p.label)}</td><td class="num">${fmt.money(p.cost)}</td>` +
        `<td class="num">${fmt.num(p.tokens)}</td><td class="num">${fmt.num(p.sessions)}</td></tr>`
    )
    .join('');
  const projTable = projRows
    ? `<table><thead><tr><th>Project</th><th class="num">${esc(costLabel)}</th><th class="num">Tokens</th><th class="num">Sessions</th></tr></thead><tbody>${projRows}</tbody></table>`
    : '<p class="muted">No projects in range.</p>';

  // --- token mix ---
  const mixSegs = [
    ['Cache read', u.cacheRead || 0, '#4ade80'],
    ['Cache write', u.cacheWrite || 0, '#b18cf0'],
    ['Input', u.input || 0, '#36c5d0'],
    ['Output', u.output || 0, '#d97757'],
  ];
  const mixTotal = mixSegs.reduce((s, x) => s + x[1], 0) || 1;
  const mixBar = mixSegs
    .map((s) => {
      const w = (s[1] / mixTotal) * 100;
      return w > 0 ? `<span style="width:${w.toFixed(2)}%;background:${s[2]}" title="${esc(s[0])}"></span>` : '';
    })
    .join('');
  const mixLegend = mixSegs
    .map(
      (s) =>
        `<li><span class="dot" style="background:${s[2]}"></span>${esc(s[0])} <b>${fmt.num(s[1])}</b> ` +
        `<span class="muted">(${Math.round((s[1] / mixTotal) * 100)}%)</span></li>`
    )
    .join('');

  // --- tools ---
  const toolRows = (a.byTool || [])
    .slice(0, 12)
    .map((x) => `<tr><td>${esc(x.tool)}</td><td class="num">${fmt.num(x.count)}</td></tr>`)
    .join('');
  const toolTable = toolRows
    ? `<table><thead><tr><th>Tool</th><th class="num">Calls</th></tr></thead><tbody>${toolRows}</tbody></table>`
    : '<p class="muted">No tool calls in range.</p>';

  // --- archetype + insights ---
  const arc = a.archetype;
  const arcHtml = arc
    ? `<div class="arc"><span class="arc-emoji">${esc(arc.emoji || '🧭')}</span>` +
      `<div><b>${esc(arc.name || '')}</b><div class="muted">${esc(arc.blurb || '')}</div></div></div>`
    : '';
  const insights = (Array.isArray(a.insights) ? a.insights : []).slice(0, 4);
  const insightsHtml = insights.length
    ? `<ul class="insights">${insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';

  const disclaimer = apiMode
    ? 'Costs are computed from token volume at current Anthropic list API prices — a close approximation of API spend, not your actual invoice.'
    : 'Costs are estimates of what this token volume would cost on the pay-as-you-go Anthropic API at list prices — not an actual bill. On a Max or Pro plan, treat this as a relative gauge of intensity.';

  const genStr = generated.toLocaleString
    ? generated.toLocaleString()
    : generated.toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ClaudeScope report — ${esc(rangeLabel)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    background: #0e0f13; color: #e7e9ee;
    font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 920px; margin: 0 auto; }
  header { border-bottom: 1px solid #2a2f3c; padding-bottom: 18px; margin-bottom: 26px; }
  h1 { margin: 0 0 6px; font-size: 26px; }
  h1 .logo { margin-right: 8px; }
  h2 { font-size: 16px; margin: 30px 0 12px; color: #e7e9ee; }
  .sub { color: #9aa3b2; font-size: 14px; }
  .muted { color: #9aa3b2; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { background: #1a1d26; border: 1px solid #2a2f3c; border-radius: 12px; padding: 14px 16px; }
  .stat .k { color: #9aa3b2; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .stat .v { font-size: 24px; font-weight: 700; margin: 4px 0 2px; }
  .stat .x { color: #8d96a6; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2f3c; }
  th { color: #9aa3b2; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .panel { background: #16181f; border: 1px solid #2a2f3c; border-radius: 12px; padding: 16px 18px; margin-bottom: 4px; }
  .mixbar { display: flex; height: 22px; border-radius: 6px; overflow: hidden; margin: 6px 0 12px; }
  .mixbar span { display: block; height: 100%; }
  ul.legend { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; }
  ul.legend .dot, .arc .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .arc { display: flex; align-items: center; gap: 12px; background: #1a1d26; border: 1px solid #2a2f3c; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
  .arc-emoji { font-size: 28px; }
  ul.insights { margin: 0; padding-left: 20px; }
  ul.insights li { margin: 4px 0; }
  footer { margin-top: 34px; padding-top: 16px; border-top: 1px solid #2a2f3c; color: #8d96a6; font-size: 12px; }
  footer .disc { margin-top: 6px; }
  @media print {
    body { background: #fff; color: #111; padding: 0; }
    .stat, .panel, .arc { background: #fff; border-color: #ddd; }
    .stat .k, .sub, .muted, th, .stat .x, footer { color: #555; }
    th, td { border-color: #ddd; }
    h1, h2, .stat .v { color: #111; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="logo">🔭</span>ClaudeScope report</h1>
    <div class="sub">${esc(rangeLabel)} · ${esc(dateSpan)}</div>
  </header>

  <section class="stats">${statCards}</section>

  ${arcHtml}
  ${insightsHtml}

  <h2>Model spend <span class="sub">(${esc(costLabel.toLowerCase())} &amp; tokens per model)</span></h2>
  <div class="panel">${modelTable}</div>

  <h2>Top projects</h2>
  <div class="panel">${projTable}</div>

  <h2>Token mix <span class="sub">(${fmt.num(mixTotal)} tokens total)</span></h2>
  <div class="panel">
    <div class="mixbar">${mixBar}</div>
    <ul class="legend">${mixLegend}</ul>
  </div>

  <h2>Tools used</h2>
  <div class="panel">${toolTable}</div>

  <footer>
    <div>Generated locally by 🔭 ClaudeScope · npx claudescope-cli · ${esc(genStr)}</div>
    <div class="disc">${esc(disclaimer)}</div>
  </footer>
</div>
</body>
</html>`;
}
