import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Local-only daily snapshot store. This is the ONLY persisted state in
 * ClaudeScope and stays 100% on-disk under ~/.claudescope/snapshots.json.
 * Every fs operation is wrapped so a missing/locked/corrupt file silently
 * degrades to "no snapshots" rather than throwing — recording is best-effort.
 *
 * An optional `dir` argument overrides the storage directory (used by tests);
 * it defaults to ~/.claudescope.
 */

const MAX_SNAPSHOTS = 400;

export function snapshotPath(dir) {
  const base = dir || path.join(os.homedir(), '.claudescope');
  return path.join(base, 'snapshots.json');
}

/** Local-time YYYY-MM-DD for a Date (defaults to now). */
function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Read the snapshot array. Returns [] on ANY error (missing/corrupt/etc). */
export function readSnapshots(dir) {
  try {
    const raw = fs.readFileSync(snapshotPath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Upsert today's totals into the store (one snapshot per local day).
 * Keeps the most recent ~400, sorted by date ascending, and writes atomically
 * (tmp file + rename). SILENTLY no-ops on any fs error so startup never fails.
 */
export function recordSnapshot({ date, sessions, cost, tokens } = {}, dir) {
  try {
    const day = date || todayKey();
    const existing = readSnapshots(dir);
    const next = existing.filter((s) => s && s.date !== day);
    next.push({
      date: day,
      sessions: sessions || 0,
      cost: cost || 0,
      tokens: tokens || 0,
    });
    next.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const trimmed = next.slice(-MAX_SNAPSHOTS);

    const file = snapshotPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(trimmed));
    fs.renameSync(tmp, file);
    return trimmed;
  } catch {
    // Best-effort: never let snapshot persistence break the app.
    return readSnapshots(dir);
  }
}

/**
 * Count consecutive days (ending today, local time) that have a snapshot.
 * A gap before today yields 0; today + yesterday + ... counts until the first
 * missing day. Order-independent and tolerant of duplicate/garbage entries.
 */
export function computeStreak(snapshots, now = new Date()) {
  const days = new Set();
  for (const s of snapshots || []) {
    if (s && typeof s.date === 'string') days.add(s.date);
  }
  if (days.size === 0) return 0;
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Walk backwards from today while each day is present.
  for (;;) {
    if (!days.has(todayKey(cursor))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
