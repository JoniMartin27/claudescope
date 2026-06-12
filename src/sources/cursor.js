// Cursor (cursor-agent / Cursor CLI) source adapter — EXPERIMENTAL / best-effort.
//
// IMPORTANT CONSTRAINT: Cursor stores its chat history in SQLite databases
// (~/.cursor/chats/**/store.db and the global state.vscdb), NOT in a plain
// text/JSONL transcript. ClaudeScope ships with ZERO runtime dependencies and
// uses no SQLite driver, so we deliberately do NOT crack open those .db files.
//
// What we CAN parse cheaply, zero-dep, is any JSON the cursor-agent CLI writes
// in line-delimited or array form. cursor-agent's `--output-format json`
// produces JSON events, and some setups persist chats as .json under
// ~/.cursor/chats. We look for plain *.json / *.jsonl there and parse the
// common { role, content/text, timestamp } message shape. If none exist (the
// usual case — data lives only in SQLite), locate() returns [] and Cursor is
// simply absent. This adapter never throws.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession, newMessage, touchTs, bumpHeat } from './shape.js';
import { stripBom } from '../bom.js';

const ID = 'cursor';

function cursorHome() {
  return process.env.CURSOR_HOME || path.join(os.homedir(), '.cursor');
}

function walkJson(dir, out, depth = 0) {
  if (depth > 4) return; // bound the walk
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(full, out, depth + 1);
    else if (e.isFile() && (e.name.endsWith('.jsonl') || e.name.endsWith('.json'))) out.push(full);
  }
}

function locate() {
  const root = path.join(cursorHome(), 'chats');
  const out = [];
  walkJson(root, out);
  return out;
}

function normRole(r) {
  if (r === 'assistant' || r === 'model' || r === 'ai' || r === 2) return 'assistant';
  if (r === 'user' || r === 1) return 'user';
  return null;
}

function msgText(m) {
  if (typeof m.text === 'string') return m.text;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  }
  return '';
}

/** Extract an array of message-like objects from one parsed Cursor doc. */
function messagesOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.messages)) return doc.messages;
  if (doc && Array.isArray(doc.conversation)) return doc.conversation;
  if (doc && Array.isArray(doc.bubbles)) return doc.bubbles; // Cursor's term
  return null;
}

async function parseFile(filePath) {
  let raw;
  try {
    raw = stripBom(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { sessions: [], messages: [] };
  }

  // Accept both a single JSON document and JSONL (one message per line).
  let list = null;
  try {
    list = messagesOf(JSON.parse(raw));
  } catch {
    list = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        list.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
  }
  if (!list || !list.length) return { sessions: [], messages: [] };

  const sessionId = `cursor-${path.basename(filePath, path.extname(filePath))}`;
  const s = newSession({ sessionId, source: ID, projectLabel: 'cursor', file: path.basename(filePath) });
  const messages = [];

  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const role = normRole(m.role ?? m.type ?? m.sender);
    if (!role) continue;
    const ts = m.timestamp || m.ts || m.createdAt || null;
    const text = msgText(m).trim();
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
  name: 'Cursor',
  locate,
  parseFile,
};
