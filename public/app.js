import { buildReportHtml } from '/report.js';

const $ = (sel) => document.querySelector(sel);
const LOCALE = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
const REDUCE = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const _compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
const _int = new Intl.NumberFormat(LOCALE);
const _money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD' });

const fmt = {
  num(n) {
    if (n == null || isNaN(n)) return '0';
    return _compact.format(n);
  },
  int(n) {
    if (n == null || isNaN(n)) return '0';
    return _int.format(Math.round(n));
  },
  money(n) {
    if (n == null || isNaN(n)) return _money.format(0);
    if (n > 0 && n < 0.01) return '<' + _money.format(0.01);
    return _money.format(n);
  },
  date(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
  },
  dateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(LOCALE, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  pct(x) {
    return (x * 100).toFixed(x >= 0.999 ? 0 : 1) + '%';
  },
  duration(ms) {
    if (ms == null || isNaN(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  },
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- settings (localStorage-backed, fully local) ----------
function apiMode() {
  try {
    return localStorage.getItem('apiMode') === '1';
  } catch {
    return false;
  }
}
function setApiMode(on) {
  try {
    localStorage.setItem('apiMode', on ? '1' : '0');
  } catch {}
}

const COLORS = { input: '#36c5d0', output: '#d97757', cacheWrite: '#b18cf0', cacheRead: '#4ade80' };
const MODEL_COLORS = ['#d97757', '#36c5d0', '#b18cf0', '#4ade80', '#fbbf24', '#f472b6'];
const DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtHour(h) {
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}
function modelShort(id) {
  return id.replace('claude-', '').replace(/-\d{8}$/, '');
}

// ---------- cards ----------
function renderCards(a) {
  const t = a.totals;
  const days = t.firstTs && t.lastTs ? Math.max(1, Math.round((new Date(t.lastTs) - new Date(t.firstTs)) / 86400000)) : 1;
  const cards = [
    { k: 'Sessions', v: fmt.int(t.sessions), x: `${fmt.date(t.firstTs)} → ${fmt.date(t.lastTs)}`, c: '' },
    { k: 'Messages', v: fmt.num(t.messages), x: `${fmt.num(t.userMsgs)} prompts · ${fmt.num(t.assistantMsgs)} replies`, c: 'c2' },
    { k: 'Tokens', v: fmt.num(t.tokens), x: `${fmt.num(t.tokens / days)}/day across the wire`, c: 'c3' },
    { k: apiMode() ? 'API cost' : 'Est. API cost', v: fmt.money(t.cost), x: apiMode() ? 'at list API rates' : 'if billed at list API rates', c: 'c4' },
    { k: 'Saved by cache', v: fmt.money(t.cacheSavings), x: `${fmt.pct(t.cacheHitRate)} of input served from cache`, c: 'c5' },
    { k: 'Tool calls', v: fmt.num(t.tools), x: `${a.byTool.length} distinct tools`, c: '' },
  ];
  const wrap = $('#cards');
  wrap.innerHTML = '';
  for (const c of cards) {
    wrap.appendChild(el('div', `card ${c.c}`, `<div class="k">${c.k}</div><div class="v">${c.v}</div><div class="x">${c.x}</div>`));
  }
}

function renderTypical(a) {
  const p = a.totals.perSession || {};
  const host = $('#typical');
  if (!host) return;
  const items = [
    ['Median session', fmt.money(p.medianCost), `${fmt.int(p.medianMessages)} msgs · ${fmt.duration(p.medianDurationMs)}`],
    ['Heaviest 10% (p90)', fmt.money(p.p90Cost), 'the long tail that drives spend'],
    ['Interrupted', fmt.int(a.totals.interruptedSessions), `of ${fmt.int(a.totals.sessions)} sessions stopped mid-reply`],
  ];
  host.innerHTML = items
    .map((i) => `<div class="tw"><div class="tw-k">${i[0]}</div><div class="tw-v">${i[1]}</div><div class="tw-x">${i[2]}</div></div>`)
    .join('');
}

// ---------- insights strip + archetype ----------
function renderInsights(a) {
  const host = $('#insightsStrip');
  if (!host) return;
  const insights = Array.isArray(a.insights) ? a.insights : [];
  if (!insights.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  // insights are plain text from the backend, but escape defensively — they
  // interpolate transcript-derived project/model names.
  host.innerHTML = insights.map((i) => `<div class="insight-chip">${escapeHtml(i)}</div>`).join('');
}

function renderArchetype(a) {
  const chip = $('#archetypeChip');
  if (!chip) return;
  const arc = a.archetype;
  if (!arc) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.innerHTML =
    `<span class="arc-emoji" aria-hidden="true">${escapeHtml(arc.emoji || '🧭')}</span>` +
    `<span class="arc-text"><b>${escapeHtml(arc.name || '')}</b><small>${escapeHtml(arc.blurb || '')}</small></span>`;
}

function renderPercentile(a) {
  const badge = $('#percentileBadge');
  if (!badge) return;
  const p = a.totals && a.totals.percentile;
  if (!p || !p.label || !(a.totals.tokens > 0)) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  // p.label is generated server-side ("top X%") but escape defensively.
  badge.innerHTML =
    `<span class="pct-emoji" aria-hidden="true">🔭</span>` +
    `<span class="pct-text"><b>~${escapeHtml(p.label)} (est.)</b><small>token users · rough offline estimate</small></span>`;
  badge.title = 'Heuristic offline estimate (no real population data) based on ~' + fmt.num(Math.round(p.monthlyTokens)) + ' tokens/mo';
}

// ---------- momentum + streak ----------
function deltaBadge(pct) {
  if (pct == null) return '<span class="delta flat">— no baseline</span>';
  const up = pct >= 0;
  const cls = pct === 0 ? 'flat' : up ? 'up' : 'down';
  const arrow = pct === 0 ? '→' : up ? '▲' : '▼';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
}
async function loadMomentum() {
  const host = $('#momentumStrip');
  if (!host) return;
  let m;
  try {
    m = await fetch('/api/momentum').then((r) => r.json());
  } catch {
    host.hidden = true;
    return;
  }
  const dp = m.deltaPct || {};
  const streak = m.streak || 0;
  host.hidden = false;
  host.innerHTML =
    `<div class="mo-item"><div class="mo-k">This week vs last</div>` +
    `<div class="mo-v">${fmt.money(m.thisWeek ? m.thisWeek.cost : 0)} ${deltaBadge(dp.cost)}</div>` +
    `<div class="mo-x">cost · ${fmt.num(m.thisWeek ? m.thisWeek.tokens : 0)} tok ${deltaBadge(dp.tokens)}</div></div>` +
    `<div class="mo-item"><div class="mo-k">Streak</div>` +
    `<div class="mo-v">🔥 ${fmt.int(streak)}</div>` +
    `<div class="mo-x">${streak === 1 ? 'week' : 'weeks'} of activity</div></div>`;
}

// ---------- range diff (deltaPct on stat cards) ----------
async function loadDiff(range) {
  // Clear any prior badges first.
  document.querySelectorAll('#cards .card-delta').forEach((n) => n.remove());
  if (range === 'all') return;
  let d;
  try {
    d = await fetch('/api/diff?range=' + encodeURIComponent(range)).then((r) => r.json());
  } catch {
    return;
  }
  if (STATE.range !== range) return; // user switched away mid-fetch
  const dp = d.deltaPct || {};
  const label = `previous ${range.replace('d', 'd')}`;
  // Map stat-card index → diff key. Cards order: Sessions, Messages, Tokens,
  // cost, cache savings, tools.
  const map = [
    { idx: 0, pct: dp.sessions },
    { idx: 1, pct: dp.messages },
    { idx: 2, pct: dp.tokens },
    { idx: 3, pct: dp.cost },
  ];
  const cards = document.querySelectorAll('#cards .card');
  for (const { idx, pct } of map) {
    if (pct == null) continue;
    const card = cards[idx];
    if (!card) continue;
    const up = pct >= 0;
    const cls = pct === 0 ? 'flat' : up ? 'up' : 'down';
    const arrow = pct === 0 ? '→' : up ? '▲' : '▼';
    const badge = el('div', 'card-delta ' + cls, `${arrow} ${Math.abs(pct).toFixed(0)}% vs ${escapeHtml(label)}`);
    card.appendChild(badge);
  }
}

function renderMeta(a, meta) {
  $('#meta').innerHTML =
    `<div><b>${fmt.int(meta.sessions)}</b> sessions · <b>${fmt.num(meta.messages)}</b> messages indexed</div>` +
    `<div>generated ${new Date(a.generatedAt).toLocaleString(LOCALE)}</div>`;
  renderDisclaimer();
}

function renderDisclaimer() {
  const node = $('#disclaimer');
  if (!node) return;
  node.textContent = apiMode()
    ? 'Costs are computed from your token volume at current Anthropic list API prices. Treat as a close approximation of API spend — your actual invoice is authoritative.'
    : 'Costs are estimates of what your token volume would cost on the pay-as-you-go Anthropic API at list prices — not your actual bill. ' +
      'If you are on a Max or Pro subscription, this is a relative gauge of intensity, not money spent.';
}

// ---------- bars ----------
function bars(containerId, rows, { color2 = false, max } = {}) {
  const c = $('#' + containerId);
  c.innerHTML = '';
  const m = max || Math.max(...rows.map((r) => r.value), 1);
  for (const r of rows) {
    const row = el('div', 'bar-row' + (color2 ? ' c2' : ''));
    // Escape at this shared choke point: labels include transcript-derived
    // project/tool names which are NOT a trusted set.
    row.appendChild(el('div', 'lbl', escapeHtml(r.label)));
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
  bars('projects', a.byProject.slice(0, 8).map((p) => ({ label: p.label, value: p.cost, display: fmt.money(p.cost) })));
}
function renderTools(a) {
  bars('tools', a.byTool.slice(0, 10).map((t) => ({ label: t.tool, value: t.count, display: fmt.num(t.count) })));
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
      `<div class="model-head"><span class="model-name"><span class="dot" style="background:${color}"></span>${escapeHtml(modelShort(m.model))}</span>` +
      `<span class="model-cost">${fmt.money(m.cost)}<span class="model-pct">${pct}%</span></span></div>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (m.cost / maxCost) * 100)}%;background:${color}"></div></div>` +
      `<div class="model-sub">${fmt.num(m.tokens)} tokens · ${fmt.num(m.messages)} replies · ${fmt.num(m.sessions)} sessions</div>`;
    c.appendChild(row);
  });
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
  let offset = 0, circles = '';
  for (const s of segs) {
    const len = (s.val / total) * CIRC;
    circles += `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${COLORS[s.key]}" stroke-width="${SW}" stroke-dasharray="${len} ${CIRC - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${C} ${C})" />`;
    offset += len;
  }
  const aria = segs.map((s) => `${s.label} ${Math.round((s.val / total) * 100)}%`).join(', ');
  const svg = `<svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Token mix: ${aria}"><title>Token mix: ${aria}</title>${circles}<text x="${C}" y="${C - 2}" text-anchor="middle" fill="#e7e9ee" font-size="17" font-weight="700" aria-hidden="true">${fmt.num(total)}</text><text x="${C}" y="${C + 14}" text-anchor="middle" fill="#8d96a6" font-size="9" aria-hidden="true">tokens</text></svg>`;
  const legend = segs
    .map((s) => `<div class="li"><span class="dot" style="background:${COLORS[s.key]}"></span>${s.label} <b>${fmt.num(s.val)}</b> <span style="color:var(--faint)">(${Math.round((s.val / total) * 100)}%)</span></div>`)
    .join('');
  $('#tokenMix').innerHTML = svg + `<div class="legend">${legend}</div>`;
}

// ---------- timeline (cost / tokens toggle) ----------
let timelineMetric = 'cost';
function renderTimeline(a) {
  const days = a.byDay;
  const c = $('#timeline');
  c.innerHTML = '';
  if (!days.length) {
    c.innerHTML = '<p class="muted">No dated activity found.</p>';
    return;
  }
  const slice = days.slice(-60);
  const valOf = (d) => (timelineMetric === 'tokens' ? d.tokens : d.cost);
  const max = Math.max(...slice.map(valOf), 0.0001);
  for (const d of slice) {
    const bar = el('div', 'tl-bar');
    bar.style.height = Math.max(2, (valOf(d) / max) * 100) + '%';
    const tip = `${d.day} · ${fmt.money(d.cost)} · ${fmt.num(d.tokens)} tok · ${d.sessions} sessions`;
    bar.dataset.tip = tip;
    bar.title = tip;
    c.appendChild(bar);
  }
  const axis = el('div', 'tl-axis');
  axis.innerHTML = `<span>${slice[0].day}</span><span>peak ${timelineMetric === 'tokens' ? fmt.num(max) + ' tok' : fmt.money(max)}/day</span><span>${slice[slice.length - 1].day}</span>`;
  c.parentElement.querySelector('.tl-axis')?.remove();
  c.after(axis);
}

// ---------- heatmap ----------
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
  c.setAttribute('aria-label', max > 1 ? `Activity heatmap by weekday and hour. Busiest: ${DAYFULL[peakD]} around ${fmtHour(peakH)}.` : 'Activity heatmap by weekday and hour.');
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
      cell.title = `${DAYFULL[d]} ${fmtHour(h)} — ${v} ${v === 1 ? 'message' : 'messages'}`;
      if (v > 0) cell.style.background = `rgba(217,119,87,${(0.15 + 0.85 * (v / max)).toFixed(2)})`;
      c.appendChild(cell);
    }
  }
  const tip = getHmTooltip();
  const show = (e) => {
    const cell = e.target.closest('.hm-cell');
    if (!cell) return tip.classList.remove('show');
    const d = +cell.dataset.d, h = +cell.dataset.h, v = +cell.dataset.v;
    tip.innerHTML = `<div class="hm-tip-day">${DAYFULL[d]} · ${fmtHour(h)}–${fmtHour((h + 1) % 24)}</div><div class="hm-tip-val">${v === 0 ? 'No activity' : `<b>${fmt.num(v)}</b> messages`}</div>`;
    tip.classList.add('show');
    const pad = 12;
    let x = e.clientX + pad, y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  c.addEventListener('mousemove', show);
  c.addEventListener('mouseleave', () => tip.classList.remove('show'));
}

// ---------- top sessions (clickable → modal) ----------
function renderSessions(a) {
  const c = $('#sessions');
  c.innerHTML = '';
  for (const s of a.sessions.slice(0, 12)) {
    const row = el('div', 'session');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.dataset.id = s.sessionId;
    const left = el('div');
    const flag = s.interrupted ? ' <span class="s-flag" title="interrupted mid-reply">⏹ ' + s.interrupted + '</span>' : '';
    left.appendChild(el('div', 's-title', escapeHtml(s.title) + flag));
    const tools = s.topTools.map((t) => `<span class="pill">${escapeHtml(t[0])} ${escapeHtml(String(t[1]))}</span>`).join(' ');
    left.appendChild(
      el('div', 's-sub', `<span>${escapeHtml(s.project)}</span><span>${fmt.date(s.firstTs)}</span><span>${fmt.num(s.tokens)} tok</span><span>${fmt.duration(s.durationMs)}</span>${tools}`)
    );
    row.appendChild(left);
    row.appendChild(el('div', 's-cost', `${fmt.money(s.cost)}<small>${fmt.num(s.messages)} msgs</small>`));
    row.addEventListener('click', () => openSession(s.sessionId, s.title));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSession(s.sessionId, s.title);
      }
    });
    c.appendChild(row);
  }
}

