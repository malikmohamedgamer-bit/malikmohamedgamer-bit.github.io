// Game Hub service worker. Registered at "/", so the browser hands it fetches for the WHOLE origin,
// including every game (/TDS/, /Skate-game/ ...). It must only answer hub paths: for anything else it
// returns without calling respondWith(), so the browser fetches normally and games are never stale.
// VERSION is stamped by tools/build.mjs on every deploy (new cache, old ones deleted).
const VERSION = 'dev';
const CACHE = `game-hub-${VERSION}`;
const SHELL = [
  '/', '/css/hub.css', '/js/app.js', '/js/stats.js', '/firebase-config.js', '/manifest.webmanifest',
  '/icons/favicon.svg', '/icons/favicon-32.png', '/icons/icon-192.png', '/icons/apple-touch-icon.png',
];
// Exact hub paths this worker may answer. Everything else (games, /g/*, /play/, /hub-sdk.js) goes straight to the network.
const HUB_PATHS = new Set([...SHELL, '/index.html', '/games.json', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/favicon.ico', '/og.png']);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('game-hub-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (!HUB_PATHS.has(path)) return; // not ours: games, shared pages and the SDK are never touched
  if (path === '/' || path === '/index.html') { e.respondWith(networkFirst(req, '/')); return; }
  if (path === '/games.json') { e.respondWith(networkFirst(req, '/games.json')); return; }
  e.respondWith(staleWhileRevalidate(req));
});
