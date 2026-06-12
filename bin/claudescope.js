#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { findClaudeDir } from '../src/paths.js';
import { createServer } from '../src/server.js';
import { parseAllSources } from '../src/parser.js';
import { buildAnalytics, weekOverWeek } from '../src/analytics.js';
import { recordSnapshot, readSnapshots, computeStreak } from '../src/snapshots.js';
import { makeDump, mergeDumps } from '../src/merge.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const pkg = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);

function has(flag) {
  return args.includes(flag);
}
function opt(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
/**
 * Collect every value after a variadic flag up to the next flag (a token
 * starting with "-"). e.g. `--merge a.json ./team b.json --output x` -> the
 * three paths. Returns [] when the flag is absent.
 */
function optList(name) {
  const i = args.indexOf(name);
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < args.length; j++) {
    if (args[j].startsWith('-')) break;
    out.push(args[j]);
  }
  return out;
}

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m',
};

function banner() {
  console.log(`${C.cyan}${C.bold}
   ╔═╗┬  ┌─┐┬ ┬┌┬┐┌─┐╔═╗┌─┐┌─┐┌─┐┌─┐
   ║  │  ├─┤│ │ ││├┤ ╚═╗│  │ │├─┤├┤
   ╚═╝┴─┘┴ ┴└─┘─┴┘└─┘╚═╝└─┘└─┘┴ ┴└─┘${C.reset} ${C.dim}v${pkg.version}${C.reset}
   ${C.dim}Local-first analytics & search for your Claude Code sessions${C.reset}
`);
}

function help() {
  banner();
  console.log(`${C.bold}Usage${C.reset}
  npx claudescope                 Start the local dashboard (opens your browser)
  npx claudescope --port 4317     Use a custom port
  npx claudescope --no-open       Don't auto-open the browser
  npx claudescope --json          Print analytics as JSON to stdout and exit
  npx claudescope --json --output usage.json   Write the JSON to a file
  npx claudescope --weekly        Print a plain-text "Scope Report" and exit (no server)
  npx claudescope --dump-sessions me.json   Write your raw sessions for team mode (local)
  npx claudescope --merge ./team  Merge everyone's dumps (files/folders) -> combined JSON
  npx claudescope --dir <path>    Point at a specific .claude directory
  npx claudescope --host 0.0.0.0  Expose on the LAN (phones) — see warning below
  npx claudescope --version       Print the version (-v)
  npx claudescope --help          Show this help (-h)

${C.bold}Privacy${C.reset}
  100% local. Reads your transcripts from disk, serves a dashboard on
  127.0.0.1, and never makes a single network request. Your data never leaves
  your machine. Using --host to bind anything other than 127.0.0.1/localhost
  exposes your full Claude history to everyone on the same network.

${C.bold}Weekly ritual${C.reset}
  --weekly prints a concise text digest (week-over-week deltas, streak,
  archetype, top project, percentile) computed 100% locally — no server, no
  network. Append it to a log on a schedule:
    Windows (Task Scheduler / PowerShell):  claudescope --weekly >> scope.log
    macOS/Linux (cron, Mondays at 9am):     0 9 * * 1 claudescope --weekly >> ~/scope.log

${C.bold}Team mode (local, no server)${C.reset}
  Aggregate several machines'/people's usage with zero infrastructure — no
  upload, no server. Each person exports their raw sessions, drops the file in
  a shared folder (Drive/Dropbox/network share), then anyone merges them:
    1) everyone runs:   claudescope --dump-sessions me.json
    2) drop me.json into a shared folder
    3) anyone runs:     claudescope --merge ./team   (or: --merge a.json b.json)
  --merge reads the dumps, runs analytics over the combined set, and prints the
  merged JSON (or writes it with --output). Bad/non-matching files are skipped
  with a note. The dump is the raw sessions array (the analytics INPUT), since
  analytics output is already aggregated and can't be re-merged faithfully.
`);
}

/** Compact USD/token formatting for the plain-text digest. */
function fmtUsd(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}
/** Signed percent like "+12%" / "-4%" / "n/a" (null = no prior baseline). */
function fmtDelta(pct) {
  if (pct == null) return 'n/a';
  const r = Math.round(pct);
  return (r >= 0 ? '+' : '') + r + '%';
}

/**
 * Build the plain-text "Scope Report" digest. Plain ASCII (+ a couple emoji
 * accents) so it stays readable when piped to a file. `now` is injectable.
 */