// ---------- search ----------
let searchTimer;
let regexMode = false;
function reSearch() {
  const q = $('#search').value.trim();
  if (q.length < (regexMode ? 1 : 2)) {
    $('#searchResults').innerHTML = '';
    $('#searchHint').textContent = '';
    return;
  }
  runSearch(q);
}
function setupSearch() {
  const input = $('#search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < (regexMode ? 1 : 2)) {
      $('#searchResults').innerHTML = '';
      $('#searchHint').textContent = '';
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 180);
  });
  const toggle = $('#regexToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      regexMode = !regexMode;
      toggle.classList.toggle('active', regexMode);
      toggle.setAttribute('aria-pressed', regexMode ? 'true' : 'false');
      $('#search').setAttribute('placeholder', regexMode
        ? 'Regex search… e.g. TODO|FIXME'
        : 'Search across every prompt, reply and tool call…');
      reSearch();
    });
  }
}
async function runSearch(q) {
  $('#searchHint').textContent = 'searching…';
  const srcParam = STATE.source ? '&source=' + encodeURIComponent(STATE.source) : '';
  const url = '/api/search?q=' + encodeURIComponent(q) + '&limit=40' + (regexMode ? '&regex=1' : '') + srcParam;
  const res = await fetch(url).then((r) => r.json());
  const c = $('#searchResults');
  if (res.error === 'bad regex') {
    $('#searchHint').textContent = 'invalid regex';
    c.innerHTML = '';
    c.appendChild(el('div', 'result empty regex-bad', 'Invalid regular expression — check your pattern.'));
    return;
  }
  const total = res.total ?? res.results.length;
  $('#searchHint').textContent = `${fmt.int(total)} ${total === 1 ? 'match' : 'matches'}${regexMode ? ' · regex' : ''}`;
  c.innerHTML = '';
  if (!res.results.length) {
    c.appendChild(el('div', 'result empty', `No matches for "${escapeHtml(q)}"`));
    return;
  }
  for (const r of res.results) {
    const row = el('div', 'result');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.dataset.id = r.sessionId;
    const role = r.role === 'assistant' ? 'assistant' : 'user';
    // Show which CLI a hit came from, but only when more than one is present.
    let srcTag = '';
    if ((STATE.sources || []).length > 1 && r.source) {
      const m = sourceMeta(r.source);
      srcTag = `<span class="r-src" style="border-color:${m.color}">${escapeHtml(m.label)}</span>`;
    }
    row.appendChild(el('div', 'r-head', `<span class="tag ${role}">${role}</span>${srcTag}<span class="r-proj">${escapeHtml(r.project)}</span><span class="r-proj">${fmt.date(r.ts)}</span><span class="r-open">open ↗</span>`));
    row.appendChild(el('div', 'r-text', highlight(escapeHtml(r.snippet), q)));
    const open = () => openSession(r.sessionId, r.snippet.slice(0, 60), { query: q, snippet: r.snippet });
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    c.appendChild(row);
  }
}
function highlight(escapedText, q) {
  let text = escapedText;
  for (const term of q.split(/\s+/)) {
    if (term.length < 2) continue;
    const safe = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('(' + safe + ')', 'ig'), '<mark>$1</mark>');
  }
  return text;
}

