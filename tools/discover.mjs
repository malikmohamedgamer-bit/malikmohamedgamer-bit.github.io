// node tools/discover.mjs [--check]   |   node tools/discover.mjs --validate path/to/game.json
// Auto-discovery: lists the owner's PUBLIC repos with the topic `hub-game`, fetches each deployed game.json,
// validates it, and regenerates site/games.json and site/g/<slug>/index.html (share pages with the game's
// Open Graph tags). Files are only rewritten when their content changes. No npm dependencies (runs in Actions
// straight after checkout). --check validates and prints without writing.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OWNER = 'malikmohamedgamer-bit';
export const ORIGIN = `https://${OWNER}.github.io`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const check = process.argv.includes('--check');

const LIMITS = { name: 20, tagline: 60, description: 160, longDescription: 1200 };
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLATFORMS = new Set(['desktop', 'mobile']);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Returns [game, errors]. Unknown fields are dropped; `color` is an optional extra. */
export function validateGame(raw, repo) {
  const e = [];
  const g = {};
  const str = (k, max, req = true) => {
    const v = raw?.[k];
    if (typeof v !== 'string' || !v.trim()) { if (req) e.push(`${k}: required string`); return; }
    if (max && v.length > max) e.push(`${k}: ${v.length} chars (max ${max})`);
    g[k] = v.trim();
  };
  const url = (k, sameOwner) => {
    const v = raw?.[k];
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:') throw new Error();
      if (sameOwner && !v.startsWith(sameOwner)) e.push(`${k}: must start with ${sameOwner}`);
      g[k] = u.href;
    } catch { e.push(`${k}: must be an absolute https URL`); }
  };
  str('slug'); if (g.slug && !SLUG.test(g.slug)) e.push('slug: lowercase letters, digits and dashes (max 40)');
  str('name', LIMITS.name); str('tagline', LIMITS.tagline); str('description', LIMITS.description); str('longDescription', LIMITS.longDescription);
  if (!Array.isArray(raw?.tags) || !raw.tags.length || raw.tags.length > 6 || raw.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 20)) e.push('tags: 1-6 strings of at most 20 chars');
  else g.tags = raw.tags.map((t) => t.trim());
  if (!Array.isArray(raw?.controls) || raw.controls.some((c) => typeof c !== 'string' || c.length > 160)) e.push('controls: array of strings (max 160 chars each)');
  else g.controls = raw.controls;
  if (!Array.isArray(raw?.platforms) || !raw.platforms.length || raw.platforms.some((p) => !PLATFORMS.has(p))) e.push('platforms: subset of ["desktop","mobile"]');
  else g.platforms = [...new Set(raw.platforms)];
  url('icon'); url('banner'); url('url');
  url('repo', `https://github.com/${OWNER}/`);
  if (repo && g.repo && g.repo.replace(/\/$/, '').toLowerCase() !== repo.html_url.toLowerCase()) e.push(`repo: ${g.repo} is not ${repo.html_url}`);
  if (typeof raw?.addedAt !== 'string' || Number.isNaN(Date.parse(raw.addedAt))) e.push('addedAt: ISO date'); else g.addedAt = raw.addedAt;
  if (raw?.color != null) { if (HEX.test(raw.color)) g.color = raw.color; else e.push('color: #RRGGBB'); }
  return [g, e];
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

