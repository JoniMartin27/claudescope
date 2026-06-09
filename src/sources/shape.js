// Shared normalized-shape helpers for ClaudeScope source adapters.
//
// Every adapter (Claude Code + the experimental ones) emits sessions and
// messages in the SAME normalized shape the original parser.js produces, plus
// a `source` tag. Centralizing the factory here means a non-claude adapter
// can't accidentally drift from the canonical field set the analytics layer
// and frontend expect.
//
// A "session" is the object buildAnalytics() consumes; a "message" is the
// lightweight, lowercased record search() scans. See src/parser.js for the
// authoritative Claude Code producer (it builds these inline for byte-identical
// backwards compatibility); newSession/newMessage here are for the OTHER CLIs.

const SEARCH_MAX = 4000; // chars of each message indexed (bounds index memory)
const SNIPPET = 280;

export function emptyUsage() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

/** A fresh normalized session with every field buildAnalytics() reads. */
export function newSession({ sessionId, source, projectLabel, projectPath, project, file }) {
  return {
    sessionId,
    source,
    project: project ?? projectPath ?? projectLabel ?? 'unknown',
    projectLabel: projectLabel ?? 'unknown',
    projectPath: projectPath ?? null,
    file: file ?? null,
    firstTs: null,
    lastTs: null,
    version: null,
    gitBranch: null,
    cwd: null,
    userType: null,
    entrypoint: null,
    messageCount: 0,
    userMsgs: 0,
    assistantMsgs: 0,
    models: {},
    modelUsage: {}, // model -> { messages, usage{}, cost }
    tools: {},
    usage: emptyUsage(),
    cost: 0,
    title: null,
    heat: {}, // (weekday*24+hour) -> assistant-message count
    interrupted: 0,
  };
}

/** Track first/last timestamp on a session from an ISO string. */
export function touchTs(session, ts) {
  if (!ts) return;
  if (!session.firstTs || ts < session.firstTs) session.firstTs = ts;
  if (!session.lastTs || ts > session.lastTs) session.lastTs = ts;
}

/** Bump the local weekday×hour heat bucket for an assistant reply. */
export function bumpHeat(session, ts) {
  if (!ts) return;
  const dt = new Date(ts);
  if (isNaN(dt)) return;
  const bucket = dt.getDay() * 24 + dt.getHours();
  session.heat[bucket] = (session.heat[bucket] || 0) + 1;
}

/**
 * Build a normalized search/message record. `text` is the raw, human-readable
 * message text; it's lowercased + capped here exactly like parser.js does.
 */
export function newMessage({ sessionId, source, projectLabel, ts, role, text }) {
  const lc = (text.length > SEARCH_MAX ? text.slice(0, SEARCH_MAX) : text).toLowerCase();
  return {
    sessionId,
    source,
    project: projectLabel,
    projectLabel,
    ts,
    role,
    lc,
    snippet: text.replace(/\s+/g, ' ').slice(0, SNIPPET),
  };
}