// ---------- modal focus management (WCAG 2.4.3 / 2.1.2) ----------
let lastFocused = null;
function trapFocus(e, modal) {
  if (e.key !== 'Tab') return;
  const f = modal.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function focusModal(modal) {
  lastFocused = document.activeElement;
  const target = modal.querySelector('.modal-close') || modal;
  target.focus();
}
function restoreFocus() {
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

// ---------- session detail modal ----------
// Normalize transcript/snippet text the same way: collapse whitespace + lowercase.
// The search snippet is `text.replace(/\s+/g,' ').slice(0,N)` so matching a
// turn's whitespace-collapsed text against the snippet is robust to the
// formatting differences (and to truncation — we test a leading chunk).
function normForMatch(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}
// Pick the index of the turn that best matches a search hit. Try the snippet
// substring first (most precise), then fall back to query terms. Returns -1 if
// nothing matches (caller just opens at the top).
function findTurnIndex(turns, jump) {
  if (!jump || !Array.isArray(turns) || !turns.length) return -1;
  const norm = turns.map((t) => normForMatch(t.text));
  const snip = normForMatch(jump.snippet);
  if (snip) {
    // The snippet may have been truncated/merged; test progressively shorter
    // leading chunks so a partial overlap still lands on the right turn.
    for (const len of [snip.length, 80, 48, 24]) {
      if (len > snip.length) continue;
      const probe = snip.slice(0, len).trim();
      if (probe.length < 8) break;
      const i = norm.findIndex((n) => n.includes(probe));
      if (i !== -1) return i;
    }
  }
  const terms = String(jump.query || '')
    .split(/\s+/)
    .map((t) => normForMatch(t))
    .filter((t) => t.length >= 2);
  if (terms.length) {
    // Prefer the turn containing the most distinct query terms.
    let best = -1, bestScore = 0;
    for (let i = 0; i < norm.length; i++) {
      let score = 0;
      for (const term of terms) if (norm[i].includes(term)) score++;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (bestScore > 0) return best;
  }
  return -1;
}
async function openSession(id, label, jump) {
  const modal = $('#modal');
  const body = $('#modalBody');
  $('#modalTitle').textContent = label ? label : 'Session';
  body.innerHTML = '<div class="modal-loading">Loading conversation…</div>';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  focusModal(modal);
  try {
    const c = await fetch('/api/session?id=' + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))));
    // Non-Claude sources don't (yet) support the full transcript re-read.
    if (c.note && (!c.turns || !c.turns.length)) {
      body.innerHTML = `<div class="modal-loading">${escapeHtml(c.note)}</div>`;
      return;
    }
    const CAP = 600;
    const total = c.turns.length;
    const turns = total > CAP ? c.turns.slice(-CAP) : c.turns;
    const note = total > CAP ? `<div class="convo-note">Showing the most recent ${CAP} of ${fmt.int(total)} turns.</div>` : '';
    const meta = [c.cwd ? escapeHtml(c.cwd.split(/[\\/]/).pop()) : null, c.gitBranch ? '⎇ ' + escapeHtml(c.gitBranch) : null, c.version ? 'v' + escapeHtml(c.version) : null, `${fmt.int(total)} turns`].filter(Boolean).join(' · ');
    // When opened from a search result, locate the matched turn so we can scroll
    // to it and highlight both the turn and the query terms inside it.
    const hitIdx = findTurnIndex(turns, jump);
    const query = jump && jump.query ? jump.query : '';
    body.innerHTML = `<div class="convo-meta">${meta}</div>${note}` + turns.map((t, i) => turnHtml(t, i, i === hitIdx ? query : '')).join('');
    if (hitIdx !== -1) jumpToTurn(body, hitIdx);
  } catch {
    body.innerHTML = '<div class="modal-loading">Couldn\'t load this session transcript.</div>';
  }
}
// Scroll the matched turn into view and flash a temporary highlight ring.
function jumpToTurn(body, idx) {
  const target = body.querySelector(`.ct[data-turn="${idx}"]`);
  if (!target) return;
  target.classList.add('ct-hit');
  // Defer to next frame so layout is settled before scrolling within the modal.
  requestAnimationFrame(() => {
    try {
      target.scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' });
    } catch {
      target.scrollIntoView();
    }
  });
}
function turnHtml(t, idx, query) {
  const who = t.kind === 'tool_result' ? 'tool' : t.role;
  const tools = (t.tools || []).length ? ` <span class="ct-tools">${t.tools.map((x) => escapeHtml(x)).join(' ')}</span>` : '';
  let text = t.text ? escapeHtml(t.text) : '<span class="muted">(no text)</span>';
  // Mark the query terms inside the matched turn (reuses the search highlight()).
  if (query && t.text) text = highlight(text, query);
  const attr = idx == null ? '' : ` data-turn="${idx}"`;
  return `<div class="ct ct-${who}"${attr}><div class="ct-head"><span class="tag ${who === 'assistant' ? 'assistant' : who === 'user' ? 'user' : 'toolr'}">${who}</span>${t.model ? `<span class="ct-model">${escapeHtml(modelShort(t.model))}</span>` : ''}<span class="ct-ts">${fmt.dateTime(t.ts)}</span>${tools}</div><div class="ct-text">${text}</div></div>`;
}
function closeModal() {
  const m = $('#modal');
  if (m) m.hidden = true;
  document.body.style.overflow = '';
  restoreFocus();
}
function setupModal() {
  const m = $('#modal');
  if (!m) return;
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) closeModal();
  });
  m.addEventListener('keydown', (e) => trapFocus(e, m));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!m.hidden) closeModal();
    const sm = $('#shareModal');
    if (sm && !sm.hidden) {
      sm.hidden = true;
      document.body.style.overflow = '';
      restoreFocus();
    }
  });
}

