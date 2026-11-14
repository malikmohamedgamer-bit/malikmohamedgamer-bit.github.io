// node tools/serve.mjs [port=8080]: serves site/ at "/" for local testing. Optionally mounts sibling game
// repos under their Pages paths (/TDS/ ...) when --games is passed, so the hub and games share one origin.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || 8080);
const mounts = [['/', join(root, process.env.HUB_DIR || 'site')]];
export const GAME_REPOS = ['TDS', 'Tcyoon-RNG', 'Skate-game', 'fps-playtest'];
function mountGames() { for (const repo of GAME_REPOS) if (!mounts.some(([m]) => m === `/${repo}/`)) mounts.unshift([`/${repo}/`, join(root, '..', repo)]); }
if (process.argv.includes('--games')) mountGames();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8' };

export function start(p = port, { games = false } = {}) {
  if (games) mountGames();
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const [prefix, dir] = mounts.find(([m]) => path.startsWith(m) || path + '/' === m);
      let file = normalize(join(dir, path.slice(Math.min(prefix.length, path.length))));
      if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
      let s = await stat(file).catch(() => null);
      if (s && s.isDirectory()) {
        if (!path.endsWith('/')) { res.writeHead(301, { Location: path + '/' }).end(); return; }
        file = join(file, 'index.html'); s = await stat(file).catch(() => null);
      }
      if (!s) { const nf = await readFile(join(dir, '404.html')).catch(() => 'Not found'); res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(nf); return; }
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((r) => server.listen(p, '127.0.0.1', () => r(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await start();
  console.log(`Game Hub on http://127.0.0.1:${port}/`);
}
