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
      parts.push(`[tool:${block.name}]`);
    } else if (block.type === 'tool_result') {
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

const MAX_TEXT = 2000; // cap per-message stored text to bound memory
const SNIPPET = 280;

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
        tools: {},
        usage: emptyUsage(),
        cost: 0,
        title: null,
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
    if (obj.cwd) s.cwd = obj.cwd;
    if (obj.userType) s.userType = obj.userType;
    if (obj.entrypoint) s.entrypoint = obj.entrypoint;

    const msg = obj.message || {};
    const content = msg.content;
    const text = extractText(content);

    s.messageCount++;
    if (type === 'user') {
      // Skip synthetic tool_result-only "user" turns when counting human turns,
      // but still index their text for search.
      const isToolResult = Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
      if (!isToolResult) {
        s.userMsgs++;
        if (!s.title && text.trim()) {
          s.title = text.trim().replace(/\s+/g, ' ').slice(0, 120);
        }
      }
    } else if (type === 'assistant') {
      s.assistantMsgs++;
      if (msg.model && msg.model !== '<synthetic>') s.models[msg.model] = (s.models[msg.model] || 0) + 1;
      collectToolNames(content, s.tools);
      if (msg.usage) {
        addUsage(s.usage, msg.usage);
        s.cost += costForUsage(msg.model, msg.usage);
      }
    }

    if (text.trim()) {
      messages.push({
        sessionId: sid,
        project: encodedProject,
        projectLabel: s.projectLabel,
        ts,
        role: type,
        text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
        snippet: text.replace(/\s+/g, ' ').slice(0, SNIPPET),
      });
    }
  }

  return { sessions: [...sessionsById.values()], messages };
}

/** Parse every transcript under <claudeDir>/projects. */
export async function parseAll(claudeDir, { onProgress } = {}) {
  const root = projectsDir(claudeDir);
  const sessions = [];
  const messages = [];
  const projectDirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

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