// ---------- export ----------
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCSV(a) {
  const rows = [['day', 'sessions', 'messages', 'tokens', 'est_cost_usd']];
  for (const d of a.byDay) rows.push([d.day, d.sessions, d.messages, d.tokens, d.cost.toFixed(4)]);
  download('claudescope-by-day.csv', rows.map((r) => r.join(',')).join('\n') + '\n', 'text/csv');
}
function exportJSON(a) {
  download('claudescope-analytics.json', JSON.stringify(a, null, 2), 'application/json');
}
function exportMarkdown(a) {
  const t = a.totals;
  const md =
    `# My Claude Code usage\n\n` +
    `- **Sessions:** ${fmt.int(t.sessions)}\n- **Messages:** ${fmt.int(t.messages)}\n- **Tokens:** ${fmt.int(t.tokens)}\n` +
    `- **Est. API-equivalent cost:** ${fmt.money(t.cost)}\n- **Saved by caching:** ${fmt.money(t.cacheSavings)} (${fmt.pct(t.cacheHitRate)} hit rate)\n\n` +
    `## By model\n\n| Model | Cost | Tokens | Replies |\n|---|--:|--:|--:|\n` +
    a.byModel.map((m) => `| ${modelShort(m.model)} | ${fmt.money(m.cost)} | ${fmt.int(m.tokens)} | ${fmt.int(m.messages)} |`).join('\n') +
    `\n\n## Top projects\n\n| Project | Cost |\n|---|--:|\n` +
    a.byProject.slice(0, 10).map((p) => `| ${p.label} | ${fmt.money(p.cost)} |`).join('\n') +
    `\n\n_Generated locally by 🔭 ClaudeScope · npx claudescope-cli_\n`;
  download('claudescope-summary.md', md, 'text/markdown');
}

