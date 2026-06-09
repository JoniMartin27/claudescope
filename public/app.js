const $ = (sel) => document.querySelector(sel);

const fmt = {
  num(n) {
    if (n == null) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  },
  money(n) {
    if (n == null) return '$0';
    if (n < 0.01 && n > 0) return '<$0.01';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  date(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

const COLORS = {
  input: '#36c5d0',
  output: '#d97757',
  cacheWrite: '#b18cf0',
  cacheRead: '#4ade80',
};

function renderCards(a) {
  const t = a.totals;
  const days =
    t.firstTs && t.lastTs
      ? Math.max(1, Math.round((new Date(t.lastTs) - new Date(t.firstTs)) / 86400000))
      : 1;
  const cards = [
    { k: 'Sessions', v: fmt.num(t.sessions), x: `${fmt.date(t.firstTs)} → ${fmt.date(t.lastTs)}`, c: '' },
    { k: 'Messages', v: fmt.num(t.messages), x: `${fmt.num(t.userMsgs)} prompts · ${fmt.num(t.assistantMsgs)} replies`, c: 'c2' },
    { k: 'Tokens', v: fmt.num(t.tokens), x: `${fmt.num(t.tokens / days)}/day across the wire`, c: 'c3' },
    { k: 'Est. API cost', v: fmt.money(t.cost), x: 'if billed at list API rates', c: 'c4' },
    { k: 'Tool calls', v: fmt.num(t.tools), x: `${a.byTool.length} distinct tools`, c: 'c5' },
  ];
  const wrap = $('#cards');
  wrap.innerHTML = '';
  for (const c of cards) {
    wrap.appendChild(
      el('div', `card ${c.c}`, `<div class="k">${c.k}</div><div class="v">${c.v}</div><div class="x">${c.x}</div>`)
    );
  }
}

function renderMeta(a, meta) {
  $('#meta').innerHTML =
    `<div><b>${fmt.num(meta.sessions)}</b> sessions · <b>${fmt.num(meta.messages)}</b> messages indexed</div>` +
    `<div>generated ${new Date(a.generatedAt).toLocaleString()}</div>`;
  $('#disclaimer').textContent =
    'Costs are estimates of what your token volume would cost on the pay-as-you-go Anthropic API at list prices — not your actual bill. ' +
    'If you are on a Max or Pro subscription, this is a relative gauge of intensity, not money spent.';
}

function bars(containerId, rows, { color2 = false, max } = {}) {
  const c = $('#' + containerId);
  c.innerHTML = '';
  const m = max || Math.max(...rows.map((r) => r.value), 1);
  for (const r of rows) {
    const row = el('div', 'bar-row' + (color2 ? ' c2' : ''));
    row.appendChild(el('div', 'lbl', r.label));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = Math.max(2, (r.value / m) * 100) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'val', r.display));
    c.appendChild(row);
  }
}

function renderProjects(a) {
  bars(
    'projects',
    a.byProject.slice(0, 8).map((p) => ({ label: p.label, value: p.cost, display: fmt.money(p.cost) }))
  );
}

const MODEL_COLORS = ['#d97757', '#36c5d0', '#b18cf0', '#4ade80', '#fbbf24', '#f472b6'];
function modelShort(id) {
  return id.replace('claude-', '').replace(/-\d{8}$/, '');
}
function renderModels(a) {
  const c = $('#models');
  c.innerHTML = '';
  const rows = a.byModel.slice(0, 8);
  const totalCost = rows.reduce((s, m) => s + m.cost, 0) || 1;
  const maxCost = Math.max(...rows.map((m) => m.cost), 0.0001);
  rows.forEach((m, i) => {
    const color = MODEL_COLORS[i % MODEL_COLORS.length];
    const pct = Math.round((m.cost / totalCost) * 100);
    const row = el('div', 'model-row');
    row.innerHTML =
      `<div class="model-head">` +
      `<span class="model-name"><span class="dot" style="background:${color}"></span>${escapeHtml(modelShort(m.model))}</span>` +
      `<span class="model-cost">${fmt.money(m.cost)}<span class="model-pct">${pct}%</span></span>` +
      `</div>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (m.cost / maxCost) * 100)}%;background:${color}"></div></div>` +
      `<div class="model-sub">${fmt.num(m.tokens)} tokens · ${fmt.num(m.messages)} replies · ${fmt.num(m.sessions)} sessions</div>`;
    c.appendChild(row);
  });
}

function renderTools(a) {
  bars(
    'tools',
    a.byTool.slice(0, 10).map((t) => ({ label: t.tool, value: t.count, display: fmt.num(t.count) }))
  );
}

function renderTokenMix(a) {
  const u = a.totals.usage;
  const segs = [
    { key: 'cacheRead', label: 'Cache read', val: u.cacheRead },
    { key: 'cacheWrite', label: 'Cache write', val: u.cacheWrite },
    { key: 'input', label: 'Input', val: u.input },
    { key: 'output', label: 'Output', val: u.output },
  ];
  const total = segs.reduce((s, x) => s + x.val, 0) || 1;
  const R = 52, C = 60, SW = 18, CIRC = 2 * Math.PI * R;
  let offset = 0;
  let circles = '';
  for (const s of segs) {
    const frac = s.val / total;
    const len = frac * CIRC;
    circles += `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${COLORS[s.key]}" stroke-width="${SW}"
      stroke-dasharray="${len} ${CIRC - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${C} ${C})" />`;
    offset += len;
  }
  const aria = segs.map((s) => `${s.label} ${Math.round((s.val / total) * 100)}%`).join(', ');
  const svg = `<svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Token mix: ${aria}"><title>Token mix: ${aria}</title>${circles}
    <text x="${C}" y="${C - 2}" text-anchor="middle" fill="#e7e9ee" font-size="17" font-weight="700" aria-hidden="true">${fmt.num(total)}</text>
    <text x="${C}" y="${C + 14}" text-anchor="middle" fill="#6b7280" font-size="9" aria-hidden="true">tokens</text></svg>`;
  const legend = segs
    .map(
      (s) =>
        `<div class="li"><span class="dot" style="background:${COLORS[s.key]}"></span>${s.label} <b>${fmt.num(s.val)}</b> <span style="color:#6b7280">(${Math.round((s.val / total) * 100)}%)</span></div>`
    )
    .join('');
  $('#tokenMix').innerHTML = svg + `<div class="legend">${legend}</div>`;
}

function renderTimeline(a) {
  const days = a.byDay;
  const c = $('#timeline');
  c.innerHTML = '';
  if (!days.length) {
    c.innerHTML = '<p style="color:#6b7280">No dated activity found.</p>';
    return;
  }
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  // show up to last 60 active days
  const slice = days.slice(-60);
  for (const d of slice) {
    const bar = el('div', 'tl-bar');
    bar.style.height = Math.max(2, (d.cost / max) * 100) + '%';
    const tip = `${d.day} · ${fmt.money(d.cost)} · ${d.sessions} sessions`;
    bar.dataset.tip = tip;
    bar.title = tip; // also available without hover-CSS (touch / a11y)
    c.appendChild(bar);
  }
  const axis = el('div', 'tl-axis');
  axis.innerHTML = `<span>${slice[0].day}</span><span>${slice[slice.length - 1].day}</span>`;
  c.parentElement.querySelector('.tl-axis')?.remove();
  c.after(axis);
}

const DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtHour(h) {
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}
let hmTooltip;
function getHmTooltip() {
  if (!hmTooltip) {
    hmTooltip = el('div', 'hm-tooltip');
    document.body.appendChild(hmTooltip);
  }
  return hmTooltip;
}
function renderHeatmap(a) {
  const c = $('#heatmap');
  c.innerHTML = '';
  let max = 1, peakD = 0, peakH = 0;
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) {
      const v = a.heatmap[d][h];
      if (v > max) { max = v; peakD = d; peakH = h; }
    }
  c.setAttribute('role', 'img');
  c.setAttribute(
    'aria-label',
    max > 1 ? `Activity heatmap by weekday and hour. Busiest: ${DAYFULL[peakD]} around ${fmtHour(peakH)}.` : 'Activity heatmap by weekday and hour.'
  );
  // header row
  c.appendChild(el('div', 'hm-lbl', ''));
  for (let h = 0; h < 24; h++) c.appendChild(el('div', 'hm-hour', h % 3 === 0 ? h : ''));
  for (let d = 0; d < 7; d++) {
    c.appendChild(el('div', 'hm-lbl', DAYNAMES[d]));
    for (let h = 0; h < 24; h++) {
      const v = a.heatmap[d][h];
      const cell = el('div', 'hm-cell');
      cell.dataset.d = d;
      cell.dataset.h = h;
      cell.dataset.v = v;
      if (v > 0) {
        const alpha = 0.15 + 0.85 * (v / max);
        cell.style.background = `rgba(217,119,87,${alpha.toFixed(2)})`;
      }
      c.appendChild(cell);
    }
  }

  // single delegated tooltip for the whole grid
  const tip = getHmTooltip();
  const show = (e) => {
    const cell = e.target.closest('.hm-cell');
    if (!cell) {
      tip.classList.remove('show');
      return;
    }
    const d = +cell.dataset.d;
    const h = +cell.dataset.h;
    const v = +cell.dataset.v;
    tip.innerHTML =
      `<div class="hm-tip-day">${DAYFULL[d]} · ${fmtHour(h)}–${fmtHour((h + 1) % 24)}</div>` +
      `<div class="hm-tip-val">${v === 0 ? 'No activity' : `<b>${fmt.num(v)}</b> messages`}</div>`;
    tip.classList.add('show');
    const pad = 12;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  c.addEventListener('mousemove', show);
  c.addEventListener('mouseleave', () => tip.classList.remove('show'));
}

function renderSessions(a) {
  const c = $('#sessions');
  c.innerHTML = '';
  for (const s of a.sessions.slice(0, 12)) {
    const row = el('div', 'session');
    const left = el('div');
    left.appendChild(el('div', 's-title', escapeHtml(s.title)));
    const tools = s.topTools
      .map((t) => `<span class="pill">${escapeHtml(t[0])} ${escapeHtml(String(t[1]))}</span>`)
      .join(' ');
    left.appendChild(
      el(
        'div',
        's-sub',
        `<span>${escapeHtml(s.project)}</span><span>${fmt.date(s.firstTs)}</span><span>${fmt.num(s.tokens)} tok</span>${tools}`
      )
    );
    row.appendChild(left);
    row.appendChild(el('div', 's-cost', `${fmt.money(s.cost)}<small>${s.messages} msgs</small>`));
    c.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- search ----------
let searchTimer;
function setupSearch() {
  const input = $('#search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      $('#searchResults').innerHTML = '';
      $('#searchHint').textContent = '';
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 180);
  });
}

async function runSearch(q) {
  $('#searchHint').textContent = 'searching…';
  const res = await fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.json());
  $('#searchHint').textContent = `${res.length}${res.length === 100 ? '+' : ''} matches`;
  const c = $('#searchResults');
  c.innerHTML = '';
  if (res.length === 0) {
    c.appendChild(el('div', 'result empty', `No matches for "${escapeHtml(q)}"`));
    return;
  }
  for (const r of res.slice(0, 40)) {
    const row = el('div', 'result');
    const role = r.role === 'assistant' ? 'assistant' : 'user';
    row.appendChild(
      el(
        'div',
        'r-head',
        `<span class="tag ${role}">${role}</span><span class="r-proj">${escapeHtml(r.project)}</span><span class="r-proj">${fmt.date(r.ts)}</span>`
      )
    );
    row.appendChild(el('div', 'r-text', highlight(escapeHtml(r.snippet), q)));
    c.appendChild(row);
  }
}

