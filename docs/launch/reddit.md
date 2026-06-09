# Reddit

Lead with a GIF and a surprising finding about **your own** data. Be a person, not a press release. Reply to every comment in the first few hours. Post to **r/ClaudeCode first** (smaller, tool-tolerant), then r/ClaudeAI a few days later with different framing.

---

## r/ClaudeCode (and r/ClaudeAI later)

**Title:**
```
I built a free, local tool to search every Claude Code session I've ever run — and it showed me «97%» of my tokens are just cache reads
```

**Body:**
```
`claude --resume` only shows session IDs + timestamps — I could never find the
session where I'd already solved something. So I built ClaudeScope: a local
dashboard + full-text search over the transcripts already in ~/.claude.

`npx claudescope-cli` → opens in your browser. No install, no account, no
network (it binds to 127.0.0.1 and never uploads anything — MIT, zero deps).

A few things it surfaced about my own usage that surprised me:
- «97%» of my tokens are cache reads — caching "saved" me «~$14k» at list rates.
- My median session is «$2.5» but the top 10% are «$60+» — a brutal long tail.
- It also found my Codex and Copilot CLI logs and folded them in, so I can
  search across all my agents in one place.

What I actually use day to day is the search → click a result → read the whole
conversation in place. Plus there's an anonymized "Wrapped" card it renders
locally if you want to share your stats without sending data anywhere.

Numbers caveat: on a Max/Pro plan the $ are an API-equivalent estimate at list
rates, not a bill (the UI says so).

Repo + 30-sec demo: https://github.com/JoniMartin27/claudescope
Would love feedback / what you'd want it to show.
```

**Reply bank:**
- *How is the cost calculated?* → list API rates per model × your token volume (input/output/cache read+write multipliers). It's an estimate/intensity gauge, not your bill.
- *Does it send my data anywhere?* → No. 127.0.0.1, zero network, zero deps. There's an opt-in connector for real billed numbers, off by default.
- *vs ccusage?* → ccusage is the terminal cost king; this adds content search + a web dashboard + session replay + a local share card. Different job.
- *Other CLIs?* → Best-effort adapters for Codex/Cursor/Aider/Gemini/Copilot — picks them up if the logs are on disk.