const RANGE_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' };
function exportHtmlReport(a) {
  const html = buildReportHtml(a, { fmt, escapeHtml }, {
    rangeLabel: RANGE_LABELS[STATE.range] || 'All time',
    apiMode: apiMode(),
    generatedAt: a.generatedAt,
  });
  download('claudescope-report.html', html, 'text/html;charset=utf-8');
}

// ---------- settings popover + Anthropic usage connector ----------
function setupSettings() {
  const btn = $('#settingsBtn');
  const menu = $('#settingsMenu');
  const toggle = $('#apiModeToggle');
  if (!btn || !menu || !toggle) return;
  toggle.checked = apiMode();
  const syncExpanded = () => btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  const closeMenu = (restoreFocus) => {
    if (menu.hidden) return;
    menu.hidden = true;
    syncExpanded();
    if (restoreFocus) btn.focus();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    syncExpanded();
    if (!menu.hidden) toggle.focus();
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => closeMenu(false));
  // Esc closes the popover and returns focus to the gear (WCAG 2.1.2 / no trap).
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu(true);
    }
  });
  toggle.addEventListener('change', () => {
    setApiMode(toggle.checked);
    if (STATE.analytics) renderCards(STATE.analytics);
    renderDisclaimer();
    if (STATE.range !== 'all') loadDiff(STATE.range); // re-attach badges after card re-render
  });

  const usageBtn = $('#anthropicUsageBtn');
  const usageOut = $('#anthropicUsageOut');
  if (usageBtn && usageOut) {
    usageBtn.addEventListener('click', async () => {
      usageOut.hidden = false;
      usageOut.textContent = 'Contacting Anthropic…';
      try {
        const res = await fetch('/api/anthropic-usage?days=30').then((r) => r.json());
        if (res.error) {
          usageOut.innerHTML =
            `<span class="muted">${escapeHtml(res.error)}</span>`;
          return;
        }
        const billed = res.totalCost != null ? res.totalCost : res.cost;
        usageOut.innerHTML = billed != null
          ? `Real billed (last 30d): <b>${fmt.money(billed)}</b>`
          : `<span class="muted">Received usage data — no cost total in response.</span>`;
      } catch {
        usageOut.innerHTML = '<span class="muted">Request failed. This feature is opt-in and off by default.</span>';
      }
    });
  }
}

