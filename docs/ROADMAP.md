# ClaudeScope — Strategy & Roadmap

> Internal strategy doc. Honest, opinionated, and meant to be acted on — not a marketing page.

## 1. TL;DR

**Positioning (one line):** *ccusage tells you what you spent; ClaudeScope lets you search what you actually did — full-text search across every Claude Code session you've ever run, in your browser, zero install, zero network. (Plus the usage dashboard ccusage won't give you.)*

**The single biggest opportunity:** a **100%-local, anonymized "ClaudeScope Wrapped" share card** — the one artifact that turns a saturated analytics niche into a growth loop. The card is the on-ramp; **full-text search + session replay is why people stay**. Lead with search, spread with the card.

**The one strategic warning:** the current README leads with cost ("time, tokens and money"). That is the *losing half* — it invites a head-to-head with ccusage (15k+ stars) that we lose, and we then disarm our own cost pitch ("not a bill") two screens later. **Re-headline around search + privacy.**

---

## 2. Who it's for & the wedge

**Not** "developers who use Claude Code" — too broad, and the cost-curious already have ccusage. The sharp ICP:

> **The Claude Code power user on a flat-rate Max/Pro plan who runs many sessions across many projects and keeps re-solving problems they already solved — because they can't find the session where they did it.**

Three qualifiers that make the wedge bite:

1. **High-volume** — gigabytes of transcripts. Light users have nothing to search.
2. **Flat-rate subscriber** — cost numbers are *not a bill*, which neutralizes the cost pitch for exactly the heaviest users. For them, **search is the value**.
3. **Multi-project** — memory fragments across `~/.claude/projects/<n>/`, and `claude --resume` shows only session IDs/timestamps with **no content preview and no cross-project search**. That is the documented, real pain.

**The wedge, in one install line:**

```
npx claudescope-cli
```

> Full-text search across every Claude Code session you've ever run, in your browser, with zero install and zero network — plus the usage dashboard ccusage won't give you.

**The job we win is recall, not cost.**

| Job-to-be-done | Verdict |
|---|---|
| Cost visibility | Lose — ccusage owns it; for the ICP it isn't even a bill. |
| Team / org insight | Don't try — Anthropic's official Team dashboard + Analytics API own it; structurally wrong for a single-machine local tool. |
| **Recall — "find the session where I solved this"** | **Win this.** Real, repeated, documented pain; competitors here are tiny and ugly. We can be the prettiest, zero-friction one. |

Analytics is the *supporting act* — the "surprising on first run" hook that earns the star and the install. **Search is why it stays installed.**

---

## 3. Competitive reality

The niche has bifurcated into two crowded lanes plus one urgent brand problem.

### Lane 1 — Cost/usage analytics (we are a late, weaker entrant)
- **ccusage** (ryoppippi, ~13–16k stars) — the de-facto standard. `npx ccusage`, daily/weekly/session reports, per-model breakdown, 5-hour billing windows, live `blocks`, statusline, JSON export, MCP, and 15+ agent CLIs. **Terminal-only. No full-text search. No web UI.**
- **tokscale** (junhoyeo) — Rust, 30+ CLIs, and already ships the viral trio: public leaderboard with contribution graphs, embeddable SVG profile cards, and a "Wrapped" year-in-review. **But its `submit` uploads your data to a server.**
- **Sniffly** (Chip Huyen, ~1.2k) — browser dashboard + error analysis + browsable history. Python (needs an env).
- **Clawdmeter** (TechCrunch, May 2026), **phuryn/claude-usage** (~1.8k, localhost dashboard, Python stdlib, zero-dep), VS Code extensions, plus Anthropic's **official analytics dashboard + Admin Analytics API**.

We will **not** win on cost visibility. Stop leading with it.

### Lane 2 — Session search / browse / recall (fragmented, no dominant winner)
- **CCHV — claude-code-history-viewer** (jhlee0409, ~1.5k) — the closest competitor: global full-text search **and** analytics, 9 providers, 100% offline. **But it's a heavy desktop app** (download / brew / Docker / Rust toolchain).
- **claude-history** (raine), **agsoft VS Code ext**, **cc-search**, **claude-vault**, the **/recall skill** — mostly tiny, CLI-only, or dependency/Docker-heavy.

