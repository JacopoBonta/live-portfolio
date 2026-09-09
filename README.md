# live-portfolio

A "live" portfolio: a single static page at
**https://JacopoBonta.github.io/live-portfolio/** whose content is generated
from `site.config.json` (curated) plus **public** GitHub data (repos, stars,
languages, recent public activity). Private repos and private activity never
appear on the site.

## How it stays live

Two refresh paths, same direction — content only ever flows from GitHub data
into `public/data.json`:

1. **GitHub Actions (primary)** — `.github/workflows/refresh.yml` runs daily at
   05:30 UTC: it regenerates `public/data.json` using the workflow's own
   `GITHUB_TOKEN` (no secrets), commits `data: auto refresh <date>` as
   `github-actions[bot]`, and deploys the page. Works even when no machine of
   yours is on. You can also trigger it manually from the Actions tab
   (*Refresh live snapshot → Run workflow*).
2. **Local (secondary)** — the DSH scheduler runs
   `node scripts/update.mjs --push` from the project directory, and you can
   always run it yourself after project work:

```sh
node scripts/update.mjs --push
```

That regenerates `public/data.json` from the live GitHub API (via the
authenticated `gh` CLI), commits it to `main`, and pushes. The deploy workflow
(`.github/workflows/deploy.yml`) deploys on every push to `main` — the site is
current about a minute later.

- `node scripts/update.mjs` — regenerate the snapshot only (no commit).
- `--push` — regenerate + commit (`data: refresh snapshot <date>`) + push.

## Layout

```
index.html              the whole site: markup, inline CSS, inline JS, no build step
site.config.json        curated content: title, tagline, about, links, featured,
                        hide, archiveAfterDays, overrides
public/data.json        generated snapshot (committed — source of truth for the page)
public/avatar.png       downloaded at snapshot time (no hotlinking)
scripts/update.mjs      zero-dependency fetcher/generator (Node ≥ 20, `gh` CLI)
.github/workflows/deploy.yml    deploy on push to main
.github/workflows/refresh.yml   daily snapshot refresh + deploy (05:30 UTC)
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

## Curation knobs (all in `site.config.json`)

- `hide` — array of repo names excluded from the snapshot entirely.
- `overrides` — per-repo `description` / `homepage` applied by the generator,
  for repos whose GitHub metadata is missing or sparse.
- `archiveAfterDays` — repos not pushed within this many days (default 730)
  are flagged `past: true`; the page lists them under the collapsed
  **"Past projects"** disclosure instead of the main repo list. The split is
  recomputed on every snapshot, so repos migrate automatically as they age.
- The stats row shows public repos, main language, followers and last push —
  computed from the snapshot, not configured.

## Privacy

The generator only reads public endpoints (`users/JacopoBonta/repos`,
`users/JacopoBonta/events/public`, GraphQL `pinnedItems`, per-repo
`/languages`) and only emits public, non-fork, non-archived repos. The
authenticated `/user` endpoint is used solely to assert the login is
`JacopoBonta` and to read the public profile fields.