async function api(path, tk) {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'game-hub-discovery', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sharePage(g) {
  const page = `${ORIGIN}/g/${g.slug}/`;
  const target = `/?g=${encodeURIComponent(g.slug)}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(g.name)} · Game Hub</title>
  <meta name="description" content="${esc(g.description)}">
  <link rel="canonical" href="${esc(page)}">
  <link rel="icon" href="${esc(g.icon)}">
  <meta name="theme-color" content="${esc(g.color || '#0B0D12')}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Game Hub">
  <meta property="og:title" content="${esc(g.name)}">
  <meta property="og:description" content="${esc(g.tagline)}">
  <meta property="og:url" content="${esc(page)}">
  <meta property="og:image" content="${esc(g.banner)}">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="720">
  <meta property="og:image:alt" content="${esc(g.name)} gameplay">
  <meta property="og:image" content="${esc(g.icon)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(g.name)}">
  <meta name="twitter:description" content="${esc(g.tagline)}">
  <meta name="twitter:image" content="${esc(g.banner)}">
  <meta http-equiv="refresh" content="0; url=${esc(target)}">
  <script>location.replace(${JSON.stringify(target)});</script>
  <style>body{margin:0;min-height:100vh;display:grid;place-content:center;background:#0B0D12;color:#E9EDF5;font:16px system-ui,sans-serif}a{color:#22D3EE}</style>
</head>
<body>
  <p><a href="${esc(target)}">Open ${esc(g.name)} in Game Hub</a></p>
</body>
</html>
`;
}

function writeIfChanged(file, text) {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  if (check) return true;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

async function main() {
  const tk = token();
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/users/${OWNER}/repos?per_page=100&type=owner&page=${page}`, tk);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const candidates = repos.filter((r) => !r.private && !r.archived && (r.topics || []).includes('hub-game'));
  console.log(`${candidates.length} public repo(s) with topic hub-game: ${candidates.map((r) => r.name).join(', ') || 'none'}`);
  const games = [];
  let problems = 0;
  for (const r of candidates) {
    const base = (r.homepage && r.homepage.startsWith(`${ORIGIN}/`) ? r.homepage : `${ORIGIN}/${r.name}/`).replace(/\/?$/, '/');
    let raw;
    try {
      const res = await fetch(`${base}game.json`, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) { problems++; console.warn(`  skip ${r.name}: ${base}game.json (${err.message})`); continue; }
    const [g, errors] = validateGame(raw, r);
    if (errors.length) { problems++; console.warn(`  skip ${r.name}: invalid game.json\n    - ${errors.join('\n    - ')}`); continue; }
    if (games.some((x) => x.slug === g.slug)) { problems++; console.warn(`  skip ${r.name}: duplicate slug ${g.slug}`); continue; }
    g.updatedAt = r.pushed_at;
    games.push(g);
    console.log(`  ok   ${r.name} -> ${g.slug} (${g.name})`);
  }
  games.sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.slug.localeCompare(b.slug));
  const order = ['slug', 'name', 'tagline', 'description', 'longDescription', 'tags', 'controls', 'platforms', 'icon', 'banner', 'url', 'repo', 'color', 'addedAt', 'updatedAt'];
  const out = { games: games.map((g) => Object.fromEntries(order.filter((k) => k in g).map((k) => [k, g[k]]))) };
  const changed = [];
  if (writeIfChanged(join(site, 'games.json'), JSON.stringify(out, null, 2) + '\n')) changed.push('games.json');
  for (const g of games) if (writeIfChanged(join(site, 'g', g.slug, 'index.html'), sharePage(g))) changed.push(`g/${g.slug}/`);
  const gdir = join(site, 'g');
  if (existsSync(gdir)) for (const d of readdirSync(gdir)) if (!games.some((g) => g.slug === d)) { if (!check) rmSync(join(gdir, d), { recursive: true, force: true }); changed.push(`removed g/${d}/`); }
  console.log(`${games.length} game(s) listed; ${changed.length ? `${check ? 'would change' : 'changed'}: ${changed.join(', ')}` : 'no changes'}${problems ? `; ${problems} skipped` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const vi = process.argv.indexOf('--validate');
  if (vi >= 0) { // node tools/discover.mjs --validate path/to/game.json
    const [, errors] = validateGame(JSON.parse(readFileSync(process.argv[vi + 1], 'utf8')));
    console.log(errors.length ? ['invalid:', ...errors.map((e) => `  - ${e}`)].join('\n') : 'game.json is valid');
    process.exit(errors.length ? 1 : 0);
  }
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
