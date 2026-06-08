import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolve the Claude Code projects directory across platforms.
 * Honors CLAUDE_CONFIG_DIR (same env var Claude Code itself respects),
 * then falls back to the conventional ~/.claude location.
 */
export function findClaudeDir() {
  const candidates = [];
  if (process.env.CLAUDE_CONFIG_DIR) {
    candidates.push(process.env.CLAUDE_CONFIG_DIR);
  }
  const home = os.homedir();
  candidates.push(path.join(home, '.claude'));
  // XDG-style fallback some setups use
  if (process.env.XDG_CONFIG_HOME) {
    candidates.push(path.join(process.env.XDG_CONFIG_HOME, 'claude'));
  }
  candidates.push(path.join(home, '.config', 'claude'));

  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'projects'))) {
      return dir;
    }
  }
  return null;
}

export function projectsDir(claudeDir) {
  return path.join(claudeDir, 'projects');
}

/**
 * Decode an encoded project folder name back into a readable path.
 * Claude Code encodes "C:\Users\jonat\Desktop\proyects" as
 * "C--Users-jonat-Desktop-proyects". We can't perfectly recover the
 * original separators, but we can produce a stable, human-friendly label.
 */
export function decodeProjectName(encoded) {
  if (!encoded) return 'unknown';
  // Windows drive prefix: "C--" -> "C:/"
  let s = encoded.replace(/^([A-Za-z])--/, '$1:/');
  s = s.replace(/-/g, '/');
  return s;
}

/** A short, friendly label: just the last path segment. */
export function shortProjectLabel(encoded) {
  const decoded = decodeProjectName(encoded);
  const parts = decoded.split('/').filter(Boolean);
  return parts[parts.length - 1] || decoded;
}
