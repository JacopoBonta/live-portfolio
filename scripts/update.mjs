#!/usr/bin/env node
// Regenerates public/data.json from the curated site.config.json plus live public
// GitHub data, then (with --push) commits and pushes so Actions CI deploys.
//
//   node scripts/update.mjs          regenerate public/data.json (+ avatar)
//   node scripts/update.mjs --push   regenerate, commit, push main
//
// Zero dependencies; Node >= 20. Reads nothing from the network except the
// public GitHub REST/GraphQL API through the already-authenticated `gh` CLI.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'site.config.json');
const DATA_OUT = join(ROOT, 'public', 'data.json');
const AVATAR_OUT = join(ROOT, 'public', 'avatar.png');
const PUSH = process.argv.includes('--push');

const OWNER = 'JacopoBonta';

function gh(args) {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function ghPaginate(path) {
  // gh api --paginate already concatenates array pages.
  return JSON.parse(gh(['--paginate', path]));
}

// ---------------------------------------------------------------- helpers

const FALLBACK_LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Go: '#00ADD8', Python: '#3572A5',
  Rust: '#dea584', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', C: '#555555',
  'C++': '#f34b7d', 'C#': '#178600', Java: '#b07219', Kotlin: '#A97BFF',
  Swift: '#F05138', Ruby: '#701516', PHP: '#4F5D95', Vue: '#41b883', Dart: '#00B4AB',
  Elixir: '#6e4a7e', Lua: '#000080', Scala: '#c22d40', HCL: '#844FBA',
  Dockerfile: '#384d54', Makefile: '#427819', Nix: '#7e7eff', Zig: '#ec915c',
};

const NEUTRAL = '#8b949e';

