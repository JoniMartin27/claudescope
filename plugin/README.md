# ClaudeScope — Claude Code plugin

Launch [ClaudeScope](https://github.com/JoniMartin27/claudescope) — a **100% local**
analytics & full-text search dashboard for your Claude Code sessions — without leaving
Claude Code.

This plugin is just config: a manifest plus two slash commands that shell out to the
`claudescope-cli` npm package via `npx`. It ships **no code** and makes **no network
requests** itself; the dashboard it launches reads your transcripts from disk and serves
on `127.0.0.1` only.

## Commands

| Command | What it does |
|---|---|
| `/claudescope` | Starts the local dashboard (`npx -y claudescope-cli`) and opens it in your browser. Reads `~/.claude/projects/**` from disk, serves on `127.0.0.1`, zero network. |
| `/claudescope:wrapped` | Computes your headline numbers (`npx -y claudescope-cli --json`) — sessions, tokens, est. cost, cache savings, coding archetype, top-% — and writes a copy-paste shareable blurb. Points you to the dashboard's **Share card** button for the image version. |

## Install

### Option A — plugin marketplace (recommended)

From inside Claude Code:

```
/plugin marketplace add JoniMartin27/claudescope
/plugin install claudescope
```

### Option B — copy it in manually

Copy this `plugin/` directory into your Claude Code plugins folder so the manifest lands at
`~/.claude/plugins/claudescope/.claude-plugin/plugin.json`:

```sh
# macOS / Linux
mkdir -p ~/.claude/plugins/claudescope
cp -r plugin/. ~/.claude/plugins/claudescope/
```

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\plugins\claudescope" | Out-Null
Copy-Item -Recurse -Force plugin\* "$env:USERPROFILE\.claude\plugins\claudescope\"
```

Then restart Claude Code (or reload plugins) and run `/claudescope`.

## Requirements

- Node.js >= 18 (for `npx` / the `claudescope-cli` package).
- Some Claude Code history under `~/.claude/projects/` to analyze.

## Privacy

Everything runs locally. ClaudeScope reads your transcripts from disk, serves a dashboard on
`127.0.0.1`, and never makes a single network request. Your data never leaves your machine.
