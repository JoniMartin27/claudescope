#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { findClaudeDir } from '../src/paths.js';
import { createServer } from '../src/server.js';
import { parseAll } from '../src/parser.js';
import { buildAnalytics } from '../src/analytics.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

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
  npx claudescope --dir <path>    Point at a specific .claude directory
  npx claudescope --help          Show this help

${C.bold}Privacy${C.reset}
  100% local. Reads your transcripts from disk, serves a dashboard on
  127.0.0.1, and never makes a single network request. Your data never leaves
  your machine.
`);
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
  if (has('--help') || has('-h')) return help();

  const claudeDir = opt('--dir', null) || findClaudeDir();
  if (!claudeDir) {
    console.error(
      `${C.yellow}Could not find a Claude Code data directory.${C.reset}\n` +
        `Looked for a "projects" folder under ~/.claude (and CLAUDE_CONFIG_DIR).\n` +
        `Pass one explicitly with: claudescope --dir <path-to-.claude>`
    );
    process.exit(1);
  }

  if (has('--json')) {
    const { sessions } = await parseAll(claudeDir);
    process.stdout.write(JSON.stringify(buildAnalytics(sessions), null, 2) + '\n');
    return;
  }

  banner();
  const port = parseInt(opt('--port', '4317'), 10);
  const { server } = await createServer(claudeDir, { onLog: (m) => console.log(`   ${C.dim}${m}${C.reset}`) });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n   ${C.green}${C.bold}➜${C.reset}  Dashboard ready at ${C.cyan}${C.bold}${url}${C.reset}`);
    console.log(`   ${C.dim}Press Ctrl+C to stop.${C.reset}\n`);
    if (!has('--no-open')) openBrowser(url);
  });

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