function langColor(name) {
  return FALLBACK_LANG_COLORS[name] || NEUTRAL;
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function fail(msg) {
  console.error(`update: ${msg}`);
  process.exit(1);
}

// Atomic write: temp file in the same directory, then rename.
function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

// ---------------------------------------------------------------- fetch

function fetchProfile() {
  // Public profile endpoint — works with any token, including the CI
  // GITHUB_TOKEN (whose authenticated /user would be github-actions[bot]).
  const u = ghJson([`users/${OWNER}`]);
  if (u.login !== OWNER) fail(`expected profile for ${OWNER}, got ${u.login}`);
  return {
    login: u.login,
    name: u.name,
    bio: u.bio,
    company: u.company,
    location: u.location,
    followers: u.followers,
    following: u.following,
    publicRepos: u.public_repos,
    avatarUrl: u.avatar_url,
    htmlUrl: u.html_url,
  };
}

function fetchRepos() {
  const all = ghPaginate(`users/${OWNER}/repos?per_page=100&sort=pushed`);
  const mine = all.filter((r) => !r.fork && !r.archived && r.owner.login === OWNER);
  return mine.map((r) => ({
    name: r.name,
    description: r.description,
    homepage: r.homepage || null,
    htmlUrl: r.html_url,
    stars: r.stargazers_count,
    forks: r.forks_count,
    watchers: r.watchers_count,
    openIssues: r.open_issues_count,
    language: r.language,
    topics: r.topics || [],
    isPrivate: r.private,
    createdAt: fmtDate(r.created_at),
    pushedAt: fmtDate(r.pushed_at),
    updatedAt: fmtDate(r.updated_at),
  }));
}

function fetchPinned() {
  const q = `query { user(login: "${OWNER}") { pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { name } } } } }`;
  const res = ghJson(['graphql', '-f', `query=${q}`]);
  const nodes = res?.data?.user?.pinnedItems?.nodes;
  if (!nodes) return [];
  return nodes.map((n) => n.name).filter(Boolean);
}

function fetchLanguages(names) {
  const out = {};
  for (const name of names) {
    try {
      out[name] = ghJson([`repos/${OWNER}/${name}/languages`]);
    } catch {
      out[name] = {}; // deleted mid-run or other transient failure: not fatal
    }
  }
  return out;
}

// Contribution calendar — public contributions only, so private activity
// never reaches data.json regardless of which token runs the generator.
function fetchContributions() {
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const q = `query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        onlyPublicContributions: contributionCalendar {
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }`;
  let cal;
  try {
    const res = ghJson([
      'graphql',
      '-f', `login=${OWNER}`,
      '-F', `from=${from}T00:00:00Z`,
      '-F', `to=${to}T23:59:59Z`,
      '-f', `query=${q}`,
    ]);
    cal = res?.data?.user?.contributionsCollection?.onlyPublicContributions;
  } catch {
    return null; // non-fatal: the page just omits the heatmap section
  }
  if (!cal || !Array.isArray(cal.weeks) || !cal.weeks.length) return null;

  // Re-anchor to GitHub's standard layout: 53 week columns, each a full
  // Sun–Sat column, column-major flat array. The API anchors week columns to
  // the from-date's weekday instead, so pad the head to the preceding Sunday
  // and the tail to a whole 7-day column. Zeros contribute nothing to totals.
  const cells = [];
  for (const week of cal.weeks) {
    for (const day of week.contributionDays) {
      cells.push(Number(day.contributionCount) || 0);
    }
  }
  const first = cal.weeks[0]?.contributionDays?.[0]?.date;
  if (!first) return null;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const padded = [...Array(lead).fill(0), ...cells];
  const tail = (7 - (padded.length % 7)) % 7;
  const days = padded.concat(Array(tail).fill(0));

  return {
    start: first.slice(0, 10),
    end: to,
    // The calendar object carries no total field in the current schema — sum
    // the day counts instead.
    total: cells.reduce((s, n) => s + n, 0),
    days,
  };
}

function fetchEvents() {
  const events = ghJson([`users/${OWNER}/events/public?per_page=30`]);
  const out = [];
  for (const e of events) {
    const repo = e.repo?.name ?? null;
    let kind = null;
    let detail = null;
    switch (e.type) {
      case 'PushEvent':
        kind = 'push';
        detail = {
          commits: e.payload?.size ?? 0,
          message: (e.payload?.commits?.[e.payload.commits.length - 1]?.message ?? '').split('\n')[0] || null,
        };
        break;
      case 'CreateEvent':
        kind = e.payload?.ref_type === 'repository' ? 'repo-created' : `create-${e.payload?.ref_type ?? 'unknown'}`;
        detail = { ref: e.payload?.ref ?? null, refType: e.payload?.ref_type ?? null };
        break;
      case 'WatchEvent':
        kind = 'starred';
        detail = null;
        break;
      case 'ForkEvent':
        kind = 'forked';
        detail = null;
        break;
      case 'PullRequestEvent': {
        const action = e.payload?.action ?? null;
        if (action === 'opened' || action === 'merged' || action === 'closed') {
          kind = `pr-${action}`;
          detail = { title: e.payload?.pull_request?.title ?? null, number: e.payload?.number ?? null };
        }
        break;
      }
      case 'IssuesEvent': {
        const action = e.payload?.action ?? null;
        if (action === 'opened' || action === 'closed') {
          kind = `issue-${action}`;
          // IssuesEvent payloads carry only action + issue — the number lives
          // on the issue object (unlike PullRequestEvent's top-level number).
          detail = { title: e.payload?.issue?.title ?? null, number: e.payload?.issue?.number ?? null };
        }
        break;
      }
      case 'ReleaseEvent':
        kind = 'release';
        detail = { tag: e.payload?.release?.tag_name ?? null, name: e.payload?.release?.name ?? null };
        break;
      case 'PublicEvent':
        kind = 'publicized';
        detail = null;
        break;
      default:
        break; // ignore other event types
    }
    if (kind) out.push({ repo, kind, detail, date: fmtDate(e.created_at) });
  }
  return out;
}

// ---------------------------------------------------------------- merge

function buildData(cfg, profile, repos, pinned, languages, events, contributions) {
  // Config-driven curation: hide list, description/homepage overrides, and the
  // Past-projects cutoff (repos not pushed within archiveAfterDays days).
  const hide = new Set(Array.isArray(cfg.hide) ? cfg.hide : []);
  const overrides = cfg.overrides && typeof cfg.overrides === 'object' ? cfg.overrides : {};
  const archiveAfterDays = Number.isFinite(cfg.archiveAfterDays) ? cfg.archiveAfterDays : 730;
  const cutoff = Date.now() - archiveAfterDays * 24 * 60 * 60 * 1000;
  const curated = repos
    .filter((r) => !hide.has(r.name))
    .map((r) => {
      const o = overrides[r.name] || {};
      return {
        ...r,
        description: o.description ?? r.description,
        homepage: o.homepage ?? r.homepage,
        past: !r.pushedAt || new Date(`${r.pushedAt}T00:00:00Z`).getTime() < cutoff,
      };
    });

  // Featured resolution: curated override -> pinned -> top-starred.
  let featured = [];
  if (Array.isArray(cfg.featured) && cfg.featured.length > 0) {
    featured = cfg.featured
      .map((name) => curated.find((r) => r.name === name))
      .filter(Boolean);
  }
  if (featured.length === 0 && pinned.length > 0) {
    featured = pinned.map((name) => curated.find((r) => r.name === name)).filter(Boolean);
  }
  if (featured.length === 0) {
    featured = [...curated].sort((a, b) => b.stars - a.stars || (b.pushedAt || '').localeCompare(a.pushedAt || '')).slice(0, 3);
  }

  // Language byte counts for the repos we enriched.
  const langBytes = {};
  for (const r of curated) {
    const counts = languages[r.name] || {};
    for (const [lang, bytes] of Object.entries(counts)) {
      langBytes[lang] = (langBytes[lang] || 0) + bytes;
    }
  }
  const languagesSummary = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => ({ name, bytes, color: langColor(name) }));

  const stats = {
    publicRepos: profile.publicRepos,
    totalStars: curated.reduce((s, r) => s + r.stars, 0),
    followers: profile.followers,
    lastPush: curated.reduce((m, r) => (r.pushedAt && (!m || r.pushedAt > m) ? r.pushedAt : m), null),
  };

  return {
    generatedAt: new Date().toISOString(),
    profile: {
      login: profile.login,
      name: profile.name,
      bio: profile.bio,
      company: profile.company,
      location: profile.location,
      followers: profile.followers,
      htmlUrl: profile.htmlUrl,
      avatar: 'public/avatar.png',
    },
    site: cfg.site,
    about: cfg.about ?? null,
    links: cfg.links ?? [],
    stats,
    featured: featured.map((r) => ({
      ...r,
      languageColor: r.language ? langColor(r.language) : null,
      languages: languages[r.name] || null,
    })),
    languages: languagesSummary,
    repos: [...curated].sort((a, b) => b.stars - a.stars || (b.pushedAt || '').localeCompare(a.pushedAt || '')),
    events: events.slice(0, 15),
    eventCount: events.length,
    contributions: contributions ?? null,
  };
}