### The brand collision (urgent)
**`claudescope.dev`** is an existing **commercial SaaS literally named "ClaudeScope"** doing Claude Code cost attribution for teams ($19–$999/mo, cloud + GitHub OAuth). Plus **Anthropic's own "Session Memory" feature** muddies the "memory" framing. Our npm name `claudescope-cli` dodges the literal npm collision, but the brand/SEO collision is real.

### Where we win (presentation/distribution edges, honestly not feature edges)
1. **`npx` → browser dashboard, zero install, zero deps, zero network.** ccusage has no web UI; CCHV is a heavy download; phuryn/Sniffly are Python. The "one command, no download, pure-Node-stdlib, browser dashboard" combination is **unoccupied**.
2. **Full-text search over transcript *content*** — the thing ccusage and tokscale structurally don't do. This is the only durable moat.
3. **Auditable-in-5-minutes / disconnect-your-Wi-Fi privacy** — a real trust differentiator for sensitive AI history, and the killer twist vs tokscale (whose card upload sends your data away).

### The gap we own
**Beautiful, zero-friction, local search + replay of your transcript history — with a shareable card you generate without surrendering your data.** Nobody combines all of: web dashboard + content search + session replay + offline share card.

**Resolved contradictions from the analysts:**
- *Rename vs keep the name?* **Keep "ClaudeScope" but manage the gap.** A rename forfeits any equity already built and the npm token is owned. Mitigate the `claudescope.dev` collision by (a) owning the **search** keyword space where the SaaS doesn't compete, (b) a comparison/landing page, and (c) always pairing brand with the repo URL + `npx claudescope-cli` verbatim. Revisit only if Anthropic tightens "claude*" trademark policy.
- *Star counts differ across analysts (ccusage 4.8k / 13.2k / 15.8k; tokscale, CCHV, Sniffly).* Treat exact numbers as stale-prone; the **ordinal truth is stable**: ccusage is dominant, tokscale is the viral-card threat, CCHV is the analytics+search threat. Plan against the ranking, not the digits.

---

## 4. Roadmap — 0.2 / 0.5 / 1.0

Sequenced by leverage. Depth first (sharpen the moat), then virality (spread), then breadth/durability (last). **⭐ = word-of-mouth feature.**

### 0.2 — "Make the wedge undeniable" (depth, not breadth)
Mostly UI on analytics already computed. Ship fast.

- **Session detail / conversation replay view** — threaded replay of one session (prompts, replies, tool calls, per-message tokens/cost). Every search result needs somewhere to *land*; this converts search from "grep with highlighting" into "navigate your own history." Highest-leverage non-viral feature.
- **Search that beats grep** — filters (project, model, date range, role, tool), regex toggle, and "jump to this message in the replay view." This is the feature **no competitor has**; invest here, not in a 17th CLI.
- **Diff usage between two date ranges** — cheap on existing aggregation; answers the real power-user question ("did switching models change my burn?").
- **Per-day token/cost CSV/JSON export** — table-stakes parity with ccusage `--json`; trivial.

### 0.5 — "Make it spread" (the word-of-mouth release)
This release decides 200 stars vs 5,000. Everything here manufactures a shareable artifact and a reason to post.

