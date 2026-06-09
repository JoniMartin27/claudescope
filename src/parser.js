import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { projectsDir, shortProjectLabel, decodeProjectName } from './paths.js';
import { costForUsage } from './pricing.js';

/** Extract plain, searchable text from a message.content (string | block[]). */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) parts.push(block.text);
    else if (block.type === 'thinking' && block.thinking) parts.push(block.thinking);
    else if (block.type === 'tool_use' && block.name) {
      // Index the tool INPUT too — the command you ran or file you edited lives
      // here, and it's what users actually search for.
      let inp = '';
      if (block.input != null) {
        try {
          inp = ' ' + JSON.stringify(block.input);
        } catch {
          /* ignore unserializable input */
        }
      }
      parts.push(`[tool:${block.name}]${inp.length > 800 ? inp.slice(0, 800) : inp}`);
    } else if (block.type === 'tool_result') {
      if (block.is_error) parts.push('[error]'); // make failed tool calls searchable
      const c = block.content;
      if (typeof c === 'string') parts.push(c);
      else if (Array.isArray(c)) {
        for (const b of c) if (b && b.type === 'text' && b.text) parts.push(b.text);
      }
    }
  }
  return parts.join('\n');
}

function collectToolNames(content, into) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && block.type === 'tool_use' && block.name) {
      into[block.name] = (into[block.name] || 0) + 1;
    }
  }
}

const SEARCH_MAX = 4000; // chars of each message indexed for full-text search (bounds index memory)
const SNIPPET = 280;

function basename(p) {
  if (!p) return null;
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || null;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function addUsage(target, usage) {
  if (!usage) return;
  target.input += usage.input_tokens || 0;
  target.output += usage.output_tokens || 0;
  target.cacheWrite += usage.cache_creation_input_tokens || 0;
  target.cacheRead += usage.cache_read_input_tokens || 0;
}

/** Parse one .jsonl transcript file into a session summary + message records. */
export async function parseFile(filePath, encodedProject) {
  const sessionsById = new Map();
  const messages = [];
  const seenMsgIds = new Set(); // dedupe usage across the lines of one assistant message

  function getSession(id) {
    if (!sessionsById.has(id)) {
      sessionsById.set(id, {
        sessionId: id,
        project: encodedProject,
        projectLabel: shortProjectLabel(encodedProject),
        projectPath: decodeProjectName(encodedProject),
        file: path.basename(filePath),
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
        heat: {}, // (weekday*24+hour) -> assistant-message count, by each message's own ts
        interrupted: 0, // count of "[Request interrupted by user]" turns
      });
    }
    return sessionsById.get(id);
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // skip malformed lines, keep going
    }
    const type = obj.type;
    if (type !== 'user' && type !== 'assistant') continue;

    const sid = obj.sessionId || 'unknown';
    const s = getSession(sid);
    const ts = obj.timestamp || null;
    if (ts) {
      if (!s.firstTs || ts < s.firstTs) s.firstTs = ts;
      if (!s.lastTs || ts > s.lastTs) s.lastTs = ts;
    }
    if (obj.version) s.version = obj.version;
    if (obj.gitBranch) s.gitBranch = obj.gitBranch;
    if (obj.cwd) {
      s.cwd = obj.cwd;
      // The session's real cwd is authoritative — it recovers hyphens and the
      // true last segment that the encoded folder name can't (e.g. "dynafeet-web").
      s.projectPath = obj.cwd;
      const b = basename(obj.cwd);
      if (b) s.projectLabel = b;
    }
    if (obj.userType) s.userType = obj.userType;
    if (obj.entrypoint) s.entrypoint = obj.entrypoint;

    const msg = obj.message || {};
    const content = msg.content;
    const text = extractText(content);

    if (type === 'user') {
      s.messageCount++;
      // Skip synthetic tool_result-only "user" turns when counting human turns,
      // but still index their text for search.
      const isToolResult = Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
      if (!isToolResult) {
        s.userMsgs++;
        if (!s.title && text.trim()) {
          s.title = text.trim().replace(/\s+/g, ' ').slice(0, 120);
        }
      }
      // A "[Request interrupted by user]" turn means the user stopped Claude
      // mid-response — a proxy for "it went the wrong way".
      if (typeof text === 'string' && text.includes('[Request interrupted by user')) {
        s.interrupted++;
      }
    } else if (type === 'assistant') {
      // Claude Code writes ONE JSONL line per content block of a single
      // assistant response — all lines share message.id and repeat the SAME
      // message-level usage object. Counting per line inflates tokens/cost ~2x+.
      // Count usage / replies / model / heat ONCE per message.id. Tool_use
      // blocks live on their own lines, so tools are still counted per line.
      const mid = msg.id;
      const fresh = !mid || !seenMsgIds.has(mid);
      if (mid) seenMsgIds.add(mid);
      const realModel = msg.model && msg.model !== '<synthetic>' ? msg.model : null;
      collectToolNames(content, s.tools);
      if (fresh) {
        s.messageCount++;
        s.assistantMsgs++;
        if (realModel) s.models[realModel] = (s.models[realModel] || 0) + 1;
        if (ts) {
          const dt = new Date(ts);
          if (!isNaN(dt)) {
            const bucket = dt.getDay() * 24 + dt.getHours();
            s.heat[bucket] = (s.heat[bucket] || 0) + 1;
          }
        }
        if (msg.usage) {
          addUsage(s.usage, msg.usage);
          const c = costForUsage(msg.model, msg.usage);
          s.cost += c;
          if (realModel) {
            if (!s.modelUsage[realModel]) {
              s.modelUsage[realModel] = { messages: 0, usage: emptyUsage(), cost: 0 };
            }
            const mu = s.modelUsage[realModel];
            mu.messages++;
            addUsage(mu.usage, msg.usage);
            mu.cost += c;
          }
        }
      }
    }

    if (text.trim()) {
      // Store a lowercased, generously-capped haystack so search finds matches
      // well past the first screenful, and never re-lowercases per query.
      const lc = (text.length > SEARCH_MAX ? text.slice(0, SEARCH_MAX) : text).toLowerCase();
      messages.push({
        sessionId: sid,
        project: encodedProject,
        projectLabel: s.projectLabel,
        ts,
        role: type,
        lc,
        snippet: text.replace(/\s+/g, ' ').slice(0, SNIPPET),
      });
    }
  }

  return { sessions: [...sessionsById.values()], messages };
}