function buildWeeklyDigest(analytics, snapshots, now = new Date()) {
  const wow = weekOverWeek(analytics, now);
  const streak = computeStreak(snapshots, now);
  const tw = wow.thisWeek;
  const lw = wow.lastWeek;
  const d = wow.deltaPct;
  const t = analytics.totals || {};
  const arch = (analytics.archetype && analytics.archetype.name) || 'Unclassified';
  const topProject = (analytics.byProject && analytics.byProject[0]) || null;
  const pct = t.percentile || {};

  const lines = [];
  lines.push('ClaudeScope — Weekly Scope Report');
  lines.push(now.toISOString().slice(0, 10));
  lines.push('='.repeat(40));
  lines.push('');
  lines.push('This week vs last week:');
  lines.push(`  Cost:     ${fmtUsd(tw.cost)} vs ${fmtUsd(lw.cost)}   (${fmtDelta(d.cost)})`);
  lines.push(`  Tokens:   ${fmtTokens(tw.tokens)} vs ${fmtTokens(lw.tokens)}   (${fmtDelta(d.tokens)})`);
  lines.push(`  Sessions: ${tw.sessions} vs ${lw.sessions}   (${fmtDelta(d.sessions)})`);
  lines.push('');
  lines.push(`🔥 Streak:    ${streak} day${streak === 1 ? '' : 's'}`);
  lines.push(`Archetype:    ${arch}`);
  if (topProject) {
    lines.push(`Top project:  ${topProject.label || topProject.path || '(unknown)'} (${fmtUsd(topProject.cost)} all-time)`);
  } else {
    lines.push('Top project:  (none yet)');
  }
  if (pct.label) {
    lines.push(`Percentile:   You're in the ${pct.label} of Claude Code token usage (heuristic).`);
  }
  lines.push('');
  lines.push(`All-time: ${t.sessions || 0} sessions · ${fmtTokens(t.tokens)} tokens · ${fmtUsd(t.cost)}`);
  return lines.join('\n');
}

/** Best-effort machine LAN IPv4 (first non-internal), or null. */
function lanIPv4() {
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const i of list || []) {
        const fam = typeof i.family === 'number' ? i.family === 4 : i.family === 'IPv4';
        if (fam && !i.internal) return i.address;
      }
    }
  } catch {
    /* no-op */
  }
  return null;
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const cmdArgs = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', shell: platform === 'win32' }).unref();
  } catch {
    /* no-op: user can open manually */
  }
}

