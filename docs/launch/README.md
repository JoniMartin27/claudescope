# ClaudeScope — Launch kit

Ready-to-paste copy for shipping ClaudeScope. **Two non-negotiables before you post anything:**

1. **Lead with search + privacy, never cost.** (Cost invites a fight with ccusage you lose.)
2. **Always write `npx claudescope-cli` verbatim** + the repo URL. Never abbreviate to `claudescope` (that installs nothing / is a typosquat risk).

> Swap the `«…»` placeholders for your own real numbers (run `npx claudescope-cli` → the dashboard, or `npx claudescope-cli --weekly`). Real, specific numbers from *your own* usage are the hook.

Repo: https://github.com/JoniMartin27/claudescope · npm: https://www.npmjs.com/package/claudescope-cli · Site: https://jonimartin27.github.io/claudescope

---

## The 30 / 60 / 90 checklist (condensed from docs/ROADMAP.md §6)

### Days 0–30 — seed evergreen channels + the big spike
- [ ] **awesome-claude-code** (hesreallyhim) — submit via the **issue form** (`submit-resource.yml`), NOT a PR. Copy in [`awesome-lists.md`](./awesome-lists.md).
- [ ] Same week: the other lists in [`awesome-lists.md`](./awesome-lists.md).
- [ ] **r/ClaudeCode** first (tool-tolerant) — post in [`reddit.md`](./reddit.md). Lead with a GIF + a surprising finding about *your own* data. Reply to every comment.
- [ ] Publish the **dev.to** data-story — draft in [`devto.md`](./devto.md). This is the URL you paste everywhere after.
- [ ] **Show HN** — the one-shot spike. Tue–Thu ~9–10am ET, be at the keyboard 2h. Title + first comment in [`show-hn.md`](./show-hn.md).
- [ ] **r/ClaudeAI + X thread** a few days later (different framing) — [`x-thread.md`](./x-thread.md).

### Days 31–60 — compound it
- [ ] **Product Hunt** (Tue/Wed) after HN/Reddit, with the GIF + gallery.
- [ ] Newsletter pitches (data-story angle): TLDR, Console.dev, One Tip a Week.
- [ ] Make sure the **comparison site** is live (Settings → Pages → `gh-pages`) — it ranks for "ccusage alternative with search".

### Days 61–90 — the loop
- [ ] Push the **Wrapped card** as its own moment ("flex your stats without uploading a byte").
- [ ] Submit the **Claude Code plugin** (`/claudescope:wrapped`) to plugin directories.
- [ ] Keep answering every issue within 48h.

---

## The product, in one paragraph (paste into any "what is it")

> ClaudeScope is a local-first dashboard + full-text search for your Claude Code history. `npx claudescope-cli` opens a browser dashboard built from the transcripts already on your disk — search every prompt, reply and tool call you've ever run and jump straight into the session, see token/cost/cache stats, per-model and per-project spend, a weekday×hour heatmap, and a shareable (anonymized, 100%-local) Wrapped card. It also picks up your Codex/Cursor/Aider/Gemini/Copilot CLI logs if present. Zero dependencies, zero network, MIT.
