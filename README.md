# live-portfolio

A "live" portfolio: a single static page at
**https://JacopoBonta.github.io/live-portfolio/** whose content is generated
from `site.config.json` (curated) plus **public** GitHub data (repos, stars,
languages, recent public activity). Private repos and private activity never
appear on the site.

## How it stays live

Updates flow in one direction — the harness (or you) runs one command after
project work:

```sh
node scripts/update.mjs --push
```

That regenerates `public/data.json` from the live GitHub API (via the
authenticated `gh` CLI), commits it to `main`, and pushes. A GitHub Actions
workflow (`.github/workflows/deploy.yml`) then deploys the static page to
GitHub Pages — the site is current about a minute later.

- `node scripts/update.mjs` — regenerate the snapshot only (no commit).
- `--push` — regenerate + commit (`data: refresh snapshot <date>`) + push.

## Layout

```
index.html              the whole site: markup, inline CSS, inline JS, no build step
site.config.json        curated content: title, tagline, about, links, featured
public/data.json        generated snapshot (committed — source of truth for the page)
public/avatar.png       downloaded at snapshot time (no hotlinking)
scripts/update.mjs      zero-dependency fetcher/generator (Node ≥ 20, `gh` CLI)
.github/workflows/deploy.yml
```

## Editing curated content

Edit `site.config.json` (or the markup in `index.html`), regenerate the
snapshot, then commit and push — a push to `main` is what triggers the Pages
deploy:

    node scripts/update.mjs        # refresh public/data.json if the edit affects it
    git add -A && git commit -m "…" && git push

Note: `node scripts/update.mjs --push` only commits the generated snapshot
(`public/data.json` + `public/avatar.png`), never your curated edits — those
need their own commit. The `featured` list resolves in order: exact repo names
from the config → GitHub pinned repos → top-starred repos. Names that are not
public repos are skipped.

## Privacy

The generator only reads public endpoints (`users/JacopoBonta/repos`,
`users/JacopoBonta/events/public`, GraphQL `pinnedItems`, per-repo
`/languages`) and only emits public, non-fork, non-archived repos. The
authenticated `/user` endpoint is used solely to assert the login is
`JacopoBonta` and to read the public profile fields.
