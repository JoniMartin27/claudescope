# dev.to / blog — the data story

A data-led story out-performs a tool announcement, and it's the evergreen URL you paste into every other channel. Tags: `claude`, `ai`, `productivity`, `webdev`.

## Title options
```
I analyzed «35,000» of my own Claude Code messages. Here's where the tokens actually go.
What 6 months of Claude Code looks like (and the local tool I built to see it)
```

## Outline (write it in your own voice — specifics from YOUR data are the point)

1. **The hook.** You can't see any of it. `~/.claude/projects/` is gigabytes of `.jsonl`; `claude --resume` shows IDs, not content. You have no idea what you're spending, searching, or repeating.
2. **What I found (the meat — screenshots).** Pull 4–6 genuinely surprising facts from your dashboard, e.g.:
   - "«97%» of my tokens are cache reads — caching saved me «~$14k** at list rates."
   - "My peak coding hour is «Tuesday 6pm**; «40%** of my spend is one project."
   - "«22** of my sessions ended with me hitting stop mid-reply — where Claude went the wrong way."
   - "Median session «$2.5**, p90 «$64** — the long tail is everything."
   Each fact = one screenshot (heatmap, model split, the Wrapped card, a search with highlighting).
3. **The honest caveats.** Flat-rate plan → the $ are API-equivalent estimates, not a bill. The percentile is a heuristic. Say it plainly; it builds trust.
4. **The tool (soft sell, last third).** It's `npx claudescope-cli`, MIT, zero deps, 100% local. The architecture is ~10 files of Node stdlib — link to the source. The feature you'll actually keep using is search → replay.
5. **CTA.** Repo + "run it on your own data and tell me what surprised you."

## Reusable one-liner for the intro/outro
> ccusage tells you what you spent; ClaudeScope lets you search what you actually did.
