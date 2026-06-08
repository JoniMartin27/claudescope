import { costForUsage } from './pricing.js';

function usageTokens(u) {
  return (u.input || 0) + (u.output || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0);
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
  return ts ? ts.slice(0, 10) : null; // YYYY-MM-DD
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

    // by project
    if (!byProject.has(s.projectLabel)) {
      byProject.set(s.projectLabel, {
        label: s.projectLabel,
        path: s.projectPath,
        sessions: 0,
        messages: 0,
        cost: 0,
        usage: newUsage(),
      });
    }
    const p = byProject.get(s.projectLabel);
    p.sessions++;
    p.messages += s.messageCount;
    p.cost += s.cost;
    mergeUsage(p.usage, s.usage);

    // by model
    for (const [model, count] of Object.entries(s.models)) {
      if (!byModel.has(model)) byModel.set(model, { model, messages: 0, sessions: 0 });
      const m = byModel.get(model);
      m.messages += count;
      m.sessions++;
    }

    // by tool
    for (const [tool, count] of Object.entries(s.tools)) {
      byTool.set(tool, (byTool.get(tool) || 0) + count);
      totals.tools += count;
    }

    // by version
    if (s.version) byVersion.set(s.version, (byVersion.get(s.version) || 0) + 1);

    // by day (use lastTs as session day anchor for cost; messages spread on firstTs)
    const dk = dayKey(s.firstTs);
    if (dk) {
      if (!byDay.has(dk)) byDay.set(dk, { day: dk, sessions: 0, messages: 0, cost: 0 });
      const d = byDay.get(dk);
      d.sessions++;
      d.messages += s.messageCount;
      d.cost += s.cost;
    }

    // heatmap from firstTs (cheap, per-session)
    if (s.firstTs) {
      const dt = new Date(s.firstTs);
      if (!isNaN(dt)) {
        const wd = dt.getDay();
        const hr = dt.getHours();
        heatmap[wd][hr] += s.assistantMsgs || 1;
      }
    }
  }

  const sortByCost = (a, b) => b.cost - a.cost;

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
      models: Object.keys(s.models),
      topTools: Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 5),
      version: s.version,
      gitBranch: s.gitBranch,
    }))
    .sort(sortByCost);

  return {
    generatedAt: new Date().toISOString(),
    totals: { ...totals, tokens: usageTokens(totals.usage) },
    byProject: [...byProject.values()].map((p) => ({ ...p, tokens: usageTokens(p.usage) })).sort(sortByCost),
    byModel: [...byModel.values()].sort((a, b) => b.messages - a.messages),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byTool: [...byTool.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count),
    byVersion: [...byVersion.entries()].map(([version, sessions]) => ({ version, sessions })).sort((a, b) => b.sessions - a.sessions),
    heatmap,
    sessions: topSessions,
  };
}

/** Simple case-insensitive full-text search across message records. */
export function search(messages, query, limit = 100) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const results = [];
  for (const m of messages) {
    const hay = m.text.toLowerCase();
    if (terms.every((t) => hay.includes(t))) {
      results.push({
        sessionId: m.sessionId,
        project: m.projectLabel,
        ts: m.ts,
        role: m.role,
        snippet: m.snippet,
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}
