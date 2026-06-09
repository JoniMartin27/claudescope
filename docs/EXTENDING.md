# Extending ClaudeScope

ClaudeScope started as a Claude Code analytics tool and now reads **other agent
CLIs' local logs too** (Codex, Cursor, Aider, Gemini, Copilot). Each tool is a
small, self-contained **source adapter** in [`src/sources/`](../src/sources/)
that turns that tool's transcript files into ClaudeScope's normalized
session/message shape. Once normalized, search, analytics, and the dashboard all
work for free.

This guide documents two extension points:

1. **Add a data source** — teach ClaudeScope to read a new agent CLI's logs.
2. **Add a dashboard panel** — surface a field on the frontend.

Plus the hard [contribution rules](#contribution-rules) every change must follow.

---

## 1. Add a data source

### The adapter contract

A source adapter is a plain ES module whose **default export** is an object with
four members:

```js
export default {
  id,            // string — stable, unique, kebab-case (e.g. 'gemini')
  name,          // string — human label shown in the UI (e.g. 'Gemini CLI')
  locate(claudeDir) -> string[],          // existing transcript file paths
  parseFile(path) -> Promise<{ sessions, messages }>,  // normalized records
};
```

| Member | Contract |
|---|---|
| `id` | Stable unique identifier. Stamped onto every record as `source: id` and used as the `bySource` bucket key. Never reuse `'claude-code'`. |
| `name` | Display name for the UI / `sources` summary. |
| `locate(claudeDir)` | Returns an array of **absolute paths to files that exist right now**. Must be cheap and **must never throw** — wrap all I/O in try/catch and return `[]` on any error or when the tool isn't installed. Only `claude-code` uses the `claudeDir` argument; other adapters discover their own well-known locations (a home-dir path, an env-var override) and **must not walk the whole filesystem**. |
| `parseFile(path)` | Reads one file and returns `{ sessions, messages }` in the [normalized shape](#the-normalized-shape). May be async. Should be defensive: on an unreadable or malformed file return `{ sessions: [], messages: [] }` rather than throwing (the runner also catches throws, but returning empty is cleaner). Tag every record with `source: id`. |

Two invariants the runner relies on:

- **`locate()` never throws.** A missing tool yields `[]` and is silently skipped.
- **A bad file never aborts the scan.** If `parseFile()` throws, that one file is
  skipped and the rest of the run continues (see `runAdapter` in
  [`src/sources/index.js`](../src/sources/index.js)).

### The normalized shape

Every adapter emits the **same** session and message objects the original Claude
Code parser produces, so the analytics layer and frontend never need to know
which tool a record came from. Don't hand-build these — use the factories in
[`src/sources/shape.js`](../src/sources/shape.js), which guarantee the canonical
field set:

| Helper | Use |
|---|---|
| `newSession({ sessionId, source, projectLabel, projectPath?, project?, file? })` | Returns a fresh session with **every field `buildAnalytics()` reads**, zero-initialized. |
| `newMessage({ sessionId, source, projectLabel, ts, role, text })` | Returns a search/message record. `text` is lowercased + capped and a display `snippet` is derived — exactly like the Claude parser does. |
| `touchTs(session, ts)` | Updates `firstTs`/`lastTs` from an ISO timestamp string. |
| `bumpHeat(session, ts)` | Increments the local weekday×hour activity bucket for an assistant reply. |
| `emptyUsage()` | A zeroed `{ input, output, cacheWrite, cacheRead }` token-usage object. |

**Session fields** (the object `buildAnalytics()` consumes). The most important to
populate:

- `sessionId` (string, unique), `source` (= your `id`), `projectLabel`,
  `projectPath` (full cwd when known — used as the `byProject` key), `file`.
- `firstTs` / `lastTs` — ISO strings; set via `touchTs`.
- `messageCount`, `userMsgs`, `assistantMsgs` — counts you increment as you parse.
- `models` — `{ modelId: messageCount }`. Used for `byModel` and pricing.
- `usage` — the 4-bucket token object `{ input, output, cacheWrite, cacheRead }`.
- `modelUsage` — `{ modelId: { messages, usage{}, cost } }`. **You can leave this
  empty**; for non-`claude-code` adapters the runner post-prices the session (see
  below) and fills it in.
- `tools` — `{ toolName: count }`.
- `cost` — leave `0`; the runner sets it.
- `title` — first user prompt (truncated), shown in "top sessions".
- `heat` — `{ (weekday*24+hour): assistantReplyCount }`; populated via `bumpHeat`.
- `version`, `gitBranch`, `cwd`, `userType`, `entrypoint`, `interrupted` — optional
  metadata; fill what your format exposes, leave the rest as their defaults.

**Message fields** (what `search()` scans). `newMessage` builds them for you:
`sessionId`, `source`, `project`/`projectLabel`, `ts`, `role`
(`'user'` | `'assistant'`), `lc` (lowercased haystack), `snippet` (display text).

#### Pricing & cost

`src/pricing.js` only knows Claude's rates. For any non-`claude-code` adapter the
runner calls `priceSession()` after `parseFile()`: it reads your session's
`models[0]` + `usage`, computes `cost` via `costForUsage()`, and mirrors the
result into `modelUsage`. So **just fill `models` and `usage` and leave
`cost`/`modelUsage` alone**. Non-Claude models price to `$0` today (tokens and
counts still aggregate everywhere) — that's expected, not a bug.

If a tool doesn't record token usage in its logs (Aider and Gemini don't), leave
`usage` at zero. Sessions, messages, projects, the heatmap, and full-text search
all still work; only token/cost figures stay blank for that source.

### How sources are discovered & registered

[`src/sources/index.js`](../src/sources/index.js) holds a static registry:

```js
export const ADAPTERS = [claudeCode, codex, cursor, aider, gemini, copilot];
```

`parseAllSources(claudeDir)` walks `ADAPTERS` in order: it calls each adapter's
`locate()`, parses every returned file, post-prices non-Claude sessions, and
concatenates all sessions/messages. Adapters that find **no** files contribute
nothing and don't appear in the `sources` summary — so a registered-but-absent
tool is invisible at runtime. Claude Code is listed first and is a transparent
pass-through to the original parser, keeping legacy behavior byte-identical.

**To register a new adapter:** add the file under `src/sources/`, then import it
and append it to the `ADAPTERS` array. That's the only wiring step.

```js
// src/sources/index.js
import myTool from './my-tool.js';
export const ADAPTERS = [claudeCode, codex, cursor, aider, gemini, copilot, myTool];
```

### Copy-paste adapter skeleton

A minimal best-effort adapter. Replace the discovery + parse logic with your
tool's format; everything else is the contract.

```js
// src/sources/my-tool.js — EXPERIMENTAL / best-effort.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession, newMessage, touchTs, bumpHeat } from './shape.js';

const ID = 'my-tool';

// Return absolute paths to files that exist. Cheap. NEVER throws.
function locate() {
  const candidates = [
    process.env.MY_TOOL_LOG,                       // explicit override
    path.join(os.homedir(), '.my-tool', 'history.json'),
  ].filter(Boolean);

  const out = [];
  for (const c of candidates) {
    try {
      const abs = path.resolve(c);
      if (fs.statSync(abs).isFile()) out.push(abs);
    } catch {
      /* not present — skip */
    }
  }
  return out;
}

// Read ONE file -> normalized { sessions, messages }. Defensive: never throws.
async function parseFile(filePath) {
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(filePath, 'utf8')); // [{ role, text, ts }, ...]
  } catch {
    return { sessions: [], messages: [] };
  }
  if (!Array.isArray(entries)) return { sessions: [], messages: [] };

  const sessionId = `${ID}-${path.basename(filePath)}`;
  const s = newSession({
    sessionId,
    source: ID,
    projectLabel: 'my-tool',
    file: path.basename(filePath),
  });
  const messages = [];

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const role = e.role === 'user' ? 'user' : 'assistant';
    const text = String(e.text || '').trim();
    if (!text) continue;
    const ts = e.ts || null;

    touchTs(s, ts);
    s.messageCount++;
    if (role === 'user') {
      s.userMsgs++;
      if (!s.title) s.title = text.replace(/\s+/g, ' ').slice(0, 120);
    } else {
      s.assistantMsgs++;
      bumpHeat(s, ts);
    }
    // If your format exposes tokens, fill s.usage / s.models here so the
    // runner can price the session; otherwise leave them at zero.
    messages.push(newMessage({ sessionId, source: ID, projectLabel: s.projectLabel, ts, role, text }));
  }

  if (s.messageCount === 0) return { sessions: [], messages: [] };
  return { sessions: [s], messages };
}

export default { id: ID, name: 'My Tool', locate, parseFile };
```

Then register it in `src/sources/index.js` (see above) and add a test under
`test/` that feeds a tiny fixture through `parseFile()` and asserts the
normalized shape (every adapter is also covered by a generic interface test that
checks `locate()` never throws and a garbage file is tolerated).

---

## 2. Add a dashboard panel

Analytics fields flow to the dashboard along a fixed pipeline:

```
adapter sessions ─► buildAnalytics(sessions)  (src/analytics.js)
                        │  builds the payload: totals, byProject, bySource,
                        │  byModel, byDay, byTool, byVersion, heatmap,
                        │  sessions (top), perSession, archetype, insights
                        ▼
                   GET /api/analytics          (src/server.js)
                        ▼
                   public/app.js  ─►  renders into public/index.html
```

To surface something new on the dashboard:

1. **Aggregate it** in `buildAnalytics()` (`src/analytics.js`) — add a field to
   the returned payload (e.g. a new `Map` you reduce sessions into, shaped into a
   sorted array like the existing `byTool`). Add a unit test in `test/` asserting
   the new field from a fixture.
2. **Render it** in `public/app.js` — read the field off the `/api/analytics`
   payload and build the panel. **Escape every transcript-derived string with
   `escapeHtml()` before assigning to `innerHTML`** — titles, project labels,
   snippets, model ids and tool names all originate in user transcripts.
3. **Style it** in `public/styles.css` (no build step — plain CSS).

No new endpoint is needed for fields already on the analytics payload. The same
payload also drives `--json`, `--weekly`, and the team-merge flows, so a field
added in `buildAnalytics()` shows up everywhere at once.

---

## Contribution rules

These are **hard constraints** — a PR that breaks one will be rejected:

- **Zero runtime dependencies.** Nothing may be added to `dependencies` in
  `package.json`. Pure Node.js standard library on the backend, vanilla browser
  JS on the frontend. No build step, no bundler, **ESM only**.
- **100% local, zero network.** The default dashboard and startup path must make
  **no network requests**. ClaudeScope must work identically with Wi-Fi off. (The
  one exception — the Anthropic Usage API connector — is opt-in, off by default,
  and fires only on an explicit click.)
- **Read-only.** Adapters only ever *read* transcript files. Never write, move,
  or delete a user's logs.
- **Don't break existing behavior or tests.** Run `node --test` and keep **all**
  tests green. Add a test for any new logic.
- **Escape before `innerHTML`.** Any transcript-derived string rendered on the
  frontend must pass through `escapeHtml()` first.
- **Keep the existing code style** — small, defensive, self-contained modules.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the short version.