function highlight(escapedText, q) {
  let text = escapedText;
  for (const term of q.split(/\s+/)) {
    if (term.length < 2) continue;
    // Escape the term the SAME way the haystack was escaped, so terms with
    // &, <, >, " or ' match the entities present in the escaped snippet.
    const safe = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + safe + ')', 'ig');
    text = text.replace(re, '<mark>$1</mark>');
  }
  return text;
}

// ---------- boot ----------
function renderEmptyState() {
  document.querySelector('main').innerHTML =
    `<div class="panel empty-first"><div class="empty-logo">🔭</div>` +
    `<h2>No Claude Code sessions found yet</h2>` +
    `<p>ClaudeScope didn't find any transcripts under your <code>~/.claude/projects</code> folder. ` +
    `Run a Claude Code session, then refresh this page — your analytics will appear here.</p></div>`;
}

async function boot() {
  const [a, meta] = await Promise.all([
    fetch('/api/analytics').then((r) => r.json()),
    fetch('/api/meta').then((r) => r.json()),
  ]);
  if (!a.totals || a.totals.sessions === 0) {
    renderMeta(a, meta);
    renderEmptyState();
    return;
  }
  renderMeta(a, meta);
  renderCards(a);
  renderTokenMix(a);
  renderProjects(a);
  renderModels(a);
  renderTools(a);
  renderTimeline(a);
  renderHeatmap(a);
  renderSessions(a);
  setupSearch();
}

boot().catch((e) => {
  const main = document.querySelector('main');
  main.setAttribute('role', 'alert');
  main.innerHTML = `<div class="panel"><h2>Couldn't load data</h2><p class="muted">${escapeHtml(e.message)}</p></div>`;
});
