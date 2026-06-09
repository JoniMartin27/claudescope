# Changelog

All notable changes to ClaudeScope are documented here. This project follows
[Semantic Versioning](https://semver.org).

## 0.5.0

### Added
- **Jump to message** — opening a session from a search result now scrolls to
  and highlights the matched message inside the replay view (completes find→read).
- **`--weekly` digest** — a plain-text "Scope Report" (this week vs last,
  streak, archetype, top project, percentile) for a cron / Task Scheduler ritual.
  Computed locally; no server, no network.
- **HTML report export** — a single self-contained `.html` report (inline
  styles, opens offline) from the Export menu, respecting the active date range.
- **Local team mode** — `--dump-sessions <file>` writes a shareable raw-session
  dump; `--merge <paths…>` aggregates several dumps locally into combined
  analytics. Zero infrastructure, nothing uploaded.
- **`docs/EXTENDING.md`** — the source-adapter contract for adding custom data
  sources and panels, plus contribution rules.

## 0.4.0

### Added
- **Multi-CLI support** — ClaudeScope now also parses other agent CLIs' local
  logs when present (OpenAI Codex, Cursor, Aider, Gemini CLI, GitHub Copilot
  CLI) via a pluggable `src/sources/` adapter architecture, normalized into the
  same shape and tagged by source. Claude Code parsing is unchanged. A source
  legend/filter appears only when more than one source is detected; "search
  across all your agents." Non-Claude adapters are best-effort/experimental.
- **Offline percentile badge** — "~top X% of token users (est.)", computed
  100% offline from a heuristic distribution table shipped in the package
  (clearly labeled as a rough estimate, not measured population data). Shown on
  the dashboard and the Wrapped card.
- **Claude Code plugin** (`plugin/`) — `/claudescope` (launch the dashboard) and
  `/claudescope:wrapped` (summarize your stats) slash commands, plus a
  marketplace manifest so `/plugin marketplace add JoniMartin27/claudescope`
  works.
- **Comparison / SEO landing page** (`website/`) — a static, dependency-free
  GitHub-Pages-ready site leading with search + privacy, with an honest
  ClaudeScope-vs-ccusage-vs-CCHV-vs-Sniffly-vs-tokscale comparison table.

## 0.3.0

### Added
- **Installable PWA.** A web-app manifest and offline service worker mean you
  can install ClaudeScope from your browser's address bar (desktop) or
  **Add to Home Screen** (mobile) and launch it in a standalone window. The
  shell works offline after the first load — still 100% local, zero network.
- **Compact widget view** — `/widget.html`, a stripped-down at-a-glance panel
  (key stat cards) for pinning in a small window or a phone home screen.
- **LAN access via `--host`** — `npx claudescope-cli --host 0.0.0.0` binds to
  your machine's LAN address and prints a phone-reachable URL, so you can open
  the dashboard on your phone. **Opt-in and loud about it:** binding anything
  other than `127.0.0.1` exposes your full Claude history to everyone on the
  same network, and the CLI warns you accordingly. Default stays loopback-only.
- **API-cost mode** — a local relabel toggle that reframes the estimated cost
  as "API cost at list rates" (stored in `localStorage`, no behavior change to
  the numbers). Plus an **opt-in Anthropic Usage API connector**
  (`/api/anthropic-usage`) that fetches your real billed usage — **off by
  default**, only fires on an explicit click, and only works if you set
  `ANTHROPIC_ADMIN_KEY`. The default dashboard still makes zero network calls.
- **ClaudeScope Wrapped** — a shareable, **anonymized** year-in-review card
  generated **entirely client-side** (no upload, no project names, no content).
- **Insights one-liners + coding archetype** — plain-language takeaways about
  your usage, and a fun archetype derived from your patterns.
- **Weekly momentum + streaks** — week-over-week trend and active-day streaks.
- **Regex search + range diff** — search with regular expressions, and diff
  usage between two date ranges.

## 0.2.0

### Fixed (correctness)
- **Critical: dedupe assistant usage by `message.id`.** Claude Code writes one
  JSONL line per content block of a single assistant response, each repeating the
  same message-level `usage`. Counting per line inflated every token/cost number
  by ~2–3×. Usage, cost, reply counts and the heatmap are now counted once per
  logical message. (Real-corpus example: ~$6.4k → ~$2.3k.)

### Added
- **Session detail view** — click any top session or search result to read the
  full conversation (prompts, replies, tool calls) in a modal.
- **Date-range filter** — scope the whole dashboard to 7d / 30d / 90d / All.
- **Cache efficiency stats** — cache hit-rate and "saved by caching" headline.
- **Typical session** panel — median / p90 cost, messages and duration.
- **Interrupted-session detection** — surfaces sessions you stopped mid-reply.
- **Timeline metric toggle** — view daily activity by cost or by tokens.
- **Export menu** — Markdown summary, per-day CSV, or raw JSON.
- **Richer search** — indexes tool-call inputs and flags errors; `/api/search`
  gains `role`, `project`, `limit` params and returns `total` / `truncated`.
- **Programmatic API** — `import { analyze } from 'claudescope-cli'`.
- `--version` / `-v`, `--output <file>` for `--json`, and graceful Ctrl+C.

### Changed
- Locale-aware number, currency and date formatting (via `Intl`).
- Skeleton loading state; `prefers-reduced-motion` honored globally.
- Server: exact-path routing, JSON 404s for `/api/*`, ETag + cached payloads.

## 0.1.0
- Initial release: usage stats, per-model spend, per-project breakdown, tool
  leaderboard, weekday×hour heatmap, cost timeline, and full-text search —
  zero-dependency, 100% local, `npx claudescope-cli`.
