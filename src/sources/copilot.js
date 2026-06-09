// GitHub Copilot CLI source adapter — EXPERIMENTAL / best-effort.
//
// Copilot CLI keeps one directory per session under
//   ~/.copilot/session-state/<uuid>/events.jsonl
// (config dir overridable via $COPILOT_CONFIG_DIR / $XDG_CONFIG_HOME). Verified
// on-disk event shapes (producer copilot-agent):
//
//   {"type":"session.start","data":{"sessionId","selectedModel","context":{"cwd"}},...}
//   {"type":"user.message","data":{"content":"...","agentMode":"interactive"},"timestamp"}
//   {"type":"assistant.message","data":{"messageId","content":"...","toolRequests":[...]},...}
//   {"type":"session.shutdown","data":{"modelMetrics":{"<model>":{"usage":{
//       inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens}}}},...}
//
// We map user.message/assistant.message -> turns, toolRequests[].name -> tools,
// and the final session.shutdown modelMetrics -> usage (authoritative totals).
// Cost prices through pricing.js (OpenAI models -> $0; tokens still aggregate).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { newSession, newMessage, touchTs, bumpHeat } from './shape.js';

const ID = 'copilot';

function copilotHome() {
  if (process.env.COPILOT_CONFIG_DIR) return process.env.COPILOT_CONFIG_DIR;
  return path.join(os.homedir(), '.copilot');
}

function locate() {
  const root = path.join(copilotHome(), 'session-state');
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const f = path.join(root, e.name, 'events.jsonl');
    try {
      if (fs.statSync(f).isFile()) out.push(f);
    } catch {
      /* no events file in this session dir */
    }
  }
  return out;
}

function tokensFromMetrics(modelMetrics) {
  // Sum usage across every model the session touched.
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let primaryModel = null;
  if (modelMetrics && typeof modelMetrics === 'object') {
    for (const [model, m] of Object.entries(modelMetrics)) {
      const u = (m && m.usage) || {};
      usage.input += u.inputTokens || 0;
      usage.output += (u.outputTokens || 0) + (u.reasoningTokens || 0);
      usage.cacheRead += u.cacheReadTokens || 0;
      usage.cacheWrite += u.cacheWriteTokens || 0;
      if (!primaryModel) primaryModel = model;
    }
  }
  return { usage, primaryModel };
}

async function parseFile(filePath) {
  const sessionId = path.basename(path.dirname(filePath));
  const s = newSession({ sessionId, source: ID, projectLabel: 'copilot', file: 'events.jsonl' });
  const messages = [];
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
    const d = obj.data || {};

    if (obj.type === 'session.start') {
      if (d.selectedModel) model = d.selectedModel;
      const cwd = d.context && d.context.cwd;
      if (cwd) {
        s.cwd = cwd;
        s.projectPath = cwd;
        const seg = String(cwd).split(/[\\/]/).filter(Boolean).pop();
        if (seg) s.projectLabel = seg;
      }
      if (d.copilotVersion && d.copilotVersion !== 'unknown') s.version = d.copilotVersion;
      touchTs(s, ts);
      continue;
    }

    if (obj.type === 'user.message') {
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      s.messageCount++;
      s.userMsgs++;
      touchTs(s, ts);
      if (!s.title && text) s.title = text.replace(/\s+/g, ' ').slice(0, 120);
      if (text) messages.push(newMessage({ sessionId, source: ID, projectLabel: s.projectLabel, ts, role: 'user', text }));
      continue;
    }

    if (obj.type === 'assistant.message') {
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      s.messageCount++;
      s.assistantMsgs++;
      touchTs(s, ts);
      bumpHeat(s, ts);
      if (model) s.models[model] = (s.models[model] || 0) + 1;
      if (Array.isArray(d.toolRequests)) {
        for (const t of d.toolRequests) {
          const name = t && (t.name || t.tool);
          if (name) s.tools[name] = (s.tools[name] || 0) + 1;
        }
      }
      if (text) messages.push(newMessage({ sessionId, source: ID, projectLabel: s.projectLabel, ts, role: 'assistant', text }));
      continue;
    }

    if (obj.type === 'session.shutdown') {
      touchTs(s, ts);
      const { usage, primaryModel } = tokensFromMetrics(d.modelMetrics);
      s.usage = usage;
      // If no per-message model was seen, attribute replies to the metrics model.
      if (primaryModel && Object.keys(s.models).length === 0 && s.assistantMsgs > 0) {
        s.models[primaryModel] = s.assistantMsgs;
      }
    }
  }

  if (s.messageCount === 0 && messages.length === 0) return { sessions: [], messages: [] };
  return { sessions: [s], messages };
}

export default {
  id: ID,
  name: 'GitHub Copilot',
  locate,
  parseFile,
};
