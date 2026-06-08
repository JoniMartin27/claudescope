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

function renderModels(a) {
  bars(
    'models',
    a.byModel.slice(0, 8).map((m) => ({
      label: m.model.replace('claude-', ''),
      value: m.messages,
      display: fmt.num(m.messages),
    })),
    { color2: true }
  );
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
  const svg = `<svg width="120" height="120" viewBox="0 0 120 120">${circles}
    <text x="${C}" y="${C - 2}" text-anchor="middle" fill="#e7e9ee" font-size="17" font-weight="700">${fmt.num(total)}</text>
    <text x="${C}" y="${C + 14}" text-anchor="middle" fill="#6b7280" font-size="9">tokens</text></svg>`;
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
    bar.dataset.tip = `${d.day} · ${fmt.money(d.cost)} · ${d.sessions} sessions`;
    c.appendChild(bar);
  }
  const axis = el('div', 'tl-axis');
  axis.innerHTML = `<span>${slice[0].day}</span><span>${slice[slice.length - 1].day}</span>`;
  c.parentElement.querySelector('.tl-axis')?.remove();
  c.after(axis);
}

const DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function renderHeatmap(a) {
  const c = $('#heatmap');
  c.innerHTML = '';
  let max = 1;
  for (const row of a.heatmap) for (const v of row) if (v > max) max = v;
  // header row
  c.appendChild(el('div', 'hm-lbl', ''));
  for (let h = 0; h < 24; h++) c.appendChild(el('div', 'hm-hour', h % 3 === 0 ? h : ''));
  for (let d = 0; d < 7; d++) {
    c.appendChild(el('div', 'hm-lbl', DAYNAMES[d]));
    for (let h = 0; h < 24; h++) {
      const v = a.heatmap[d][h];
      const cell = el('div', 'hm-cell');
      if (v > 0) {
        const alpha = 0.15 + 0.85 * (v / max);
        cell.style.background = `rgba(217,119,87,${alpha.toFixed(2)})`;
        cell.title = `${DAYNAMES[d]} ${h}:00 — ${v}`;
      }
      c.appendChild(cell);
    }
  }
}

function renderSessions(a) {
  const c = $('#sessions');
  c.innerHTML = '';
  for (const s of a.sessions.slice(0, 12)) {
    const row = el('div', 'session');
    const left = el('div');
    left.appendChild(el('div', 's-title', escapeHtml(s.title)));
    const tools = s.topTools.map((t) => `<span class="pill">${t[0]} ${t[1]}</span>`).join(' ');
    left.appendChild(
      el(
        'div',
        's-sub',
        `<span>${s.project}</span><span>${fmt.date(s.firstTs)}</span><span>${fmt.num(s.tokens)} tok</span>${tools}`
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
  for (const r of res.slice(0, 40)) {
    const row = el('div', 'result');
    row.appendChild(
      el(
        'div',
        'r-head',
        `<span class="tag ${r.role}">${r.role}</span><span class="r-proj">${r.project}</span><span class="r-proj">${fmt.date(r.ts)}</span>`
      )
    );
    row.appendChild(el('div', 'r-text', highlight(escapeHtml(r.snippet), q)));
    c.appendChild(row);
  }
}

function highlight(text, q) {
  for (const term of q.split(/\s+/)) {
    if (term.length < 2) continue;
    const re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    text = text.replace(re, '<mark style="background:rgba(217,119,87,.35);color:#fff;border-radius:3px">$1</mark>');
  }
  return text;
}

// ---------- boot ----------
async function boot() {
  const [a, meta] = await Promise.all([
    fetch('/api/analytics').then((r) => r.json()),
    fetch('/api/meta').then((r) => r.json()),
  ]);
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
  document.querySelector('main').innerHTML =
    `<div class="panel"><h2>Couldn't load data</h2><p style="color:#9aa3b2">${e.message}</p></div>`;
});