- **⭐ ClaudeScope Wrapped share card** — a single 1200×630 PNG (OG-image dimensions, so it renders in social previews) generated **100% locally**. Headline number: total sessions/tokens + **API-equivalent $ "Max saved me"** (screenshot gold); token-mix donut (the "it's mostly cache" surprise); top tools; busiest weekday×hour; mini heatmap. Footer watermark: `🔭 ClaudeScope · npx claudescope-cli`. **This is the single highest-leverage build in the whole roadmap** — promote it from a README checkbox to *the* headline of 0.5.
- **⭐ Privacy-as-the-differentiator, on the card itself** — no project names, no paths, no prompts; only aggregate numbers. Print "100% local · nothing left my machine" *on the card*. This is the one thing tokscale's uploading card can't credibly claim. It's the differentiated hook for r/ClaudeAI, HN, and dev.to.
- **⭐ A derived "archetype"** — don't clone ccwrapped's six; derive ours from data we have well (cache-ratio → "The Context Hoarder"; search/Read-heavy → "The Investigator"; Bash-heavy → "The Automator"). The archetype is the meme unit that travels.
- **Insights one-liners** — auto-generated surprising facts ("71% of your tokens are cache reads," "Tuesday 3pm is your peak," "Project X costs 4× project Y"). The README's own "show you something *surprising*" line is the growth loop — make the surprise first-class and screenshottable.
- **Weekly "Scope Report" digest + streaks (retention)** — "this week vs last week" deltas, a contribution-style activity graph, and a `🔥 N-week streak` counter. Persist a tiny local `~/.claudescope/snapshots.json` (the *only* state, still no DB, still offline). Optional `claudescope --weekly` for a cron/Task Scheduler ritual. The comparison and streak only exist if you return — that's the habit.

**Sequencing rationale:** the card needs 0.2's depth to feel substantial and needs trends/insights to have something worth putting *on* it. Build it earlier → thin artifact; later → wasted virality window.

### 1.0 — "Make it a platform you can trust and extend" (breadth, durability)
- **⭐ Offline percentile badge** — "You're in the top 8% of Claude Code token users this month 🔭," computed **100% offline** from a static distribution table shipped in the package. Rank is more shareable than a raw number, and we keep the zero-network promise intact. (Do **not** ship a server leaderboard by default — that's tokscale's game and torches our one durable advantage.)
- **Multi-agent-CLI support** (Codex, Cursor, Aider, Gemini CLI, Copilot CLI) — **now, not in 0.2.** Per-tool JSONL parsers are pure breadth with no moat. By 1.0 our search+replay+card depth is set, so new sources *extend* a loved tool instead of starting a breadth race against tokscale's 30+. Frame it **"search across all your agents," not "count tokens across all your agents."**
- **Exportable reports** — a self-contained HTML/PDF month/quarter usage report; the manager-facing artifact and bridge to any future commercial story.
- **Local team merge (no server)** — point ClaudeScope at multiple exported `--json` dumps / a shared folder and aggregate locally. The only local-first answer to Anthropic's enterprise dashboard, for the vocal segment that refuses to send data upstream.
- **Plugin / extension hook** — documented contracts for custom data-source parsers and custom dashboard panels. Our tiny zero-dep architecture is ideal for it; turns community breadth into PRs instead of forks.
- **Claude Code plugin distribution** — a `/claudescope:wrapped` slash command that pops the card inside the tool people already live in. ccwrapped's entire distribution is a slash command — far lower friction than remembering an `npx` line.
- **Hosted sync — explicitly opt-in, explicitly last, or skip.** Only if users ask, and only encrypted + self-hostable + off by default. Honest recommendation: **resist it.** It's tokscale's game and forfeits the "100% local" brand that is our entire differentiator.

### Leverage-ranked summary

| Priority | Feature | Why |
|---|---|---|
| 1 | ⭐ Local anonymized Wrapped card + archetype | Proven viral mechanic + a privacy twist no competitor can copy. The growth engine. |
| 2 | Session replay / detail view | Turns search from grep into navigation; gives every result a home. |
| 3 | Search that beats grep (filters/regex/jump) | The only true moat vs ccusage & tokscale. |
| 4 | Insights one-liners + weekly digest + streaks | Manufactures the screenshottable surprise; drives return visits. |
| 5 | Diff ranges + CSV/JSON export | Cheap parity + the question power users ask. |
| 6 | ⭐ Offline percentile badge | Amplifies the card's shareability with zero network risk. |
| 7 | Multi-CLI support | Breadth — after the moat is set, framed as "search all agents." |
| 8 | Reports + local team merge + plugin hooks | Durability; crowd-sources breadth. |
| 9 | Hosted sync | Last, opt-in, or skip. |

---

## 5. Growth loop — the one shareable artifact

