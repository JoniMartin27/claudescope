// OpenAI Codex CLI source adapter — EXPERIMENTAL / best-effort.
//
// Codex CLI writes one JSONL "rollout" file per session under
//   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl
// (overridable via $CODEX_HOME). Verified on-disk shape (cli_version 0.126):
//
//   {"type":"session_meta","payload":{"id","cwd","cli_version",...}}
//   {"type":"response_item","payload":{"type":"message","role":"user",
//       "content":[{"type":"input_text","text":"..."}]}}
//   {"type":"response_item","payload":{"type":"message","role":"assistant",
//       "content":[{"type":"output_text","text":"..."}]}}
//   {"type":"response_item","payload":{"type":"function_call","name":"shell_command",
//       "arguments":"{...json...}","call_id":"..."}}
//   {"type":"event_msg","payload":{"type":"token_count","info":{
//       "total_token_usage":{input_tokens,cached_input_tokens,output_tokens,...},
//       "last_token_usage":{...}}}}   // CUMULATIVE running total per turn
//
// We map: user/assistant messages -> turns; function_call.name -> tools;
// token_count.total_token_usage -> session usage (it's a running total, so we
// keep the MAX we see, not a sum). Model comes from session_meta/turn_context.
// Cost is priced through the existing pricing.js (Claude rates won't match
// OpenAI models, so non-claude usage simply prices to $0 — tokens/sessions
// still aggregate). Anything unexpected is skipped; the file never crashes us.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { newSession, newMessage, touchTs, bumpHeat } from './shape.js';

const ID = 'codex';

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/** Recursively collect *.jsonl rollout files under ~/.codex/sessions. */
function walkJsonl(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
}

function locate() {
  const root = path.join(codexHome(), 'sessions');
  const out = [];
  walkJsonl(root, out);
  return out;
}

/** Pull readable text out of a Codex message.content block array. */
function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (b && typeof b === 'object' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n');
}

async function parseFile(filePath) {
  const sessionId = path.basename(filePath).replace(/\.jsonl$/, '');
  const projectLabel = 'codex'; // refined from cwd once we see session_meta
  const s = newSession({ sessionId, source: ID, projectLabel, file: path.basename(filePath) });
  const messages = [];
  let maxTotalTokens = null; // token_count is cumulative; keep the richest snapshot
  let model = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = obj.timestamp || null;
    const p = obj.payload;
    if (!p || typeof p !== 'object') continue;

    if (obj.type === 'session_meta') {
      if (p.cwd) {
        s.cwd = p.cwd;
        s.projectPath = p.cwd;
        const seg = String(p.cwd).split(/[\\/]/).filter(Boolean).pop();
        if (seg) s.projectLabel = seg;
      }
      if (p.model) model = p.model;
      if (p.cli_version) s.version = p.cli_version;
      touchTs(s, ts);
      continue;
    }

    if (obj.type === 'turn_context' && p.model && !model) model = p.model;

    if (obj.type === 'response_item' && p.type === 'message') {
      const role = p.role === 'assistant' ? 'assistant' : p.role === 'user' ? 'user' : null;
      // Codex injects developer/tool/system roles too; only count human + model.
      if (!role) continue;
      const text = textOfContent(p.content).trim();
      touchTs(s, ts);
      if (role === 'user') {
        s.messageCount++;
        s.userMsgs++;
        if (!s.title && text) s.title = text.replace(/\s+/g, ' ').slice(0, 120);
      } else {
        s.messageCount++;
        s.assistantMsgs++;
        bumpHeat(s, ts);
        if (model) s.models[model] = (s.models[model] || 0) + 1;
      }
      if (text) messages.push(newMessage({ sessionId, source: ID, projectLabel: s.projectLabel, ts, role, text }));
      continue;
    }

    if (obj.type === 'response_item' && p.type === 'function_call' && p.name) {
      s.tools[p.name] = (s.tools[p.name] || 0) + 1;
      // Index the command/args so search can find them, like Claude tool_use.
      let inp = '';
      if (typeof p.arguments === 'string') inp = p.arguments.slice(0, 800);
      const text = `[tool:${p.name}] ${inp}`.trim();
      messages.push(newMessage({ sessionId, source: ID, projectLabel: s.projectLabel, ts, role: 'assistant', text }));
      continue;
    }

    if (obj.type === 'event_msg' && p.type === 'token_count' && p.info && p.info.total_token_usage) {
      const tu = p.info.total_token_usage;
      const total = tu.total_tokens || 0;
      if (maxTotalTokens == null || total > maxTotalTokens) {
        maxTotalTokens = total;
        // Map OpenAI usage onto our 4-bucket model. cached_input_tokens are a
        // subset of input_tokens; split them into our cacheRead bucket.
        const cacheRead = tu.cached_input_tokens || 0;
        const input = Math.max(0, (tu.input_tokens || 0) - cacheRead);
        const output = (tu.output_tokens || 0) + (tu.reasoning_output_tokens || 0);
        s.usage = { input, output, cacheWrite: 0, cacheRead };
      }
    }
  }

  // No usable content => emit nothing (keeps empty/partial files invisible).
  if (s.messageCount === 0 && messages.length === 0) return { sessions: [], messages: [] };
  return { sessions: [s], messages };
}

export default {
  id: ID,
  name: 'OpenAI Codex',
  locate,
  parseFile,
};
