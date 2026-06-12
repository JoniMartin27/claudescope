// Local team mode — merge multiple machines'/people's session dumps locally.
//
// The shareable unit is the RAW NORMALIZED SESSIONS ARRAY (the exact input to
// buildAnalytics) — analytics output is already aggregated and lossy, so it
// can't be re-merged faithfully. Each person runs `claudescope --dump-sessions
// me.json`, drops the file in a shared folder, and anyone runs `claudescope
// --merge ./folder` to get the combined analytics.
//
// 100% local: this reads JSON files off disk and runs the same in-memory
// analytics. It makes zero network requests and never writes back to the
// shared inputs.

import fs from 'node:fs';
import path from 'node:path';
import { stripBom } from './bom.js';

/**
 * A dump file is `{ kind: 'claudescope-session-dump', version, dumpedAt,
 * source?, sessions: [...] }`. We also accept a bare top-level array of
 * session-shaped objects (tolerant of hand-rolled / older dumps).
 */
export const DUMP_KIND = 'claudescope-session-dump';
export const DUMP_VERSION = 1;

/** Heuristic: does this object look like one of our normalized sessions? */
function looksLikeSession(o) {
  return (
    o &&
    typeof o === 'object' &&
    !Array.isArray(o) &&
    typeof o.sessionId === 'string' &&
    o.usage &&
    typeof o.usage === 'object' &&
    typeof o.messageCount === 'number'
  );
}

/**
 * Wrap a sessions array into the on-disk dump envelope. `source` is an optional
 * free-form tag (e.g. a machine or person name) propagated onto each session's
 * `dumpSource` so merged analytics can keep provenance.
 */
export function makeDump(sessions, { source } = {}) {
  return {
    kind: DUMP_KIND,
    version: DUMP_VERSION,
    dumpedAt: new Date().toISOString(),
    source: source || null,
    sessions: Array.isArray(sessions) ? sessions : [],
  };
}

/**
 * Pull a normalized sessions array out of already-parsed JSON, or return null
 * if it doesn't look like a session dump. Accepts:
 *   - our envelope: { kind: DUMP_KIND, sessions: [...] }
 *   - a bare array of session-shaped objects
 * Anything else (analytics output, junk) -> null.
 */
export function extractSessions(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.every(looksLikeSession) && parsed.length >= 0 ? parsed : null;
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.kind === DUMP_KIND && Array.isArray(parsed.sessions)) {
      // Trust the envelope kind, but still filter to session-shaped entries.
      return parsed.sessions.filter(looksLikeSession);
    }
    // An envelope-less object that happens to carry a sessions array.
    if (Array.isArray(parsed.sessions) && parsed.sessions.every(looksLikeSession)) {
      return parsed.sessions;
    }
  }
  return null;
}

/** Recursively collect *.json files under a directory (sorted, stable order). */
function jsonFilesIn(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonFilesIn(full));
    else if (e.isFile() && full.toLowerCase().endsWith('.json')) out.push(full);
  }
  return out;
}

/**
 * Expand a list of file/dir paths into a flat, ordered list of candidate JSON
 * files. Files are taken as-is; directories are recursed for *.json.
 */
export function expandPaths(paths) {
  const files = [];
  for (const p of paths) {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      files.push({ file: p, missing: true });
      continue;
    }
    if (st.isDirectory()) files.push(...jsonFilesIn(p).map((file) => ({ file })));
    else files.push({ file: p });
  }
  return files;
}

/**
 * Merge session dumps from files and/or directories into one sessions array.
 * Tolerant of bad / non-matching files: each is skipped and reported via
 * `onSkip(file, reason)` (the CLI prints these to stderr) instead of throwing.
 *
 * @param {string[]} paths  files and/or directories
 * @param {object}   [opts] { onSkip(file, reason) }
 * @returns {{ sessions: object[], loaded: {file,count,source}[], skipped: {file,reason}[] }}
 */
export function mergeDumps(paths, { onSkip } = {}) {
  const sessions = [];
  const loaded = [];
  const skipped = [];
  const skip = (file, reason) => {
    skipped.push({ file, reason });
    if (onSkip) onSkip(file, reason);
  };

  for (const { file, missing } of expandPaths(paths)) {
    if (missing) {
      skip(file, 'no such file or directory');
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      skip(file, 'unreadable (' + (e.code || e.message) + ')');
      continue;
    }
    let parsed;
    try {
      // Strip a leading UTF-8 BOM — Windows-authored dumps (PowerShell, Notepad)
      // commonly carry one and would otherwise be wrongly skipped here.
      parsed = JSON.parse(stripBom(raw));
    } catch {
      skip(file, 'not valid JSON');
      continue;
    }
    const got = extractSessions(parsed);
    if (!got) {
      skip(file, 'not a session dump');
      continue;
    }
    // Tag provenance: prefer the envelope `source`, fall back to the file's
    // basename, but never clobber a source already on the session.
    const dumpSource =
      (parsed && !Array.isArray(parsed) && parsed.source) || path.basename(file);
    for (const s of got) {
      if (s && typeof s === 'object' && s.dumpSource == null) s.dumpSource = dumpSource;
      sessions.push(s);
    }
    loaded.push({ file, count: got.length, source: dumpSource });
  }

  return { sessions, loaded, skipped };
}