// ---------------------------------------------------------------- avatar

function updateAvatar(profile) {
  if (!profile.avatarUrl) return;
  const url = `${profile.avatarUrl}&s=240`;
  let buf;
  try {
    buf = execFileSync('curl', ['-fsSL', url], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
  } catch {
    console.error('update: avatar download failed, keeping previous');
    return;
  }
  if (!buf || buf.length === 0) return;
  if (existsSync(AVATAR_OUT)) {
    const prev = statSync(AVATAR_OUT);
    if (prev.size === buf.length) {
      const prevBuf = readFileSync(AVATAR_OUT);
      if (prevBuf.equals(buf)) return; // unchanged
    }
  }
  writeAtomic(AVATAR_OUT, buf);
}

// ---------------------------------------------------------------- main

mkdirSync(dirname(DATA_OUT), { recursive: true });

let cfg;
try {
  cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
} catch (e) {
  fail(`cannot read ${CONFIG}: ${e.message}`);
}

console.log('update: fetching GitHub data (public endpoints only)…');
const profile = fetchProfile();
const repos = fetchRepos();
const pinned = fetchPinned();
const featuredNames = (cfg.featured ?? []).slice(0, 10);
const languages = fetchLanguages(featuredNames);
const contributions = fetchContributions();
const events = fetchEvents();
console.log(`update: ${repos.length} own public repos, ${events.length} recent public events, ${pinned.length} pinned, ${contributions ? contributions.total : 'no'} public contributions`);

const data = buildData(cfg, profile, repos, pinned, languages, events, contributions);

writeAtomic(DATA_OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`update: wrote ${DATA_OUT} (${data.repos.length} repos, generated ${data.generatedAt})`);

updateAvatar(profile);

if (PUSH) {
  const { execFileSync: run } = await import('node:child_process');
  const git = (args) => run('git', args, { encoding: 'utf8', cwd: ROOT });
  const status = git(['status', '--porcelain']);
  if (!status.trim()) {
    console.log('update: nothing to commit');
  } else {
    const date = new Date().toISOString().slice(0, 10);
    git(['add', 'public/data.json', 'public/avatar.png']);
    git(['commit', '-m', `data: refresh snapshot ${date}`]);
    git(['push', 'origin', 'main']);
    console.log('update: committed and pushed — Actions CI will deploy');
  }
}
