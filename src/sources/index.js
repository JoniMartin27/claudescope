// Source adapter registry + multi-CLI aggregation.
//
// ClaudeScope started as a Claude Code analytics tool; it now parses OTHER
// agent CLIs' local logs too, normalized into the exact same session/message
// shape, so search + analytics span every agent you use. Each adapter is
// pluggable and self-contained (see ./shape.js for the interface contract):
//
//   { id, name, locate() -> string[] of existing transcript paths,
//     parseFile(path) -> { sessions, messages } in the normalized shape,
//     every record tagged source:id }
//
// Claude Code is always tried (and is a transparent pass-through to the
// original parser, so legacy behavior is byte-identical). The experimental
// adapters only contribute when their logs are actually present on this
// machine — a missing/absent tool just yields locate() === [] and is skipped.

import claudeCode from './claude-code.js';
import codex from './codex.js';
import cursor from './cursor.js';
import aider from './aider.js';
import gemini from './gemini.js';
import copilot from './copilot.js';
import { costForUsage } from '../pricing.js';

// Claude Code first; the rest are best-effort and only light up when detected.
export const ADAPTERS = [claudeCode, codex, cursor, aider, gemini, copilot];

/**
 * Price a normalized session that an adapter built WITHOUT cost (i.e. every
 * non-claude adapter — the Claude adapter's wrapped parser already sets cost).
 * pricing.js only knows Claude rates, so OpenAI/Gemini models price to $0;
 * tokens and counts still aggregate everywhere. We map our 4-bucket usage back
 * onto the usage-object pricing.js expects.
 */
function priceSession(s) {
  const model = Object.keys(s.models)[0] || null;
  const u = s.usage || {};
  s.cost = costForUsage(model, {
    input_tokens: u.input || 0,
    output_tokens: u.output || 0,
    cache_creation_input_tokens: u.cacheWrite || 0,
    cache_read_input_tokens: u.cacheRead || 0,
  });
  // Mirror into modelUsage so byModel cost/tokens line up in analytics.
  if (model) {
    s.modelUsage[model] = {
      messages: s.models[model] || s.assistantMsgs || 0,
      usage: { ...{ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, ...u },
      cost: s.cost,
    };
  }
}

/**
 * Run one adapter end-to-end: locate its files, parse each defensively, and
 * post-price non-claude sessions. A throwing file or adapter never aborts the
 * scan — that source/file is simply skipped.
 *
 * @param adapter one of ADAPTERS
 * @param ctx     { claudeDir } — passed to locate() (only claude-code uses it)
 */
async function runAdapter(adapter, ctx, onFile) {
  let files = [];
  try {
    files = adapter.locate(ctx.claudeDir) || [];
  } catch {
    return { sessions: [], messages: [] };
  }
  const sessions = [];
  const messages = [];
  for (const file of files) {
    let res;
    try {
      res = await adapter.parseFile(file);
    } catch {
      if (onFile) onFile();
      continue; // unreadable/garbage file — skip, keep going
    }
    if (res && res.sessions) {
      for (const s of res.sessions) {
        if (adapter.id !== 'claude-code') priceSession(s);
        sessions.push(s);
      }
    }
    if (res && res.messages) messages.push(...res.messages);
    if (onFile) onFile();
  }
  return { sessions, messages };
}

/**
 * Aggregate across every adapter whose logs are present.
 * @returns {Promise<{sessions, messages, sources}>}
 *   sources = [{ id, name, files }] for adapters that found ≥1 file.
 */
export async function parseAllSources(claudeDir, { onProgress } = {}) {
  const ctx = { claudeDir };
  const allSessions = [];
  const allMessages = [];
  const sources = [];

  // Pre-count files for progress, defensively.
  let total = 0;
  const located = [];
  for (const a of ADAPTERS) {
    let files = [];
    try {
      files = a.locate(ctx.claudeDir) || [];
    } catch {
      files = [];
    }
    located.push({ adapter: a, count: files.length });
    total += files.length;
  }

  let done = 0;
  const tick = () => {
    done++;
    if (onProgress) onProgress(done, total);
  };

  for (const { adapter } of located) {
    const { sessions, messages } = await runAdapter(adapter, ctx, tick);
    if (sessions.length || messages.length) {
      allSessions.push(...sessions);
      allMessages.push(...messages);
    }
    if (sessions.length || messages.length) {
      sources.push({ id: adapter.id, name: adapter.name, sessions: sessions.length, messages: messages.length });
    }
  }

  return { sessions: allSessions, messages: allMessages, sources };
}
