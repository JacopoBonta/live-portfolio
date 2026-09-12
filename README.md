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

## Experience features (all in `index.html`, no dependencies)

- **Command palette (⌘K / Ctrl-K)** — switch the theme mode, jump to a
  section, apply a language filter, open a repo on GitHub, copy the page link.
  Type-to-filter, ArrowUp/Down + Enter, Esc to close. Keyboard-only (no visible
  trigger) so it stays an easter egg.
- **Theme modes** — system by default (follows the OS light/dark setting, live
  while the page is open), forced light or dark via the palette's **Theme**
  group. The choice persists in `localStorage['live-portfolio-theme']`
  ("system" removes the key so it keeps tracking the OS). Resolved in a
  bootstrap script before the CSS applies, so a first visit never flashes the
  wrong theme; JS-off keeps the dark default.
- **Public contribution heatmap** — 53-week calendar rendered from
  `data.contributions`, a 5-step accent scale computed from the profile's own
  day-count distribution. Hidden when the field is missing (old snapshots).
- **Language distribution bar** — segmented byte-share bar + legend under the
  stats row, from `data.languages`.
- **Featured card mini bars** — 4px stacked byte-share bar per featured card
  from its per-repo `languages` map.
- **Sticky section nav** — appears (blurred) once the masthead scrolls away.
- **Scroll reveals** — subtle fade/slide on first intersection.
- Theme, motion and JS gating all follow the same progressive pattern:
  `prefers-reduced-motion: reduce` and JS-off get exactly the plain static
  page; theme mode "system" resolves via `prefers-color-scheme` in JS.

## New data fields (`public/data.json`)

- `contributions` — `{ start, end, total, days[] }`: public contribution
  calendar, Sunday-anchored, column-major (53 week columns × 7 rows of day
  counts). Fetched with `onlyPublicContributions: true` so private activity
  never leaves GitHub, regardless of which token runs the generator. `null`
  when the fetch fails — the page just omits the heatmap.
- `career` — `{ experience[], education[] }`: curated career data copied from
  the LinkedIn public page (see below), emitted by `sanitizeCareer` in the
  generator. `null` when absent or malformed — the page just omits the
  Career section.

## Layout

```
index.html              the whole site: markup, inline CSS, inline JS, no build step
site.config.json        curated content: title, tagline, about, links, featured,
                        hide, archiveAfterDays, maxEvents, career, overrides
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
- `maxEvents` — maximum rows in **"Recent public activity"** (default 10).
  Before capping, events with the same kind + repo (e.g. repeated
  "pushed to live-portfolio") are grouped into their latest occurrence; each
  grouped row shows a `×N` badge with how many events it folded.
- The **"All public repositories"** list is sorted by last push, most recent
  first (stars break ties between repos pushed the same day).
- `career` — curated **Experience + Education** for the Career section,
  copied by hand from the LinkedIn public page
  (`linkedin.com/in/jacopobnt`). LinkedIn bot-blocks automated retrieval
  (HTTP 999 on every route, proxies included) and its ToS forbids scraping,
  so — unlike the GitHub data — this content can't be fetched at snapshot
  time; it lives in the config and flows into the snapshot through
  `sanitizeCareer` (entries missing `title`+`org`+`start`, or education
  missing `school`, are dropped rather than breaking the generator).
  Experience entries render newest-first in config order with
  title · org (linked when `url` is set) · "start – end · duration" (the
  duration is computed at render time from `startISO`/`endISO`, so the
  current role stays current), plus optional location, description and
  `skills` chips. Education entries render as a nested list with school
  (linked when `url` is set), `period`, `field` and `note`.
- The stats row shows public repos, main language, followers and last push —
  computed from the snapshot, not configured.

## Privacy

The generator only reads public endpoints (`users/JacopoBonta/repos`,
`users/JacopoBonta/events/public`, GraphQL `pinnedItems`, per-repo
`/languages`, GraphQL `contributionsCollection` with
`onlyPublicContributions: true`) and only emits public, non-fork,
non-archived repos. The authenticated `/user` endpoint is used solely to
assert the login is `JacopoBonta` and to read the public profile fields.
