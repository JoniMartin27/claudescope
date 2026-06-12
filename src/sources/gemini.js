// Gemini CLI source adapter — EXPERIMENTAL / best-effort.
//
// Gemini CLI stores per-project chat history under
//   ~/.gemini/tmp/<project_hash>/logs.json        (flat array of log entries)
//   ~/.gemini/tmp/<project_hash>/chats/*.json      (saved/checkpointed chats)
// (root overridable via $GEMINI_DIR). The documented logs.json shape is an
// array of entries roughly:
//   { "sessionId":"...", "messageId":N, "type":"user", "message":"...",
//     "timestamp":"ISO-8601" }
// Saved chats use a Content[] history shape:
//   { "messages":[ { "role":"user"|"model", "parts":[{"text":"..."}] } ] }
//
// Both forms are handled defensively — Gemini does NOT record token usage in
// these files, so usage stays 0 (tokens unknown) while sessions/messages and
// search still aggregate. We never throw on an unexpected shape.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession, newMessage, touchTs, bumpHeat } from './shape.js';
import { stripBom } from '../bom.js';

const ID = 'gemini';

function geminiHome() {
  return process.env.GEMINI_DIR || path.join(os.homedir(), '.gemini');
}

function locate() {
  const tmp = path.join(geminiHome(), 'tmp');
  const out = [];
  let hashes = [];
  try {
    hashes = fs.readdirSync(tmp, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const h of hashes) {
    const base = path.join(tmp, h.name);
    const logs = path.join(base, 'logs.json');
    try {
      if (fs.statSync(logs).isFile()) out.push(logs);
    } catch {
      /* none */
    }
    const chatsDir = path.join(base, 'chats');
    try {
      for (const f of fs.readdirSync(chatsDir)) {
        if (f.endsWith('.json')) out.push(path.join(chatsDir, f));
      }
    } catch {
      /* no chats dir */
    }
  }
  return out;
}

function normRole(r) {
  if (r === 'assistant' || r === 'model') return 'assistant';
  if (r === 'user') return 'user';
  return null;
}

/** Pull text from either a plain string `message` or a parts[] array. */
function entryText(e) {
  if (typeof e.message === 'string') return e.message;
  if (typeof e.content === 'string') return e.content;
  if (typeof e.text === 'string') return e.text;
  const parts = e.parts || (e.message && e.message.parts);
  if (Array.isArray(parts)) {
    return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
  }
  return '';
}

async function parseFile(filePath) {
  let raw;
  try {
    raw = stripBom(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { sessions: [], messages: [] };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { sessions: [], messages: [] };
  }

  // Accept several documented shapes: a bare array of entries, or an object
  // with a `messages`/`history` array.
  let entries = null;
  if (Array.isArray(doc)) entries = doc;
  else if (doc && Array.isArray(doc.messages)) entries = doc.messages;
  else if (doc && Array.isArray(doc.history)) entries = doc.history;
  if (!entries) return { sessions: [], messages: [] };

  // The project hash dir is two levels up for logs.json, three for chats/*.json.
  const hashDir = filePath.includes(`${path.sep}chats${path.sep}`)
    ? path.dirname(path.dirname(filePath))
    : path.dirname(filePath);
  const sessionId = `gemini-${path.basename(hashDir)}-${path.basename(filePath, '.json')}`;
  const s = newSession({ sessionId, source: ID, projectLabel: 'gemini', file: path.basename(filePath) });
  const messages = [];

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const role = normRole(e.role || e.type);
    if (!role) continue;
    const ts = e.timestamp || e.ts || null;
    const text = entryText(e).trim();
    touchTs(s, ts);
    s.messageCount++;
    if (role === 'user') {
      s.userMsgs++;
      if (!s.title && text) s.title = text.replace(/\s+/g, ' ').slice(0, 120);
    } else {
      s.assistantMsgs++;
      bumpHeat(s, ts);
    }
    if (text) messages.push(newMessage({ sessionId, source: ID, projectLabel: s.projectLabel, ts, role, text }));
  }

  if (s.messageCount === 0 && messages.length === 0) return { sessions: [], messages: [] };
  return { sessions: [s], messages };
}

export default {
  id: ID,
  name: 'Gemini CLI',
  locate,
  parseFile,
};