// ---------- wrapped share card (anonymized, 100% client-side) ----------
function shareStats(a) {
  const t = a.totals;
  const u = t.usage || {};
  const totalTok = (u.input || 0) + (u.output || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0) || 1;
  // Busiest weekday/hour from the heatmap.
  let best = -1, bd = 0, bh = 0;
  if (Array.isArray(a.heatmap)) {
    for (let d = 0; d < a.heatmap.length; d++)
      for (let h = 0; h < (a.heatmap[d] || []).length; h++)
        if (a.heatmap[d][h] > best) { best = a.heatmap[d][h]; bd = d; bh = h; }
  }
  return {
    sessions: t.sessions,
    tokens: t.tokens,
    cost: t.cost,
    cacheSavings: t.cacheSavings,
    mix: {
      cacheRead: (u.cacheRead || 0) / totalTok,
      cacheWrite: (u.cacheWrite || 0) / totalTok,
      input: (u.input || 0) / totalTok,
      output: (u.output || 0) / totalTok,
    },
    topTools: (a.byTool || []).slice(0, 4).map((x) => x.tool),
    busiest: best > 0 ? `${DAYFULL[bd]} · ${fmtHour(bh)}` : null,
    archetype: a.archetype || null,
    percentile: t.percentile || null,
  };
}
function drawShareCard(a) {
  const canvas = $('#shareCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 1200, H = 630;
  const s = shareStats(a);
  // Background — dark theme matching the app.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#16181f');
  g.addColorStop(1, '#0e0f13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Accent glow corners.
  const glow = ctx.createRadialGradient(120, 60, 0, 120, 60, 520);
  glow.addColorStop(0, 'rgba(217,119,87,0.18)');
  glow.addColorStop(1, 'rgba(217,119,87,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // Header.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e7e9ee';
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText('🔭 My Claude Code, wrapped', 64, 96);
  if (s.archetype) {
    ctx.fillStyle = '#d97757';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(`${s.archetype.emoji || ''} ${s.archetype.name || ''}`, 64, 138);
  }

  // Big stats row.
  const stats = [
    [fmtCompact(s.sessions), 'sessions'],
    [fmtCompact(s.tokens), 'tokens'],
    [s.cost > 0 ? fmt.money(s.cost) : fmt.money(s.cacheSavings), s.cost > 0 ? 'est. API cost' : 'saved by cache'],
  ];
  let x = 64;
  for (const [v, k] of stats) {
    ctx.fillStyle = '#e7e9ee';
    ctx.font = `800 58px ${FONT}`;
    ctx.fillText(v, x, 240);
    ctx.fillStyle = '#9aa3b2';
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(k, x, 274);
    x += 360;
  }

  // Token-mix split bar.
  const mixY = 330, mixH = 26, mixW = W - 128;
  const segs = [
    ['cacheRead', s.mix.cacheRead, '#4ade80'],
    ['cacheWrite', s.mix.cacheWrite, '#b18cf0'],
    ['input', s.mix.input, '#36c5d0'],
    ['output', s.mix.output, '#d97757'],
  ];
  let mx = 64;
  for (const [, frac, color] of segs) {
    const w = Math.max(0, frac * mixW);
    ctx.fillStyle = color;
    ctx.fillRect(mx, mixY, w, mixH);
    mx += w;
  }
  ctx.fillStyle = '#8d96a6';
  ctx.font = `500 20px ${FONT}`;
  const mixLabel = segs
    .map(([name, frac]) => `${name} ${Math.round(frac * 100)}%`)
    .join('   ·   ');
  ctx.fillText('Token mix:  ' + mixLabel, 64, mixY + mixH + 34);

  // Bottom detail rows.
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = '#e7e9ee';
  let by = 470;
  if (s.busiest) {
    ctx.fillText(`⏰ Busiest: ${s.busiest}`, 64, by);
    by += 42;
  }
  if (s.topTools.length) {
    ctx.fillText(`🛠 Top tools: ${s.topTools.join(', ')}`, 64, by);
    by += 42;
  }
  if (s.percentile && s.percentile.label) {
    ctx.fillStyle = '#d97757';
    ctx.fillText(`🔭 Est. ${s.percentile.label} of token users (rough heuristic)`, 64, by);
  }

  // Footer watermark.
  ctx.fillStyle = '#8d96a6';
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText('🔭 ClaudeScope · npx claudescope-cli', 64, H - 44);
}
function fmtCompact(n) {
  return fmt.num(n);
}
function shareCaption(a) {
  const s = shareStats(a);
  const arc = s.archetype ? `${s.archetype.emoji || ''} ${s.archetype.name || ''} — ` : '';
  const money = s.cost > 0 ? `~${fmt.money(s.cost)} in est. API value` : `${fmt.money(s.cacheSavings)} saved by cache`;
  const pct = s.percentile && s.percentile.label ? `🔭 Est. ${s.percentile.label} of token users (rough offline heuristic, not measured).\n` : '';
  return (
    `${arc}my Claude Code, wrapped:\n` +
    `${fmt.int(s.sessions)} sessions · ${fmt.num(s.tokens)} tokens · ${money}.\n` +
    pct +
    `See yours locally → npx claudescope-cli  🔭`
  );
}
function setupShare() {
  const btn = $('#shareBtn');
  const modal = $('#shareModal');
  if (!btn || !modal) return;
  btn.addEventListener('click', () => {
    if (!STATE.analytics) return;
    drawShareCard(STATE.analytics);
    const tweet = $('#shareTweet');
    if (tweet) tweet.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareCaption(STATE.analytics));
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    focusModal(modal);
  });
  modal.addEventListener('keydown', (e) => trapFocus(e, modal));
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) {
      modal.hidden = true;
      document.body.style.overflow = '';
      restoreFocus();
    }
  });
  const dl = $('#shareDownload');
  if (dl) {
    dl.addEventListener('click', () => {
      const canvas = $('#shareCanvas');
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = el('a');
        a.href = url;
        a.download = 'claudescope-wrapped.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    });
  }
  const copy = $('#shareCopy');
  if (copy) {
    copy.addEventListener('click', async () => {
      if (!STATE.analytics) return;
      const text = shareCaption(STATE.analytics);
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = '✓ Copied';
        setTimeout(() => (copy.textContent = '📋 Copy post text'), 1500);
      } catch {
        copy.textContent = '📋 Copy failed';
        setTimeout(() => (copy.textContent = '📋 Copy post text'), 1500);
      }
    });
  }
}

