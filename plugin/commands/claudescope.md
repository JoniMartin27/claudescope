---
description: Launch the ClaudeScope dashboard — 100% local analytics & full-text search for your Claude Code sessions.
allowed-tools: Bash
---

Launch the **ClaudeScope** dashboard for the user.

Run this command:

```
npx -y claudescope-cli
```

What it does:

- Reads the user's Claude Code transcripts from `~/.claude/projects/**` **on disk only**.
- Starts a local dashboard on `127.0.0.1` and **auto-opens the browser**.
- Makes **zero network requests** — 100% local, the data never leaves the machine.

The command prints a line like `Dashboard ready at http://127.0.0.1:4317`. Read the actual
URL from the output and tell the user where the dashboard is running (the browser should open
automatically; if it did not, they can open that URL manually). Mention that the server keeps
running until they press `Ctrl+C`, and that everything stays on their machine.

If the port is already in use, the CLI suggests an alternate port — relay that suggestion
(e.g. `npx -y claudescope-cli --port 4318`).
