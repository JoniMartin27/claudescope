# Contributing to ClaudeScope

Thanks for hacking on ClaudeScope! The codebase is deliberately tiny,
dependency-free, and local-first. A few rules keep it that way.

## Run it

```bash
git clone https://github.com/JoniMartin27/claudescope
cd claudescope
node --test          # run the full test suite (no install needed)
npm start            # launch the dashboard against your own data
```

There is **no build step** and **no `npm install`** — it's pure Node.js standard
library and vanilla browser JS.

## Hard rules

A PR that violates any of these will be rejected:

- **Zero runtime dependencies.** Don't add anything to `dependencies` in
  `package.json`. Node stdlib + vanilla browser JS only. ESM, no bundler.
- **100% local, zero network.** The default dashboard and startup path must make
  no network requests — it has to work with Wi-Fi off. (The opt-in, off-by-default
  Anthropic Usage connector is the only exception, and only on an explicit click.)
- **Read-only.** Never write, move, or delete a user's transcript files.
- **Keep the tests green and add one.** Run `node --test` before you push, keep
  all tests passing, and add a test for any new logic.
- **Escape transcript-derived strings** with `escapeHtml()` before assigning them
  to `innerHTML` on the frontend.

## Adding a data source or a dashboard panel

Want ClaudeScope to read a new agent CLI's logs, or surface a new metric? See
**[docs/EXTENDING.md](docs/EXTENDING.md)** — it documents the
`src/sources/` adapter contract, the normalized session/message shape, how
adapters are discovered and registered, and how analytics fields flow to the
dashboard. It includes a copy-paste adapter skeleton.

## License

By contributing you agree your work is licensed under the project's
[MIT License](LICENSE).