// ---------- skeleton / loading ----------
function renderSkeleton() {
  const cards = $('#cards');
  if (cards) cards.innerHTML = Array.from({ length: 6 }, () => '<div class="card"><div class="sk sk-line" style="width:50%"></div><div class="sk sk-line" style="width:70%;height:22px;margin-top:10px"></div><div class="sk sk-line" style="width:60%;margin-top:8px"></div></div>').join('');
  for (const id of ['projects', 'models', 'tools']) {
    const c = $('#' + id);
    if (c) c.innerHTML = Array.from({ length: 5 }, () => '<div class="sk sk-bar"></div>').join('');
  }
}

// ---------- source filter (multi-CLI) ----------
// Only shown when MORE THAN ONE agent CLI is detected. With just Claude Code
// present the bar stays hidden and the UI is identical to before.
const SOURCE_META = {
  'claude-code': { label: 'Claude Code', emoji: '🔭', color: '#d97757' },
  codex: { label: 'OpenAI Codex', emoji: '🟢', color: '#10a37f' },
  cursor: { label: 'Cursor', emoji: '▮', color: '#9aa3b2' },
  aider: { label: 'Aider', emoji: '🟣', color: '#b18cf0' },
  gemini: { label: 'Gemini CLI', emoji: '✦', color: '#4f8cff' },
  copilot: { label: 'GitHub Copilot', emoji: '🐙', color: '#36c5d0' },
};
function sourceMeta(id) {
  return SOURCE_META[id] || { label: id, emoji: '•', color: '#8d96a6' };
}
function renderSourceBar(sources) {
  const bar = $('#sourceBar');
  if (!bar) return;
  const list = Array.isArray(sources) ? sources : [];
  // Single source (or none) → keep the dashboard exactly as it was.
  if (list.length <= 1) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  STATE.sources = list;
  const chips = [{ id: null, sessions: list.reduce((n, s) => n + (s.sessions || 0), 0) }, ...list];
  bar.innerHTML = chips
    .map((s) => {
      const active = (STATE.source || null) === (s.id || null);
      if (!s.id) {
        return `<button type="button" class="src-chip${active ? ' active' : ''}" data-source="">All sources <small>${fmt.int(s.sessions)}</small></button>`;
      }
      const m = sourceMeta(s.id);
      return `<button type="button" class="src-chip${active ? ' active' : ''}" data-source="${escapeHtml(s.id)}">` +
        `<span class="src-dot" style="background:${m.color}"></span>${escapeHtml(m.label)} <small>${fmt.int(s.sessions)}</small></button>`;
    })
    .join('');
}
function setupSourceBar() {
  const bar = $('#sourceBar');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-source]');
    if (!b) return;
    const next = b.dataset.source || null;
    if ((STATE.source || null) === next) return;
    STATE.source = next;
    renderSourceBar(STATE.sources);
    loadRange(STATE.range);
  });
}