**Build the local "ClaudeScope Wrapped" card. One artifact, one loop.**

Why this and nothing else:
- The mechanic is **already validated** by tokscale, ccwrapped, and the viral HN/Reddit "$30k/month on a $200 plan" posts — developers love posting their AI spend as a flex/horror.
- We have all the data already; the build is mostly an SVG → PNG render via `canvas.toBlob()` (stays dependency-free).
- **Our differentiated twist is the one thing the incumbents can't copy:** the card is generated entirely on your machine — no account, no upload, no leaderboard submission. *"Flex your stats without surrendering them."*

**The loop:**
1. Dev runs `npx claudescope-cli`, sees a surprising number, clicks **Share my card**.
2. Card downloads + a pre-filled post opens (X intent URL / Reddit text / copy-for-LinkedIn) with the `npx claudescope-cli` line baked into the text and the watermark on the image.
3. Their followers — also Claude Code users, perfect targeting — see a friction-free one-liner → run it → generate their own card → back to step 1.

**Build spec:** a "Share" tab with a live card preview + **Download PNG / Post to X / Copy Reddit text** buttons; an archetype classifier in `analytics.js` (pure rules over data already aggregated); rendering stays client-side to preserve zero-dep/zero-network. The card carries the install CTA on every share — that's the engine.

---

## 6. Distribution playbook — 30 / 60 / 90 days

**Two pre-flight fixes before any channel (Day 0):**
- **Re-headline the README and npm description** so **search** is in the first 8 words. Move the full-text-search row to the top of "What you get"; demote analytics. Add an explicit line: *"ccusage tells you what you spent; ClaudeScope lets you search what you actually did."*
- **Lead the GIF with a search** (type an error message → jump to the 3-week-old session), not the stat cards. Always say `npx claudescope-cli` **verbatim** + the repo URL in every post — never abbreviate to `claudescope` (it installs nothing).

### Days 0–30 — seed the evergreen channels + the big spike

- [ ] **awesome-claude-code (hesreallyhim) — do first, highest ROI/lowest effort.** Submit via the **issue form** (`submit-resource.yml`), *not* a PR (PRs are rejected). Category: Tooling/Applications.
  > *"ClaudeScope — `npx claudescope-cli`. Local-first, zero-dependency dashboard + full-text search over your Claude Code session transcripts. Grep every prompt, reply and tool call you've ever sent, plus token/cost stats, per-project & per-model spend, a tool leaderboard and an activity heatmap. 100% local, no network."*
- [ ] **Same week, copy-paste to the other lists:** `jqueryscript/awesome-claude-code`, `rohitg00/awesome-claude-code-toolkit` (companion-apps section), `awesomeclaude.ai`, `claudefa.st` directory.
- [ ] **r/ClaudeCode first** (smaller, tool-tolerant), lead with a GIF + a surprising finding about *your own* data.
  > *"I built a free, local tool to search every Claude Code session I've ever run — and it showed me 78% of my tokens are just cache reads."* Body: 2–3 surprising findings + screenshots, then `npx claudescope-cli`, zero deps, never leaves your machine, MIT, repo link. Reply to every comment.
- [ ] **Write the dev.to data-story post** (the URL you paste everywhere after). Tags: `claude`, `ai`, `productivity`, `webdev`. Data-led title beats tool-led:
  > *"I analyzed 35,000 of my own Claude Code messages. Here's where the tokens actually go."*
- [ ] **Show HN — the big spike, one shot. Post Tue–Thu ~9–10am ET; be at the keyboard for 2 hours.** Search-led title:
  > `Show HN: ClaudeScope – full-text search across every Claude Code session you've run (npx, zero deps, 100% local)`
  > First comment (post immediately): origin story ("couldn't find a session I knew I'd solved"), the honest ccusage comparison ("ccusage owns cost; I wanted retrieval + auditability — 0 deps, reads every line in 5 min, never touches the network"), one surprising stat from your data, and a pre-empt of the cost-estimate nitpick ("these dollars are an API-equivalent gauge, not a bill").
