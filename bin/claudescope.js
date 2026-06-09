#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { findClaudeDir } from '../src/paths.js';
import { createServer } from '../src/server.js';
import { parseAllSources } from '../src/parser.js';
import { buildAnalytics } from '../src/analytics.js';
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
  npx claudescope --dir <path>    Point at a specific .claude directory
  npx claudescope --host 0.0.0.0  Expose on the LAN (phones) — see warning below
  npx claudescope --version       Print the version (-v)
  npx claudescope --help          Show this help (-h)

${C.bold}Privacy${C.reset}
  100% local. Reads your transcripts from disk, serves a dashboard on
  127.0.0.1, and never makes a single network request. Your data never leaves
  your machine. Using --host to bind anything other than 127.0.0.1/localhost
  exposes your full Claude history to everyone on the same network.
`);
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