// ---------- controller ----------
const STATE = { range: 'all', analytics: null, source: null, sources: [] };

function renderAll(a) {
  STATE.analytics = a;
  renderInsights(a);
  renderArchetype(a);
  renderPercentile(a);
  renderCards(a);
  renderTypical(a);
  renderTokenMix(a);
  renderProjects(a);
  renderModels(a);
  renderTools(a);
  renderTimeline(a);
  renderHeatmap(a);
  renderSessions(a);
}

async function loadRange(range) {
  STATE.range = range;
  document.querySelectorAll('#rangeBar button').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
  const srcParam = STATE.source ? '&source=' + encodeURIComponent(STATE.source) : '';
  const a = await fetch('/api/analytics?range=' + encodeURIComponent(range) + srcParam).then((r) => r.json());
  if (!a.totals || a.totals.sessions === 0) {
    if (range === 'all') return renderEmptyState();
    // empty range — show zeros but keep the bar usable
  }
  renderAll(a);
  loadDiff(range);
}

function setupControls() {
  const bar = $('#rangeBar');
  if (bar) {
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-range]');
      if (b) loadRange(b.dataset.range);
    });
  }
  document.querySelectorAll('#tlToggle button').forEach((b) =>
    b.addEventListener('click', () => {
      timelineMetric = b.dataset.metric;
      document.querySelectorAll('#tlToggle button').forEach((x) => x.classList.toggle('active', x === b));
      if (STATE.analytics) renderTimeline(STATE.analytics);
    })
  );
  const exp = $('#exportBtn');
  const menu = $('#exportMenu');
  if (exp && menu) {
    exp.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', () => (menu.hidden = true));
    menu.addEventListener('click', (e) => {
      const fmtType = e.target.dataset.export;
      if (!fmtType || !STATE.analytics) return;
      if (fmtType === 'json') exportJSON(STATE.analytics);
      if (fmtType === 'csv') exportCSV(STATE.analytics);
      if (fmtType === 'md') exportMarkdown(STATE.analytics);
      if (fmtType === 'html') exportHtmlReport(STATE.analytics);
      menu.hidden = true;
    });
  }
}

function renderEmptyState() {
  document.querySelector('main').innerHTML =
    `<div class="panel empty-first"><div class="empty-logo">🔭</div><h2>No Claude Code sessions found yet</h2>` +
    `<p>ClaudeScope didn't find any transcripts under your <code>~/.claude/projects</code> folder. Run a Claude Code session, then refresh — your analytics will appear here.</p></div>`;
}

async function boot() {
  renderSkeleton();
  const [a, meta] = await Promise.all([
    fetch('/api/analytics').then((r) => r.json()),
    fetch('/api/meta').then((r) => r.json()),
  ]);
  if (!a.totals || a.totals.sessions === 0) {
    renderMeta(a, meta);
    return renderEmptyState();
  }
  renderMeta(a, meta);
  renderSourceBar(meta.sources);
  renderAll(a);
  setupSearch();
  setupControls();
  setupSourceBar();
  setupModal();
  setupSettings();
  setupShare();
  loadMomentum();
}

boot().catch((e) => {
  const main = document.querySelector('main');
  main.setAttribute('role', 'alert');
  main.innerHTML = `<div class="panel"><h2>Couldn't load data</h2><p class="muted">${escapeHtml(e.message)}</p></div>`;
});