/**
 * Read one session's full conversation on demand (for the detail view).
 * Returns an ordered list of turns with readable text + tool/model/usage,
 * deduped so a split assistant message appears once with its blocks merged.
 */
export async function readConversation(filePath, sessionId) {
  const turns = [];
  const byId = new Map(); // message.id -> turn (to merge split assistant lines)
  let header = { project: null, cwd: null, version: null, gitBranch: null };

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (sessionId && obj.sessionId && obj.sessionId !== sessionId) continue;
    const type = obj.type;
    if (type !== 'user' && type !== 'assistant') continue;
    if (obj.cwd) header.cwd = obj.cwd;
    if (obj.version) header.version = obj.version;
    if (obj.gitBranch) header.gitBranch = obj.gitBranch;

    const msg = obj.message || {};
    const content = msg.content;
    const text = extractText(content).trim();
    const tools = [];
    if (Array.isArray(content)) {
      for (const b of content) if (b && b.type === 'tool_use' && b.name) tools.push(b.name);
    }
    const isToolResult = type === 'user' && Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');

    if (type === 'assistant' && msg.id && byId.has(msg.id)) {
      const t = byId.get(msg.id);
      if (text) t.text = t.text ? t.text + '\n' + text : text;
      for (const name of tools) if (!t.tools.includes(name)) t.tools.push(name);
      continue;
    }
    const turn = {
      role: type,
      kind: isToolResult ? 'tool_result' : type,
      ts: obj.timestamp || null,
      model: type === 'assistant' ? msg.model || null : null,
      text: text.length > 6000 ? text.slice(0, 6000) + '…' : text,
      tools,
    };
    turns.push(turn);
    if (type === 'assistant' && msg.id) byId.set(msg.id, turn);
  }
  return { sessionId, turns, ...header };
}

/** Parse every transcript under <claudeDir>/projects. */
export async function parseAll(claudeDir, { onProgress } = {}) {
  const root = projectsDir(claudeDir);
  const sessions = [];
  const messages = [];
  // Guard the top-level scan so a missing/non-directory projects root (or a
  // TOCTOU race, or any direct programmatic caller) yields an empty result the
  // dashboard/JSON can still render, instead of a raw ENOENT/ENOTDIR stack.
  let projectDirs = [];
  try {
    projectDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { sessions, messages };
  }

  let done = 0;
  let totalFiles = 0;
  const fileList = [];
  for (const proj of projectDirs) {
    const dir = path.join(root, proj);
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of entries) {
      fileList.push({ proj, file: path.join(dir, f) });
      totalFiles++;
    }
  }

  for (const { proj, file } of fileList) {
    try {
      const { sessions: ss, messages: mm } = await parseFile(file, proj);
      sessions.push(...ss);
      messages.push(...mm);
    } catch {
      // ignore unreadable file
    }
    done++;
    if (onProgress) onProgress(done, totalFiles);
  }

  return { sessions, messages };
}
