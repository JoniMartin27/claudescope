import { priceForModel, CACHE_READ_MULT } from './pricing.js';
import { classifyArchetype } from './archetype.js';
import { buildInsights } from './insights.js';
import { topPercent } from './percentile.js';

function usageTokens(u) {
  return (u.input || 0) + (u.output || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0);
}

/** Linear-interpolated quantile of a numeric array (unsorted ok). */
function quantile(values, q) {
  const a = values.filter((v) => typeof v === 'number' && !isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sessionDurationMs(s) {
  if (!s.firstTs || !s.lastTs) return null;
  const a = new Date(s.firstTs).getTime();
  const b = new Date(s.lastTs).getTime();
  return isNaN(a) || isNaN(b) || b < a ? null : b - a;
}

function mergeUsage(a, b) {
  a.input += b.input || 0;
  a.output += b.output || 0;
  a.cacheWrite += b.cacheWrite || 0;
  a.cacheRead += b.cacheRead || 0;
}

function newUsage() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function dayKey(ts) {
  // Local-time YYYY-MM-DD so the timeline agrees with the local-time heatmap
  // (slicing the ISO string would bucket in UTC and disagree near midnight).
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build the full dashboard payload from parsed sessions.
 */
export function buildAnalytics(sessions) {
  const totals = {
    sessions: sessions.length,
    messages: 0,
    userMsgs: 0,
    assistantMsgs: 0,
    usage: newUsage(),
    cost: 0,
    tools: 0,
    firstTs: null,
    lastTs: null,
  };

  const byProject = new Map();
  const bySource = new Map();
  const byModel = new Map();
  const byDay = new Map();
  const byTool = new Map();
  const byVersion = new Map();
  // 7 weekdays x 24 hours activity grid (counts of assistant messages)
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));

  for (const s of sessions) {
    totals.messages += s.messageCount;
    totals.userMsgs += s.userMsgs;
    totals.assistantMsgs += s.assistantMsgs;
    mergeUsage(totals.usage, s.usage);
    totals.cost += s.cost;
    if (s.firstTs && (!totals.firstTs || s.firstTs < totals.firstTs)) totals.firstTs = s.firstTs;
    if (s.lastTs && (!totals.lastTs || s.lastTs > totals.lastTs)) totals.lastTs = s.lastTs;

    // by project — key on the full project PATH (the real cwd when known),
    // not the display label. Two projects that merely share a last folder
    // segment (work/foo/api vs personal/bar/api) stay separate, while
    // different encoded folders that resolve to the same directory merge.
    const projectKey = s.projectPath || s.project || s.projectLabel;
    if (!byProject.has(projectKey)) {
      byProject.set(projectKey, {
        label: s.projectLabel,
        path: s.projectPath,
        sessions: 0,
        messages: 0,
        cost: 0,
        usage: newUsage(),
      });
    }
    const p = byProject.get(projectKey);
    p.sessions++;
    p.messages += s.messageCount;
    p.cost += s.cost;
    mergeUsage(p.usage, s.usage);

    // by source (which agent CLI the session came from). Defaults to
    // claude-code so legacy parses with no source tag still bucket correctly.
    const src = s.source || 'claude-code';
    if (!bySource.has(src)) {
      bySource.set(src, { source: src, sessions: 0, messages: 0, cost: 0, usage: newUsage() });
    }
    const sc = bySource.get(src);
    sc.sessions++;
    sc.messages += s.messageCount;
    sc.cost += s.cost;
    mergeUsage(sc.usage, s.usage);

    // by model (messages + sessions + per-model tokens & cost)
    for (const [model, count] of Object.entries(s.models)) {
      if (!byModel.has(model)) {
        byModel.set(model, { model, messages: 0, sessions: 0, usage: newUsage(), cost: 0 });
      }
      const m = byModel.get(model);
      m.messages += count;
      m.sessions++;
      const mu = s.modelUsage[model];
      if (mu) {
        mergeUsage(m.usage, mu.usage);
        m.cost += mu.cost;
      }
    }

    // by tool
    for (const [tool, count] of Object.entries(s.tools)) {
      byTool.set(tool, (byTool.get(tool) || 0) + count);
      totals.tools += count;
    }

    // by version
    if (s.version) byVersion.set(s.version, (byVersion.get(s.version) || 0) + 1);

    // by day: the whole session's cost + message count are bucketed on its
    // first-message local day. (Per-reply day-splitting like the heatmap does
    // is possible but unnecessary here — sessions rarely cross midnight.)
    const dk = dayKey(s.firstTs);
    if (dk) {
      if (!byDay.has(dk)) byDay.set(dk, { day: dk, sessions: 0, messages: 0, cost: 0, usage: newUsage() });
      const d = byDay.get(dk);
      d.sessions++;
      d.messages += s.messageCount;
      d.cost += s.cost;
      mergeUsage(d.usage, s.usage);
    }

    // heatmap: sum each reply at its OWN weekday×hour (built in the parser),
    // so a long session spreads across the hours it actually spanned.
    for (const [bucket, count] of Object.entries(s.heat)) {
      const b = +bucket;
      heatmap[Math.floor(b / 24)][b % 24] += count;
    }
  }

  const sortByCost = (a, b) => b.cost - a.cost;

  // ---- derived totals: cache efficiency, savings, per-session distribution ----
  const cr = totals.usage.cacheRead;
  const inp = totals.usage.input;
  totals.cacheHitRate = cr + inp > 0 ? cr / (cr + inp) : 0;
  // $ saved by cache reads vs paying full input rate, priced per model.
  let cacheSavings = 0;
  for (const m of byModel.values()) {
    const price = priceForModel(m.model);
    if (price) cacheSavings += (m.usage.cacheRead * price.input * (1 - CACHE_READ_MULT)) / 1_000_000;
  }
  totals.cacheSavings = cacheSavings;

  const costs = sessions.map((s) => s.cost);
  const msgCounts = sessions.map((s) => s.messageCount);
  const durations = sessions.map(sessionDurationMs).filter((d) => d != null);
  totals.interruptedSessions = sessions.filter((s) => (s.interrupted || 0) > 0).length;
  totals.perSession = {
    avgCost: mean(costs),
    medianCost: quantile(costs, 0.5),
    p90Cost: quantile(costs, 0.9),
    avgMessages: mean(msgCounts),
    medianMessages: quantile(msgCounts, 0.5),
    medianDurationMs: quantile(durations, 0.5),
    avgDurationMs: mean(durations),
  };

  // Top sessions by cost
  const topSessions = [...sessions]
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title || '(no prompt captured)',
      project: s.projectLabel,
      cost: s.cost,
      messages: s.messageCount,
      tokens: usageTokens(s.usage),
      firstTs: s.firstTs,
      lastTs: s.lastTs,
      durationMs: sessionDurationMs(s),
      interrupted: s.interrupted || 0,
      models: Object.keys(s.models),
      topTools: Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 5),
      version: s.version,
      gitBranch: s.gitBranch,
    }))
    .sort(sortByCost);

  const result = {
    generatedAt: new Date().toISOString(),
    totals: { ...totals, tokens: usageTokens(totals.usage) },
    byProject: [...byProject.values()].map((p) => ({ ...p, tokens: usageTokens(p.usage) })).sort(sortByCost),
    bySource: [...bySource.values()]
      .map((sc) => ({ source: sc.source, sessions: sc.sessions, messages: sc.messages, cost: sc.cost, tokens: usageTokens(sc.usage) }))
      .sort((a, b) => b.sessions - a.sessions),
    byModel: [...byModel.values()]
      .map((m) => ({ ...m, tokens: usageTokens(m.usage) }))
      .sort((a, b) => b.cost - a.cost),
    byDay: [...byDay.values()]
      .map((d) => ({ day: d.day, sessions: d.sessions, messages: d.messages, cost: d.cost, tokens: usageTokens(d.usage) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byTool: [...byTool.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count),
    byVersion: [...byVersion.entries()].map(([version, sessions]) => ({ version, sessions })).sort((a, b) => b.sessions - a.sessions),
    heatmap,
    sessions: topSessions,
  };

  // Offline percentile badge — needs the shaped totals (tokens + first/lastTs).
  result.totals.percentile = topPercent(result);

  // Derived, purely-local extras computed from the shaped payload above.
  result.archetype = classifyArchetype(result);
  result.insights = buildInsights(result);

  return result;
}

/** Local-time YYYY-MM-DD for a Date (matches the byDay/heatmap bucketing). */
function localDayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Percent change from `prev` to `cur`; null when prev is 0 (no baseline). */
export function deltaPct(cur, prev) {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

/**
 * Week-over-week momentum from a built analytics payload. Sums the last 7 local
 * days (today .. -6) into `thisWeek` and the 7 days before that into `lastWeek`,
 * reading the same byDay rows the dashboard renders, then computes per-metric
 * percent deltas. This is the single source of truth shared by the server's
 * /api/momentum endpoint and the --weekly CLI digest (no duplicated window math).
 * `now` is injectable so tests are deterministic.
 */
export function weekOverWeek(analytics, now = new Date()) {
  const byDay = (analytics && analytics.byDay) || [];
  const byDayMap = new Map(byDay.map((d) => [d.day, d]));
  const sumWindow = (startOffset) => {
    const acc = { cost: 0, tokens: 0, sessions: 0 };
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() - startOffset - i);
      const row = byDayMap.get(localDayKey(d));
      if (row) {
        acc.cost += row.cost || 0;
        acc.tokens += row.tokens || 0;
        acc.sessions += row.sessions || 0;
      }
    }
    return acc;
  };
  const thisWeek = sumWindow(0);
  const lastWeek = sumWindow(7);
  return {
    thisWeek,
    lastWeek,
    deltaPct: {
      cost: deltaPct(thisWeek.cost, lastWeek.cost),
      tokens: deltaPct(thisWeek.tokens, lastWeek.tokens),
      sessions: deltaPct(thisWeek.sessions, lastWeek.sessions),
    },
  };
}

/**
 * Case-insensitive full-text search across message records.
 * opts: { limit, role: 'user'|'assistant', project, regex } — all optional.
 * When opts.regex is true the (trimmed) query is compiled to a case-insensitive
 * RegExp and matched against each message's lowercased haystack; an invalid
 * pattern is caught and reported as { results:[], total:0, truncated:false,
 * error:'bad regex' } rather than thrown. Otherwise it's a space-separated
 * AND-of-substrings match.
 * Returns { results, total, truncated } (+ optional error) so the UI can show
 * "N+ / showing M".
 */
export function search(messages, query, opts = {}) {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 100;
  const role = opts.role === 'user' || opts.role === 'assistant' ? opts.role : null;
  const project = opts.project ? String(opts.project).toLowerCase() : null;
  const source = opts.source ? String(opts.source).toLowerCase() : null;
  const raw = (query || '').trim();
  if (!raw) return { results: [], total: 0, truncated: false };
  const q = raw.toLowerCase();

  // Build the matcher up front. In regex mode a bad pattern short-circuits to
  // the documented error shape so callers never have to wrap search() in try.
  let re = null;
  let terms = null;
  if (opts.regex) {
    try {
      re = new RegExp(q, 'i');
    } catch {
      return { results: [], total: 0, truncated: false, error: 'bad regex' };
    }
  } else {
    terms = q.split(/\s+/);
  }
  const matches = re ? (lc) => re.test(lc) : (lc) => terms.every((t) => lc.includes(t));

  const results = [];
  let total = 0;
  for (const m of messages) {
    if (role && m.role !== role) continue;
    if (project && (m.projectLabel || '').toLowerCase() !== project) continue;
    if (source && (m.source || 'claude-code').toLowerCase() !== source) continue;
    if (matches(m.lc)) {
      total++;
      if (results.length < limit) {
        results.push({
          sessionId: m.sessionId,
          source: m.source || 'claude-code',
          project: m.projectLabel,
          ts: m.ts,
          role: m.role,
          snippet: m.snippet,
        });
      }
    }
  }
  return { results, total, truncated: total > results.length };
}
