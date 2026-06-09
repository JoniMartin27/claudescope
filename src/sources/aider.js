// Aider source adapter — EXPERIMENTAL / best-effort.
//
// Aider logs its chat to a Markdown file, by default `.aider.chat.history.md`
// in each project's working dir (overridable via $AIDER_CHAT_HISTORY_FILE).
// The format is human-prose Markdown with these structural markers:
//
//   # aider chat started at 2025-03-28 10:00:00      <- session separator
//   #### the user's prompt line(s)                    <- '####' = a user turn
//   <plain paragraphs>                                <- assistant reply text
//   > tool / command output                           <- blockquote, skipped
//
// Aider records no token usage or model per turn in this file, so usage stays 0
// (tokens unknown); sessions/messages/search still aggregate. We discover files
// at well-known locations: $AIDER_CHAT_HISTORY_FILE, the home dir, and (best
// effort) the user's recent project dirs is out of scope — we only look where
// we can do so cheaply without scanning the whole disk.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession, newMessage, touchTs, bumpHeat } from './shape.js';

const ID = 'aider';
const DEFAULT_NAME = '.aider.chat.history.md';

function locate() {
  const candidates = [];
  if (process.env.AIDER_CHAT_HISTORY_FILE) candidates.push(process.env.AIDER_CHAT_HISTORY_FILE);
  // The home directory is the one place we can check cheaply without walking
  // the whole filesystem; project-local histories are picked up when CWD == home
  // or via the env var. (A future version could read ~/.aider config for more.)
  candidates.push(path.join(os.homedir(), DEFAULT_NAME));
  candidates.push(path.join(process.cwd(), DEFAULT_NAME));
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const abs = path.resolve(c);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      if (fs.statSync(abs).isFile()) out.push(abs);
    } catch {
      /* not present */
    }
  }
  return out;
}

// Parse "# aider chat started at 2025-03-28 10:00:00" -> ISO string (local).
function parseSessionTs(line) {
  const m = line.match(/started at\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}`);
  return isNaN(d) ? null : d.toISOString();
}

async function parseFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { sessions: [], messages: [] };
  }
  const lines = raw.split(/\r?\n/);

  const sessions = [];
  const messages = [];
  let s = null;
  let sessionIdx = 0;
  let role = null; // current turn role
  let buf = [];
  let curTs = null;

  const fileTag = path.basename(filePath);

  function ensureSession() {
    if (s) return s;
    sessionIdx++;
    s = newSession({
      sessionId: `aider-${fileTag}-${sessionIdx}`,
      source: ID,
      projectLabel: 'aider',
      file: fileTag,
    });
    sessions.push(s);
    return s;
  }

  function flush() {
    if (!role || !s) {
      buf = [];
      role = null;
      return;
    }
    const text = buf.join('\n').trim();
    buf = [];
    if (!text) {
      role = null;
      return;
    }
    s.messageCount++;
    touchTs(s, curTs);
    if (role === 'user') {
      s.userMsgs++;
      if (!s.title) s.title = text.replace(/\s+/g, ' ').slice(0, 120);
    } else {
      s.assistantMsgs++;
      bumpHeat(s, curTs);
    }
    messages.push(newMessage({ sessionId: s.sessionId, source: ID, projectLabel: 'aider', ts: curTs, role, text }));
    role = null;
  }

  for (const line of lines) {
    // New session separator.
    if (/^#\s+aider chat started at/i.test(line)) {
      flush();
      s = null;
      curTs = parseSessionTs(line);
      ensureSession();
      if (curTs) touchTs(s, curTs);
      continue;
    }
    // A user turn line: "#### prompt".
    if (/^####\s?/.test(line)) {
      flush();
      ensureSession();
      role = 'user';
      buf.push(line.replace(/^####\s?/, ''));
      continue;
    }
    // Blockquoted tool/command output — not conversational, skip.
    if (/^>\s?/.test(line)) {
      if (role === 'user') flush(); // a quote ends the user prompt block
      continue;
    }
    // Any other non-empty line is assistant prose (start a reply if needed).
    if (line.trim()) {
      ensureSession();
      if (role !== 'user' && role !== 'assistant') role = 'assistant';
      buf.push(line);
    } else if (role === 'user') {
      // A blank line ends a user prompt; assistant prose can span blanks.
      flush();
    }
  }
  flush();

  const real = sessions.filter((x) => x.messageCount > 0);
  return { sessions: real, messages };
}

export default {
  id: ID,
  name: 'Aider',
  locate,
  parseFile,
};
