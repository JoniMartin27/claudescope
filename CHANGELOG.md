# Changelog

All notable changes to ClaudeScope are documented here. This project follows
[Semantic Versioning](https://semver.org).

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
