import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseAll, readConversation } from './parser.js';
import { buildAnalytics, search } from './analytics.js';
import { projectsDir } from './paths.js';
import { recordSnapshot, readSnapshots, computeStreak } from './snapshots.js';
import { fetchAnthropicCost } from './anthropic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra) {
  res.writeHead(status, { 'Content-Type': type, ...(extra || {}) });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj));
}

const RANGES = { '7d': 7, '30d': 30, '90d': 90 };

/** Local-time YYYY-MM-DD for a Date (defaults to now). */
function localDayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Percent change from `prev` to `cur`, null when prev is 0 (no baseline). */
function deltaPct(cur, prev) {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Boundary-aware check: a bare startsWith would also accept a sibling dir
  // sharing the prefix (e.g. "public-secret/"). Require an exact match or a
  // real path separator after the public root.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
}

export async function createServer(claudeDir, { onLog, host } = {}) {
  const log = onLog || (() => {});
  const bindHost = host || '127.0.0.1';
  log('Scanning transcripts…');
  const t0 = Date.now();
  const { sessions, messages } = await parseAll(claudeDir);
  log(`Parsed ${sessions.length} sessions, ${messages.length} messages in ${Date.now() - t0}ms`);

  // Window helpers for the momentum/diff endpoints: filter sessions to the
  // last N local days (offset N days back so we can compare against the
  // preceding window) and build analytics over just that slice.
  function sessionsInWindow(days, offsetDays = 0) {
    const ms = 86400000;
    const until = Date.now() - offsetDays * days * ms;
    const since = until - days * ms;
    return sessions.filter((s) => {
      if (!s.lastTs) return false;
      const t = new Date(s.lastTs).getTime();
      return !isNaN(t) && t >= since && t < until;
    });
  }
  function totalsForWindow(days, offsetDays = 0) {
    const a = buildAnalytics(sessionsInWindow(days, offsetDays));
    const t = a.totals;
    return { cost: t.cost, tokens: t.tokens, sessions: t.sessions, messages: t.messages };
  }

  // Map sessionId -> transcript file so the detail view can re-read on demand.
  const sessionIndex = new Map();
  for (const s of sessions) {
    if (!sessionIndex.has(s.sessionId)) sessionIndex.set(s.sessionId, { project: s.project, file: s.file });
  }

  // Cache the serialized analytics payload per range (cheap rebuild, but the
  // "all" view is requested on every load — serialize once, reuse + ETag).
  const cache = new Map(); // range -> { json, etag }
  function analyticsFor(range) {
    const key = RANGES[range] ? range : 'all';
    if (cache.has(key)) return cache.get(key);
    let subset = sessions;
    if (RANGES[key]) {
      const since = Date.now() - RANGES[key] * 86400000;
      subset = sessions.filter((s) => s.lastTs && new Date(s.lastTs).getTime() >= since);
    }
    const payload = { ...buildAnalytics(subset), range: key };
    const json = JSON.stringify(payload);
    const etag = '"' + crypto.createHash('sha1').update(json).digest('hex').slice(0, 16) + '"';
    const entry = { json, etag };
    cache.set(key, entry);
    return entry;
  }

  const server = http.createServer(async (req, res) => {
    let pathname = '/';
    let params = new URLSearchParams();
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      pathname = u.pathname;
      params = u.searchParams;
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }

    if (pathname === '/api/analytics') {
      const { json, etag } = analyticsFor(params.get('range') || 'all');
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      return send(res, 200, json, 'application/json; charset=utf-8', { ETag: etag, 'Cache-Control': 'no-cache' });
    }

    if (pathname === '/api/search') {
      const q = params.get('q') || '';
      const out = search(messages, q, {
        limit: parseInt(params.get('limit') || '100', 10),
        role: params.get('role') || undefined,
        project: params.get('project') || undefined,
        regex: params.get('regex') === '1',
      });
      return sendJson(res, 200, out);
    }

    if (pathname === '/api/session') {
      const id = params.get('id');
      const ref = id && sessionIndex.get(id);
      if (!ref) return sendJson(res, 404, { error: 'session not found' });
      const filePath = path.join(projectsDir(claudeDir), ref.project, ref.file);
      try {
        const convo = await readConversation(filePath, id);
        return sendJson(res, 200, convo);
      } catch {
        return sendJson(res, 500, { error: 'could not read session transcript' });
      }
    }

    if (pathname === '/api/meta') {
      return sendJson(res, 200, { claudeDir, sessions: sessions.length, messages: messages.length });
    }

    if (pathname === '/api/insights') {
      const all = JSON.parse(analyticsFor('all').json);
      return sendJson(res, 200, { insights: all.insights, archetype: all.archetype });
    }

    if (pathname === '/api/momentum') {
      const all = JSON.parse(analyticsFor('all').json);
      const byDay = all.byDay || [];
      const byDayMap = new Map(byDay.map((d) => [d.day, d]));
      const blank = () => ({ cost: 0, tokens: 0, sessions: 0 });
      const sumWindow = (startOffset) => {
        const acc = blank();
        for (let i = 0; i < 7; i++) {
          const d = new Date();
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
      const thisWeek = sumWindow(0); // last 7 local days (today .. -6)
      const lastWeek = sumWindow(7); // the 7 days before that
      return sendJson(res, 200, {
        streak: computeStreak(readSnapshots()),
        thisWeek,
        lastWeek,
        deltaPct: {
          cost: deltaPct(thisWeek.cost, lastWeek.cost),
          tokens: deltaPct(thisWeek.tokens, lastWeek.tokens),
          sessions: deltaPct(thisWeek.sessions, lastWeek.sessions),
        },
      });
    }

    if (pathname === '/api/diff') {
      const range = RANGES[params.get('range')] ? params.get('range') : '7d';
      const days = RANGES[range];
      const current = totalsForWindow(days, 0);
      const previous = totalsForWindow(days, 1);
      return sendJson(res, 200, {
        range,
        current,
        previous,
        deltaPct: {
          cost: deltaPct(current.cost, previous.cost),
          tokens: deltaPct(current.tokens, previous.tokens),
          sessions: deltaPct(current.sessions, previous.sessions),
          messages: deltaPct(current.messages, previous.messages),
        },
      });
    }

    // OPT-IN, off by default. The ONLY endpoint that may touch the network,
    // and only when an admin key is explicitly configured. Without a key we
    // return 400 and make ZERO network requests.
    if (pathname === '/api/anthropic-usage') {
      const key =
        process.env.ANTHROPIC_ADMIN_KEY ||
        (typeof req.headers['x-cs-admin-key'] === 'string' ? req.headers['x-cs-admin-key'] : '');
      if (!key) {
        return sendJson(res, 400, {
          error: 'No Anthropic admin key configured. Set ANTHROPIC_ADMIN_KEY to enable (opt-in, off by default).',
        });
      }
      const days = parseInt(params.get('days') || '30', 10);
      try {
        const data = await fetchAnthropicCost({ apiKey: key, days: isNaN(days) ? 30 : days });
        return sendJson(res, 200, data);
      } catch (err) {
        return sendJson(res, 502, { error: err && err.message ? err.message : 'Anthropic request failed' });
      }
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'unknown endpoint' });
    }

    return serveStatic(res, req.url || '/');
  });

  const analytics = JSON.parse(analyticsFor('all').json);

  // Record today's totals as the single, local-only persisted snapshot. This is
  // best-effort (silently no-ops on any fs error) and never reaches the network.
  recordSnapshot({
    date: localDayKey(),
    sessions: analytics.totals.sessions,
    cost: analytics.totals.cost,
    tokens: analytics.totals.tokens,
  });

  return { server, analytics, sessions, messages, analyticsFor, host: bindHost };
}
