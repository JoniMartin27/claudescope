# Show HN

**When:** Tue–Thu, ~9–10am ET. Block 2 hours to reply. One shot — make sure the README leads with search and the GIF shows a search, not the stat cards.

## Title (search-led, ≤ 80 chars)

```
Show HN: ClaudeScope – full-text search across every Claude Code session (npx, local)
```

Alternatives:
```
Show HN: Search and replay your entire Claude Code history – npx, zero deps, local
Show HN: I couldn't find a session I'd solved with Claude Code, so I built search
```

## First comment (post immediately, before any votes)

```
I use Claude Code a lot, and the thing that finally annoyed me enough to build
this: I *knew* I'd solved some gnarly bug with it a few weeks earlier, but
`claude --resume` only shows session IDs and timestamps — no content, no
cross-project search. The answer was sitting in gigabytes of .jsonl under
~/.claude/projects/ that I couldn't grep.

ClaudeScope is `npx claudescope-cli` → a browser dashboard built entirely from
those local transcripts. The part I actually use is full-text search across
every prompt, reply and tool call, with a click-to-read replay of the session
it found. It also surfaces the usage you otherwise can't see (tokens, an
API-equivalent cost estimate, what caching saved you, per-model/per-project
spend, a weekday×hour heatmap), and generates an anonymized "Wrapped" card
that's rendered locally so you can post it without uploading anything.

Honest positioning vs the obvious comparison: ccusage owns terminal cost
reporting and I'm not trying to beat it there. My itch was retrieval +
auditability. Design choices that follow from that:
- Zero dependencies — it's pure Node stdlib, you can read every line in 5 min.
- Zero network — it binds to 127.0.0.1 and never phones home; disconnect your
  Wi-Fi and it works identically. (There's an opt-in, off-by-default connector
  if you want real billed numbers from the Anthropic usage API.)
- It also parses other agent CLIs' logs (Codex/Cursor/Aider/Gemini/Copilot) if
  they're on disk, so it's "search across all your agents."

One pre-empt on the numbers: most of us are on a flat Max/Pro plan, so the
dollar figures are an *API-equivalent estimate at list rates*, not a bill — the
UI says so. The "top X% of token users" badge is likewise a rough offline
heuristic, not measured population data.

Repo (MIT): https://github.com/JoniMartin27/claudescope
It's `npx claudescope-cli`. Happy to answer anything.
```

## Be ready for these comments
- *"isn't this just ccusage?"* → No content search, no web UI, no replay; different job (retrieval/audit vs cost). Friendly, not defensive.
- *"the cost is wrong / that's not what I pay"* → Yep — it's an API-equivalent estimate at list rates, labeled as such; it's an intensity gauge, not a bill.
- *"CCHV already does search + analytics"* → True; it's a heavier desktop app (download/brew/Docker/Rust). The delta here is `npx`, zero-deps, zero-install, and the offline share card.
- *"privacy?"* → 127.0.0.1 only, zero deps to audit, read the source. `--host` for phones is opt-in with a loud warning.