- [ ] **r/ClaudeAI + X thread** a few days later, riding HN momentum (different framing, not a repost). X hook:
  > *"ccusage tells you how much you spent on Claude Code. I wanted to search what I actually did — so I built ClaudeScope. Full-text search across every prompt + reply, plus token/cost stats. `npx claudescope-cli`. 0 deps, 100% local, MIT. 🧵"* — one killer screenshot per follow-up (heatmap, search highlighting, model split).

### Days 31–60 — convert momentum into compounding reach

- [ ] **Product Hunt** (Tue/Wed), bundled *after* HN/Reddit so you have social proof. GIF + 3–4 gallery screenshots.
  > Tagline: *"Search and visualize your entire Claude Code history — 100% local."* Line up ~10 first-hour commenters; first comment = maker story + honest ccusage comparison.
- [ ] **Newsletter / roundup pitches** (data-story angle, not tool announcement): One Tip a Week (covered Sniffly), TLDR, Console.dev beta.
- [ ] **Ship 0.2 (session replay + better search) and re-announce** in the threads where people asked for it — turns commenters into contributors.
- [ ] **GitHub Pages comparison page** (reuse your Astro landing pattern) targeting the near-empty keywords **"search your Claude Code history"** and **"ccusage alternative with search"**, with a **ClaudeScope vs ccusage vs CCHV vs Sniffly** table (comparison pages rank and convert).

### Days 61–90 — the growth loop goes live

- [ ] **Ship 0.5 (the Wrapped card)** and launch it as its own moment — *"flex your Claude Code stats without uploading a byte."* Re-run the HN/Reddit/X playbook with the card as the hero asset.
- [ ] **Ship the Claude Code plugin** (`/claudescope:wrapped`) and submit it to the plugin/skill directories — meet users inside the tool they already live in.
- [ ] **Re-submit the now-richer tool** to the awesome-lists' "what's new" and the newsletters, citing traction.
- [ ] **Keep answering every issue within 48h** — early engagement is the ranking signal on HN/Reddit and the contributor pipeline.

---

## 7. Honest risks

- **The niche is a graveyard.** "Local analytics for Claude Code" shipped a dozen times in the last 6 months (Subtle, Rudel, CodeBurn, Clawdmeter, tokscale, phuryn…). A generic "see your tokens" Show HN **will get buried.** Mitigation: lead with search + zero-dep auditability, never with cost.
- **CCHV already does analytics + full-text search** (offline, 9 providers, ~1.5k stars) — the tool a reviewer compares us to. We likely **can't beat it on features**; we beat it on **zero-friction (`npx`, no download) + shareability + polish**. If that delta isn't real, we have no story.
- **The share-card lane is already occupied** (ccwrapped owns "Wrapped," tokscale owns "share to X"). Card #3 wins nothing alone. **Our wedge must be the combination they don't have:** searchable replayable dashboard + cost-saved framing + perfect offline-privacy, with the card as the trojan horse — not the product.
- **Brand/SEO collision with `claudescope.dev`** (paid team SaaS, same domain) plus Anthropic's "Session Memory." Risk of looking like a clone and losing search traffic. Mitigation: own the *search* keyword they don't target, comparison page, always pair brand with repo URL + install line.
- **`claudescope-cli` vs `claudescope` friction tax.** Word-of-mouth "try claudescope" leads to a 404 or a typosquat. Mitigation: copy discipline (full install token everywhere); consider a scoped/placeholder reservation if npm ever frees the bare name.
- **Cost-estimate nitpick.** HN/Reddit *will* challenge "API-equivalent dollars." The "not a bill, it's an intensity gauge" disclaimer exists — make it loud, on the dashboard and in every launch post.
- **Trademark drift.** "claude*" naming carries low-grade risk if Anthropic tightens brand policy. The local-first, non-commercial, MIT framing is the safety margin — keep it.
- **Solo-maker bandwidth.** The plan front-loads a 2-hour HN window, daily issue replies, and two launch moments (0.2 re-announce, 0.5 card). Don't open Show HN until the README is re-headlined and the GIF leads with search — you get one shot.
