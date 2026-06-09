// Claude Code source adapter.
//
// This wraps the EXISTING, battle-tested Claude Code parser (src/parser.js).
// Output is byte-identical to what ClaudeScope produced before the multi-CLI
// refactor — every session/message simply gets a `source: 'claude-code'` tag
// added (the only new field). All existing tests and the default dashboard
// behavior rely on this adapter being a transparent pass-through.

import fs from 'node:fs';
import path from 'node:path';
import { projectsDir } from '../paths.js';
import { parseFile as parseClaudeFile } from '../parser.js';

const ID = 'claude-code';

/** Locate every Claude Code transcript under <claudeDir>/projects/**.jsonl. */
function locate(claudeDir) {
  if (!claudeDir) return [];
  const root = projectsDir(claudeDir);
  const files = [];
  let projectDirs = [];
  try {
    projectDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  for (const proj of projectDirs) {
    const dir = path.join(root, proj);
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of entries) files.push(path.join(dir, f));
  }
  return files;
}

/**
 * Parse one Claude Code transcript. We recover the encoded project folder name
 * from the path (it's the file's parent dir) so the wrapped parser produces the
 * same project label/path it always has, then tag source on each record.
 */
async function parseFile(filePath) {
  const encodedProject = path.basename(path.dirname(filePath));
  const { sessions, messages } = await parseClaudeFile(filePath, encodedProject);
  for (const s of sessions) s.source = ID;
  for (const m of messages) m.source = ID;
  return { sessions, messages };
}

export default {
  id: ID,
  name: 'Claude Code',
  locate,
  parseFile,
};