async function main() {
  if (has('--version') || has('-v')) {
    process.stdout.write(pkg.version + '\n'); // bare + machine-parseable
    return;
  }
  if (has('--help') || has('-h')) return help();

  // Team mode (local): merge session dumps from files/dirs. This needs no
  // Claude data directory of its own — it reads the shared dump files. 100%
  // local, zero network.
  if (has('--merge')) {
    const paths = optList('--merge');
    if (!paths.length) {
      console.error(
        `${C.yellow}--merge needs one or more paths (files and/or folders of session dumps).${C.reset}\n` +
          `Example: claudescope --merge ./team   (folder of *.json dumps)`
      );
      process.exit(1);
    }
    const { sessions, loaded, skipped } = mergeDumps(paths, {
      onSkip: (file, reason) => console.error(`${C.yellow}skip${C.reset} ${file} — ${reason}`),
    });
    if (!loaded.length) {
      console.error(
        `${C.yellow}No valid session dumps found.${C.reset} ` +
          `Each person should run: claudescope --dump-sessions me.json`
      );
      process.exit(1);
    }
    const totalDumpSessions = loaded.reduce((n, l) => n + l.count, 0);
    console.error(
      `Merged ${loaded.length} dump${loaded.length === 1 ? '' : 's'} ` +
        `(${totalDumpSessions} sessions${skipped.length ? `, skipped ${skipped.length}` : ''}).`
    );
    const json = JSON.stringify(buildAnalytics(sessions), null, 2);
    const outFile = opt('--output', null) || opt('-o', null);
    if (outFile) {
      fs.writeFileSync(outFile, json + '\n'); // utf8, no BOM
      console.error(`Wrote merged analytics to ${outFile}`);
    } else {
      process.stdout.write(json + '\n');
    }
    return;
  }

  const explicitDir = opt('--dir', null);
  const claudeDir = explicitDir || findClaudeDir();
  if (!claudeDir) {
    console.error(
      `${C.yellow}Could not find a Claude Code data directory.${C.reset}\n` +
        `Looked for a "projects" folder under ~/.claude (and CLAUDE_CONFIG_DIR).\n` +
        `Pass one explicitly with: claudescope --dir <path-to-.claude>`
    );
    process.exit(1);
  }
  // findClaudeDir() already verified projects/, but an explicit --dir bypasses
  // that — validate it here so we fail with a friendly message, not an ENOENT
  // (or an ENOTDIR if "projects" exists but is a file / broken symlink).
  if (explicitDir) {
    let st;
    try {
      st = fs.statSync(path.join(claudeDir, 'projects'));
    } catch {
      /* missing */
    }
    if (!st || !st.isDirectory()) {
      console.error(
        `${C.yellow}No "projects" folder found under ${claudeDir}.${C.reset}\n` +
          `Point --dir at your .claude directory (the one that contains a "projects" folder).`
      );
      process.exit(1);
    }
  }

  if (has('--json')) {
    const { sessions } = await parseAllSources(claudeDir);
    const json = JSON.stringify(buildAnalytics(sessions), null, 2);
    const outFile = opt('--output', null) || opt('-o', null);
    if (outFile) {
      fs.writeFileSync(outFile, json + '\n'); // utf8, no BOM
      console.error(`Wrote analytics to ${outFile}`);
    } else {
      process.stdout.write(json + '\n');
    }
    return;
  }

  // Team mode (local): dump the RAW normalized sessions array — the shareable
  // unit for merging. Analytics output is aggregated/lossy and can't be
  // re-merged faithfully, so we write the buildAnalytics INPUT instead.
  if (has('--dump-sessions')) {
    const outFile = opt('--dump-sessions', null);
    if (!outFile) {
      console.error(`${C.yellow}--dump-sessions needs a file path, e.g. claudescope --dump-sessions me.json${C.reset}`);
      process.exit(1);
    }
    const { sessions } = await parseAllSources(claudeDir);
    const dump = makeDump(sessions, { source: opt('--label', null) || os.hostname() });
    fs.writeFileSync(outFile, JSON.stringify(dump) + '\n'); // utf8, no BOM
    console.error(`Wrote ${sessions.length} sessions to ${outFile} (share it; then: claudescope --merge <folder>)`);
    return;
  }

  if (has('--weekly')) {
    const { sessions } = await parseAllSources(claudeDir);
    const analytics = buildAnalytics(sessions);
    // Record today's snapshot so streaks accrue when the digest runs on a
    // schedule (best-effort, local-only, never touches the network).
    recordSnapshot({
      sessions: analytics.totals.sessions,
      cost: analytics.totals.cost,
      tokens: analytics.totals.tokens,
    });
    const digest = buildWeeklyDigest(analytics, readSnapshots());
    process.stdout.write(digest + '\n');
    return; // exit 0
  }

  banner();
  const port = parseInt(opt('--port', '4317'), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`${C.yellow}Invalid --port "${opt('--port', '')}". Use a number between 1 and 65535.${C.reset}`);
    process.exit(1);
  }
  const host = opt('--host', '127.0.0.1');
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const { server } = await createServer(claudeDir, {
    onLog: (m) => console.log(`   ${C.dim}${m}${C.reset}`),
    host,
  });

  server.listen(port, host, () => {
    // For a local bind, the loopback URL is the real one. For a LAN bind
    // (e.g. 0.0.0.0) point at the machine's LAN IPv4 so phones can reach it.
    const lanIp = isLocal ? null : lanIPv4();
    const displayHost = isLocal ? host : lanIp || host;
    const url = `http://${displayHost}:${port}`;
    if (!isLocal) {
      console.log(
        `\n   ${C.yellow}${C.bold}⚠ Exposing your Claude history on the local network at ${url} — ` +
          `anyone on this Wi-Fi can read it. Ctrl+C to stop.${C.reset}`
      );
    }
    console.log(`\n   ${C.green}${C.bold}➜${C.reset}  Dashboard ready at ${C.cyan}${C.bold}${url}${C.reset}`);
    if (!isLocal && lanIp) {
      console.log(`   ${C.dim}Open this on your phone: ${C.reset}${C.cyan}http://${lanIp}:${port}${C.reset}`);
    }
    console.log(`   ${C.dim}Press Ctrl+C to stop.${C.reset}\n`);
    // Only auto-open a browser for the local bind (a LAN bind is for phones).
    if (!has('--no-open') && isLocal) openBrowser(`http://${host}:${port}`);
  });

  // Clean shutdown on Ctrl+C / termination.
  const shutdown = () => {
    console.log(`\n   ${C.dim}Shutting down. Bye 🔭${C.reset}`);
    console.log(`   ${C.dim}Useful? ⭐ ${C.reset}${C.cyan}https://github.com/JoniMartin27/claudescope${C.reset}${C.dim} — or report a bug there.${C.reset}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`${C.yellow}Port ${port} is already in use. Try: claudescope --port ${port + 1}${C.reset}`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
