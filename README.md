<div align="center">

<img src="docs/hero.svg" alt="ClaudeScope — local-first analytics & full-text search for your Claude Code sessions" width="100%" />

# 🔭 ClaudeScope

**See where your Claude Code time, tokens and money actually go — and search every session you've ever run.**

[![tests](https://img.shields.io/badge/tests-passing-4ade80)](test/)
[![npm](https://img.shields.io/npm/v/claudescope?color=cb3837&logo=npm)](https://www.npmjs.com/package/claudescope)
[![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-success)](package.json)
[![100% local](https://img.shields.io/badge/data-100%25%20local-4ade80)](#-privacy-first)

```bash
npx claudescope
```

*That's it. No install, no config, no account, no network. Your browser opens a dashboard built entirely from the transcripts already on your disk.*

</div>

---

## The problem

If you use [Claude Code](https://claude.com/claude-code), you've quietly generated **gigabytes of session transcripts** sitting in `~/.claude/projects/` — every prompt, every reply, every tool call, every token. And you can see **none of it**:

- 💸 *How many tokens am I actually burning? What would that cost on the API?*
- 🗂️ *Which projects eat the most of my Claude time?*
- 🛠️ *Which tools does Claude lean on — Bash, Edit, Read…?*
- ⏰ *When am I most productive with it?*
- 🔎 *"I solved this exact bug with Claude three weeks ago… in which session?"*

That data is locked inside thousands of raw `.jsonl` lines. **ClaudeScope unlocks it** — turning your local history into a fast, private, beautiful dashboard, with full-text search across everything.

## What you get

| | |
|---|---|
| 📊 **Usage at a glance** | Sessions, messages, tokens and estimated API-equivalent cost as headline stats. |
| 🍩 **Token mix** | Input vs. output vs. cache read/write — see exactly where your tokens go (hint: it's mostly cache). |
| 🗂️ **Per-project breakdown** | Cost and tokens ranked by project, so you know what's actually expensive. |
| 🤖 **Model split** | Opus vs. Sonnet vs. Haiku usage across all your work. |
| 🛠️ **Tool leaderboard** | The tools Claude reaches for most, ranked. |
| 🔥 **Activity heatmap** | Your coding rhythm by weekday × hour of day. |
| 📈 **Cost timeline** | Spending trend across your last 60 active days. |
| 🔎 **Full-text search** | Instantly grep every prompt, reply and tool call across **all** sessions, with highlighting. |

## Quick start

```bash
# Run it (Node 18+)
npx claudescope

# Custom port, don't auto-open the browser
npx claudescope --port 4400 --no-open

# Pipe the raw analytics somewhere else
npx claudescope --json > usage.json

# Point at a non-default location
npx claudescope --dir /path/to/.claude
```

ClaudeScope auto-detects your Claude Code data directory (it honors `CLAUDE_CONFIG_DIR`, then falls back to `~/.claude`). It reads the transcripts, builds the dashboard in memory, and serves it on `127.0.0.1`.

## 🔒 Privacy first

This is the whole point:

- **Zero network requests.** ClaudeScope never phones home, never uploads, never analytics-pings. Disconnect your Wi-Fi and it works identically.
- **Read-only.** It only ever *reads* your transcript files. It never modifies or deletes them.
- **Local-only server.** Binds to `127.0.0.1` — not reachable from your network.
- **Zero runtime dependencies.** Pure Node.js standard library. Nothing in `node_modules` to audit. [Read every line](src/) in five minutes.

Your AI coding history is some of the most sensitive data you own. It should never leave your machine to be understood — so it doesn't.

## About the cost numbers

Most Claude Code users are on a flat-rate **Max** or **Pro** subscription, so the dollar figures are **not a bill**. They estimate what your token volume *would* cost on the pay-as-you-go Anthropic API at list prices — a relative gauge of intensity, not money spent. Cache reads and writes are priced with Anthropic's published multipliers (0.1× and 1.25× the input rate).

## How it works

```
~/.claude/projects/<encoded-path>/<session>.jsonl
        │
        ▼
   src/parser.js     ← streams each transcript line-by-line (handles 50k-line files,
        │              tolerates malformed lines, extracts model/usage/tools/text)
        ▼
  src/analytics.js   ← aggregates totals, projects, models, tools, days, heatmap
        │
        ▼
   src/server.js     ← tiny stdlib HTTP server: /api/analytics, /api/search
        │
        ▼
     public/         ← dependency-free dashboard (vanilla JS + SVG charts)
```

No framework, no bundler, no database. It parses ~35k messages in well under two seconds.

## Roadmap

- [ ] Session detail view (full conversation replay)
- [ ] Export a shareable, anonymized usage card
- [ ] Diff usage between date ranges
- [ ] Per-day token/cost CSV export
- [ ] Support for other agent CLIs that log JSONL

Ideas and PRs welcome — see [the issues](https://github.com/JoniMartin27/claudescope/issues).

## Contributing

```bash
git clone https://github.com/JoniMartin27/claudescope
cd claudescope
node --test          # run the test suite (zero install needed)
npm start            # launch the dashboard against your own data
```

The codebase is deliberately tiny and dependency-free. If you add a feature, add a test for it.

## License

[MIT](LICENSE) © [Joni Martin](https://github.com/JoniMartin27)

<div align="center">

**If ClaudeScope showed you something surprising about your own usage, give it a ⭐ — it genuinely helps other Claude Code users find it.**

</div>
