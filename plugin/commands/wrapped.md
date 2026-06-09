---
description: Your Claude Code "wrapped" — headline numbers (sessions, tokens, cost, cache savings, archetype, top %) as a shareable blurb.
allowed-tools: Bash
---

Generate the user's ClaudeScope "**wrapped**" summary.

Run this command to compute the analytics locally (no dashboard, no browser, no network):

```
npx -y claudescope-cli --json
```

This prints a JSON object to stdout. Parse it and pull these headline numbers:

- `totals.sessions` — number of sessions
- `totals.tokens` — total tokens
- `totals.cost` — estimated cost in USD
- `totals.cacheSavings` — USD saved by cache reads
- `totals.percentile.label` — e.g. `"top 8%"`
- `archetype.emoji` + `archetype.name` — the user's coding archetype (e.g. `🔨 The Builder`)

Then write a short, friendly, **shareable text blurb** summarizing these. Format the big numbers
nicely (thousands separators; round tokens to e.g. `12.3M`, cost/savings to 2 decimals like
`$42.10`). Example shape (adapt to the real numbers):

> 🔭 My Claude Code wrapped — 137 sessions, 12.3M tokens, ~$42.10 spent, $18.40 saved by caching.
> Archetype: 🔨 The Builder. That puts me in the top 8% of Claude Code users. via ClaudeScope

Keep it to 1–3 lines so it's easy to copy/paste into a post.

Finally, point the user to the dashboard's **"Share card"** button (run `/claudescope` to open
the dashboard) if they want the same stats as a downloadable **image** to share. Remind them all
of this was computed 100% locally — nothing left their machine.
