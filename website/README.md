# ClaudeScope — landing page

This directory is the **static marketing / comparison landing page** for
[ClaudeScope](https://github.com/JoniMartin27/claudescope) (`npx claudescope-cli`).

It is a **separate static site** — it is **not** part of the npm package and is
excluded from `package.json`'s `files` list. It ships nothing to npm. It is plain
HTML + CSS with **no build step and no dependencies** (matching ClaudeScope's own
zero-dependency philosophy).

## What's here

- `index.html` — SEO-targeted landing + comparison page. Leads with **search +
  privacy** (per `docs/ROADMAP.md` §2–3), with a comparison table vs ccusage, CCHV,
  Sniffly and tokscale, a feature grid, and a privacy section.
- The hero references `../docs/promo.gif`. If you deploy this folder in isolation
  (so `../docs/` is unavailable), copy `docs/promo.gif` into `website/` and update
  the `<img>`/Open Graph paths.

## Deploy with GitHub Pages

Two equally simple options:

**A. Deploy from a branch + `/website` folder** *(recommended — no build, no Action)*
1. Push this folder to the repo.
2. Repo **Settings → Pages**.
3. **Build and deployment → Source: Deploy from a branch.**
4. Pick your branch (e.g. `main`) and folder **`/website`** (GitHub Pages exposes
   `/` and `/docs` natively; for an arbitrary folder either use a small
   `.github/workflows` static deploy, or move/symlink — see option B).
5. Save. The site goes live at `https://<user>.github.io/<repo>/`.

> Note: GitHub Pages' branch-source dropdown only offers `/ (root)` and `/docs`.
> To serve from `/website` either (a) use the static-files GitHub Action below, or
> (b) publish to a dedicated `gh-pages` branch whose root is this folder's contents.

**B. Publish to a `gh-pages` branch** *(works for any folder)*
```bash
# from repo root, with the website/ contents as the site root
git subtree push --prefix website origin gh-pages
# then Settings → Pages → Source: Deploy from a branch → gh-pages → / (root)
```

**C. Static-files Action** — drop a workflow that uploads `website/` via
`actions/upload-pages-artifact` + `actions/deploy-pages`. No build needed since the
site is already plain HTML/CSS.

## Local preview

No server required, but to test relative asset paths cleanly:

```bash
npx serve website
# or
python -m http.server 8000 --directory website
```

MIT — same license as ClaudeScope.
