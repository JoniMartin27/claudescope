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
    { k: 'Est. API cost', v: fmt.money(t.cost), x: 'if billed at list API rates', c: 'c4' },
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

function renderMeta(a, meta) {
  $('#meta').innerHTML =
    `<div><b>${fmt.int(meta.sessions)}</b> sessions · <b>${fmt.num(meta.messages)}</b> messages indexed</div>` +
    `<div>generated ${new Date(a.generatedAt).toLocaleString(LOCALE)}</div>`;
  $('#disclaimer').textContent =
    'Costs are estimates of what your token volume would cost on the pay-as-you-go Anthropic API at list prices — not your actual bill. ' +
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
  const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=40').then((r) => r.json());
  const total = res.total ?? res.results.length;
  $('#searchHint').textContent = `${fmt.int(total)} ${total === 1 ? 'match' : 'matches'}`;
  const c = $('#searchResults');
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
    row.appendChild(el('div', 'r-head', `<span class="tag ${role}">${role}</span><span class="r-proj">${escapeHtml(r.project)}</span><span class="r-proj">${fmt.date(r.ts)}</span><span class="r-open">open ↗</span>`));
    row.appendChild(el('div', 'r-text', highlight(escapeHtml(r.snippet), q)));
    const open = () => openSession(r.sessionId, r.snippet.slice(0, 60));
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

// ---------- session detail modal ----------
async function openSession(id, label) {
  const modal = $('#modal');
  const body = $('#modalBody');
  $('#modalTitle').textContent = label ? label : 'Session';
  body.innerHTML = '<div class="modal-loading">Loading conversation…</div>';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  try {
    const c = await fetch('/api/session?id=' + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))));
    const CAP = 600;
    const total = c.turns.length;
    const turns = total > CAP ? c.turns.slice(-CAP) : c.turns;
    const note = total > CAP ? `<div class="convo-note">Showing the most recent ${CAP} of ${fmt.int(total)} turns.</div>` : '';
    const meta = [c.cwd ? escapeHtml(c.cwd.split(/[\\/]/).pop()) : null, c.gitBranch ? '⎇ ' + escapeHtml(c.gitBranch) : null, c.version ? 'v' + escapeHtml(c.version) : null, `${fmt.int(total)} turns`].filter(Boolean).join(' · ');
    body.innerHTML = `<div class="convo-meta">${meta}</div>${note}` + turns.map(turnHtml).join('');
  } catch {
    body.innerHTML = '<div class="modal-loading">Couldn\'t load this session transcript.</div>';
  }
}
function turnHtml(t) {
  const who = t.kind === 'tool_result' ? 'tool' : t.role;
  const tools = (t.tools || []).length ? ` <span class="ct-tools">${t.tools.map((x) => escapeHtml(x)).join(' ')}</span>` : '';
  const text = t.text ? escapeHtml(t.text) : '<span class="muted">(no text)</span>';
  return `<div class="ct ct-${who}"><div class="ct-head"><span class="tag ${who === 'assistant' ? 'assistant' : who === 'user' ? 'user' : 'toolr'}">${who}</span>${t.model ? `<span class="ct-model">${escapeHtml(modelShort(t.model))}</span>` : ''}<span class="ct-ts">${fmt.dateTime(t.ts)}</span>${tools}</div><div class="ct-text">${text}</div></div>`;
}
function closeModal() {
  const m = $('#modal');
  if (m) m.hidden = true;
  document.body.style.overflow = '';
}
function setupModal() {
  const m = $('#modal');
  if (!m) return;
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !m.hidden) closeModal();
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

// ---------- skeleton / loading ----------
function renderSkeleton() {
  const cards = $('#cards');
  if (cards) cards.innerHTML = Array.from({ length: 6 }, () => '<div class="card"><div class="sk sk-line" style="width:50%"></div><div class="sk sk-line" style="width:70%;height:22px;margin-top:10px"></div><div class="sk sk-line" style="width:60%;margin-top:8px"></div></div>').join('');
  for (const id of ['projects', 'models', 'tools']) {
    const c = $('#' + id);
    if (c) c.innerHTML = Array.from({ length: 5 }, () => '<div class="sk sk-bar"></div>').join('');
  }
}

// ---------- controller ----------
const STATE = { range: 'all', analytics: null };

function renderAll(a) {
  STATE.analytics = a;
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
  const a = await fetch('/api/analytics?range=' + encodeURIComponent(range)).then((r) => r.json());
  if (!a.totals || a.totals.sessions === 0) {
    if (range === 'all') return renderEmptyState();
    // empty range — show zeros but keep the bar usable
  }
  renderAll(a);
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
  renderAll(a);
  setupSearch();
  setupControls();
  setupModal();
}

boot().catch((e) => {
  const main = document.querySelector('main');
  main.setAttribute('role', 'alert');
  main.innerHTML = `<div class="panel"><h2>Couldn't load data</h2><p class="muted">${escapeHtml(e.message)}</p></div>`;
});
