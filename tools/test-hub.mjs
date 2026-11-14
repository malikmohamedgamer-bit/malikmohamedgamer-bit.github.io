// Hub tests with Playwright (Edge). Run under the Firebase emulators so votes and live stats are real:
//   npx firebase-tools emulators:exec --only database,auth --project demo-gamehub "node tools/test-hub.mjs"
// Without the emulators (or with --no-stats) the stats tests are skipped and "—" is checked instead.
// --live https://malikmohamedgamer-bit.github.io checks the deployed hub (read-only checks, real games.json).
// The local run serves site/ plus the sibling game repos on one origin (like GitHub Pages), with a fixture
// games.json built from each repo's game.json. Screenshots go to tools/out/shots/.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './serve.mjs';
import { sharePage } from './discover.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'tools', 'out', 'shots');
mkdirSync(shots, { recursive: true });
const args = process.argv.slice(2);
const liveIdx = args.indexOf('--live');
const LIVE = liveIdx >= 0 ? (args[liveIdx + 1] || 'https://malikmohamedgamer-bit.github.io').replace(/\/$/, '') : null;
const PORT = 8099;
const BASE = LIVE || `http://127.0.0.1:${PORT}`;
const emulatorUp = !LIVE && !args.includes('--no-stats') && await fetch('http://127.0.0.1:9000/.json?ns=demo-gamehub-default-rtdb').then(() => true, () => false);

let pass = 0, fail = 0;
const results = [];
function check(label, ok, extra = '') {
  if (ok) pass++; else fail++;
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
}

// ---------------------------------------------------------------- fixtures (local only)
const REPOS = ['TDS', 'Tcyoon-RNG', 'Skate-game', 'fps-playtest'];
const fixture = { games: REPOS.map((r) => JSON.parse(readFileSync(join(root, '..', r, 'game.json'), 'utf8'))).map((g) => {
  const loc = (u) => u.replace('https://malikmohamedgamer-bit.github.io', BASE);
  return { ...g, icon: loc(g.icon), banner: loc(g.banner), url: loc(g.url), updatedAt: '2026-11-14T12:00:00Z' };
}) };
const emuConfig = `export const firebaseConfig = ${JSON.stringify({ apiKey: 'demo-key', projectId: 'demo-gamehub', authDomain: 'demo-gamehub.firebaseapp.com', databaseURL: 'http://127.0.0.1:9000?ns=demo-gamehub-default-rtdb', emulator: { db: '127.0.0.1:9000', auth: '127.0.0.1:9099' } })};`;

const server = LIVE ? null : await start(PORT, { games: true });
const browser = await chromium.launch({ channel: 'msedge' });

async function newCtx({ width, height, theme = 'dark', stats = emulatorUp, shareApi = false, mobile = false, persistent = false } = {}) {
  // the hub's service worker answers /games.json itself (bypassing the fixture route), so only the PWA test allows it
  const opts = { viewport: { width, height }, colorScheme: theme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: persistent || LIVE ? 'allow' : 'block' };
  // installability needs a real (non-incognito) profile
  const ctx = persistent ? await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'hub-pwa-')), { channel: 'msedge', ...opts }) : await browser.newContext(opts);
  if (!LIVE) {
    await ctx.route('**/games.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
    await ctx.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stats ? emuConfig : 'export const firebaseConfig = null;' }));
    await ctx.route('**/g/*/', async (r) => { // share pages as discover.mjs would generate them
      const slug = new URL(r.request().url()).pathname.split('/')[2];
      const g = fixture.games.find((x) => x.slug === slug);
      return g ? r.fulfill({ contentType: 'text/html', body: sharePage(g) }) : r.fallback();
    });
  }
  if (!shareApi) await ctx.addInitScript(() => { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch { /* ignore */ } });
  return ctx;
}
function watch(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url || ''}`.trim()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
const rowsOf = (page) => page.$$eval('#list > li.row:not(.skeleton)', (els) => els.map((e) => e.dataset.slug));
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
const waitStats = (page) => page.waitForFunction(() => /\d/.test(document.querySelector('#total-online').textContent), null, { timeout: 30000 });

async function suite(size) {
  const label = `${size.width}x${size.height}`;
  console.log(`\n== hub at ${label}`);
  const ctx = await newCtx(size);
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForSelector('#list > li.row:not(.skeleton)');
  const slugs = await rowsOf(page);
  check(`${label}: list renders from games.json`, slugs.length === (LIVE ? slugs.length : 4) && slugs.length > 0, slugs.join(', '));
  check(`${label}: no horizontal scroll`, await noHScroll(page));
  if (emulatorUp) { await waitStats(page); check(`${label}: live stats show numbers`, /\d/.test(await page.textContent('.row .n-plays'))); }
  else if (!LIVE) { await page.waitForTimeout(1500); check(`${label}: stats unavailable show —`, (await page.textContent('#total-online')).trim() === '—' && (await page.textContent('.row .n-plays')).trim() === '—'); }

  // search
  await page.fill('#search', 'skate');
  check(`${label}: search filters`, JSON.stringify(await rowsOf(page)) === JSON.stringify(['bolt-skate']));
  await page.fill('#search', 'zzzz');
  check(`${label}: search empty state`, (await page.textContent('#list')).includes('No games match'));
  await page.fill('#search', '');
  // tags
  await page.click('#tags .chip[data-tag="Shooter"]');
  check(`${label}: tag filter`, JSON.stringify(await rowsOf(page)) === JSON.stringify(['snapfire']));
  await page.click('#tags .chip[data-tag="Shooter"]');
  check(`${label}: tag filter clears`, (await rowsOf(page)).length === 4);
  // sort
  await page.selectOption('#sort', 'newest');
  check(`${label}: sort newest`, JSON.stringify(await rowsOf(page)) === JSON.stringify(['riftkeep', 'rollforge', 'snapfire', 'bolt-skate']));
  for (const v of ['plays', 'rating', 'online']) { await page.selectOption('#sort', v); check(`${label}: sort ${v} keeps every game`, (await rowsOf(page)).length === 4); }

  // favourites: persist across reloads and float to the top of All
  await page.click('#tab-favs');
  check(`${label}: favourites empty state`, (await page.textContent('#list')).includes('No favourites yet'));
  await page.click('#tab-all');
  await page.selectOption('#sort', 'newest');
  await page.click('li[data-slug="bolt-skate"] .act.fav');
  check(`${label}: favourite floats to the top`, (await rowsOf(page))[0] === 'bolt-skate');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#list > li.row:not(.skeleton)');
  check(`${label}: favourite persists after reload`, (await page.getAttribute('li[data-slug="bolt-skate"] .act.fav', 'aria-pressed')) === 'true' && (await rowsOf(page))[0] === 'bolt-skate');
  check(`${label}: sort choice persists`, (await page.inputValue('#sort')) === 'newest');
  await page.click('#tab-favs');
  check(`${label}: Favourites tab`, JSON.stringify(await rowsOf(page)) === JSON.stringify(['bolt-skate']));
  await page.click('#tab-all');

  // detail view
  await page.click('li[data-slug="snapfire"] .row-main');
  await page.waitForSelector('#detail[open]');
  check(`${label}: detail view opens`, (await page.textContent('#d-name')) === 'Snapfire' && (await page.$$eval('#d-controls li', (l) => l.length)) > 3 && (await page.getAttribute('#d-banner', 'src')).endsWith('banner.jpg'));
  check(`${label}: detail shows platforms, date and GitHub link`, (await page.textContent('#d-platforms')) === 'Desktop' && /\d/.test(await page.textContent('#d-updated')) && (await page.getAttribute('#d-repo', 'href')).includes('github.com'));
  check(`${label}: detail URL is shareable`, page.url().endsWith('/?g=snapfire'));
  check(`${label}: detail has no horizontal scroll`, await page.$eval('#detail', (d) => d.scrollWidth <= d.clientWidth));
  await page.waitForTimeout(400); // let the open animation finish
  await page.screenshot({ path: join(shots, `detail-${label}-${size.theme || 'dark'}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#detail').open && !location.search, null, { timeout: 3000 }).catch(() => {});
  const closed = !(await page.$('#detail[open]'));
  check(`${label}: detail closes with Esc`, closed && page.url() === `${BASE}/`, `open=${!closed} url=${page.url()}`);
  if (!closed) await page.click('#d-close');

  // share fallback (no Web Share API): copies /g/<slug>/ and shows a toast
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.click('li[data-slug="riftkeep"] .act.share');
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('show'));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(`${label}: share falls back to copy + toast`, clip === `${BASE}/g/riftkeep/` && (await page.textContent('#toast')) === 'Link copied', clip);

  // votes (emulator): like, unlike, switch; a second user sees the counts live
  if (emulatorUp) {
    const other = await (await newCtx(size)).newPage();
    await other.goto(`${BASE}/`); await waitStats(other);
    const n = (p, sel) => p.textContent(`li[data-slug="rollforge"] ${sel}`).then((t) => Number(t.trim()));
    const pressed = (sel) => page.getAttribute(`li[data-slug="rollforge"] ${sel}`, 'aria-pressed');
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector('li[data-slug="rollforge"] .n-likes').textContent.trim()), null, { timeout: 15000 });
    const l0 = await n(page, '.n-likes'), d0 = await n(page, '.n-dislikes');
    await page.click('li[data-slug="rollforge"] .act.like');
    check(`${label}: like updates at once (optimistic)`, (await n(page, '.n-likes')) === l0 + 1 && (await pressed('.act.like')) === 'true');
    await other.waitForFunction((v) => Number(document.querySelector('li[data-slug="rollforge"] .n-likes').textContent) === v, l0 + 1, { timeout: 15000 }).then(() => check(`${label}: like is live for another user`, true), () => check(`${label}: like is live for another user`, false));
    await page.click('li[data-slug="rollforge"] .act.dislike');
    await page.waitForTimeout(400);
    check(`${label}: switching to dislike moves the vote`, (await n(page, '.n-likes')) === l0 && (await n(page, '.n-dislikes')) === d0 + 1 && (await pressed('.act.dislike')) === 'true' && (await pressed('.act.like')) === 'false');
    await page.click('li[data-slug="rollforge"] .act.dislike');
    await page.waitForTimeout(400);
    check(`${label}: tapping again undoes the vote`, (await n(page, '.n-dislikes')) === d0 && (await pressed('.act.dislike')) === 'false');
    await page.click('li[data-slug="rollforge"] .act.like');
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'load' }); await waitStats(page); await page.waitForTimeout(800);
    check(`${label}: my vote is remembered after reload`, (await pressed('.act.like')) === 'true' && (await n(page, '.n-likes')) === l0 + 1);
    await other.click('li[data-slug="rollforge"] .act.like');
    await page.waitForFunction((v) => Number(document.querySelector('li[data-slug="rollforge"] .n-likes').textContent) === v, l0 + 2, { timeout: 15000 }).then(() => check(`${label}: second user's like arrives live`, true), () => check(`${label}: second user's like arrives live`, false));
    await other.context().close();
  }

  // recently played: Play is a plain same-origin link (no target=_blank)
  const play = page.locator('li[data-slug="bolt-skate"] a.play:visible').first();
  check(`${label}: Play is a same-origin link without target`, (await play.getAttribute('target')) === null && (await play.getAttribute('href')).startsWith('/Skate-game/'));
  if (!LIVE) {
    await play.click();
    await page.waitForURL('**/Skate-game/');
    await page.waitForFunction(() => window.__gameHubSdk === true, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500); // let the game finish starting before leaving it
    await page.goBack(); await page.waitForSelector('#list > li.row:not(.skeleton)');
    await page.click('#tab-recent');
    check(`${label}: Recently played lists the game`, (await rowsOf(page))[0] === 'bolt-skate');
    await page.click('#tab-all');
  }

  // themes + screenshots
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(shots, `hub-${label}-${theme}.png`), fullPage: true });
  }
  check(`${label}: no horizontal scroll at the end`, await noHScroll(page));
  check(`${label}: no console errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function sharePages() {
  console.log('\n== share pages');
  const ctx = await newCtx({ width: 800, height: 600 });
  const page = await ctx.newPage();
  for (const slug of ['riftkeep', 'snapfire']) {
    if (page.url() === 'about:blank') await page.goto(`${BASE}/404-probe`);
    const { ok, html } = await page.evaluate(async (u) => { const r = await fetch(u, { cache: 'no-store' }); return { ok: r.ok, html: await r.text() }; }, `${BASE}/g/${slug}/`);
    const og = (p) => (html.match(new RegExp(`property="og:${p}" content="([^"]+)"`)) || [])[1];
    check(`/g/${slug}/ has OG title, description, image`, ok && !!og('title') && !!og('description') && /banner\.jpg$/.test(og('image') || ''), `${og('title')} | ${og('image')}`);
    await page.goto(`${BASE}/g/${slug}/`);
    await page.waitForSelector('#detail[open]', { timeout: 15000 }).catch(() => {});
    check(`/g/${slug}/ redirects to the detail view`, page.url().endsWith(`/?g=${slug}`) && (await page.$('#detail[open]')) !== null);
  }
  await ctx.close();
}

async function pwa() {
  console.log('\n== PWA (CDP)');
  const ctx = await newCtx({ width: 1280, height: 800, persistent: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const ready = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]));
  check('service worker installs', ready);
  await page.reload({ waitUntil: 'load' });
  const cdp = await ctx.newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest');
  check('manifest parses with no errors', (man.errors || []).length === 0 && /Game Hub/.test(man.data || ''), JSON.stringify(man.errors));
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('installability errors are empty', (inst.installabilityErrors || []).length === 0, JSON.stringify(inst.installabilityErrors));
  check('service worker controls the hub', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const hubRes = await page.goto(`${BASE}/`, { waitUntil: 'load' });
  check('hub page comes through the service worker', hubRes.fromServiceWorker());
  for (const path of ['/Skate-game/', '/fps-playtest/']) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    const sub = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.workerStart > 0 && e.name.includes('/hub-sdk.js')).length);
    check(`service worker does not intercept ${path}`, res.status() === 200 && !res.fromServiceWorker(), `status ${res.status()}`);
    const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (ctl) {
      const sdk = await page.evaluate(async () => { const r = await fetch('/hub-sdk.js', { cache: 'no-store' }); return r.ok; });
      check(`${path}: hub-sdk.js reachable while the hub worker is installed`, sdk);
    }
    void sub;
  }
  await ctx.close();
}

async function sdk() {
  if (LIVE) return;
  console.log('\n== hub SDK on a game page (local mount of Skate-game)');
  // Edge ignores CDP display-mode emulation, so standalone is emulated the way the SDK detects it:
  // matchMedia('(display-mode: standalone)') for installed Chrome/Android apps, navigator.standalone for iOS.
  for (const standalone of [false, 'display-mode', 'ios']) {
    const ctx = await newCtx({ width: 1280, height: 720 });
    const page = await ctx.newPage();
    const errors = watch(page);
    if (standalone === 'display-mode') await page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
    if (standalone === 'ios') await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }); });
    await page.goto(`${BASE}/Skate-game/`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    const loaded = await page.evaluate(() => window.__gameHubSdk === true);
    const btn = await page.$('[data-game-hub]');
    check(`SDK loads (${standalone ? 'standalone' : 'browser tab'})`, loaded);
    check(`"← Hub" ${standalone ? `shown when standalone (${standalone})` : 'hidden in a browser tab'}`, standalone ? !!btn : !btn);
    if (standalone === 'display-mode' && btn) {
      const shown = () => page.$eval('[data-game-hub]', (h) => getComputedStyle(h).display !== 'none');
      const box = await btn.boundingBox();
      check('"← Hub" sits in its corner and is small', box && box.x < 60 && box.y < 60 && box.height <= 50, JSON.stringify(box));
      await page.evaluate(() => document.documentElement.requestFullscreen());
      await page.waitForTimeout(400);
      const inFs = await page.evaluate(() => !!document.fullscreenElement);
      check('"← Hub" hides during fullscreen', inFs && !(await shown()), `fullscreen=${inFs}`);
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForTimeout(400);
      check('"← Hub" returns after fullscreen', await shown());
      await page.mouse.click(640, 400);
      await page.evaluate(() => document.querySelector('canvas').requestPointerLock());
      await page.waitForTimeout(400);
      const locked = await page.evaluate(() => !!document.pointerLockElement);
      if (locked) { check('"← Hub" hides during pointer lock', !(await shown())); await page.evaluate(() => document.exitPointerLock()); }
      else console.log('  note pointer lock not granted in this browser session; hiding is covered by the same handler as fullscreen');
      await page.waitForTimeout(300);
      const pos = await btn.boundingBox();
      await page.mouse.click(pos.x + pos.width / 2, pos.y + pos.height / 2);
      await page.waitForURL(`${BASE}/`, { timeout: 10000 }).then(() => check('"← Hub" goes back to the hub', true), () => check('"← Hub" goes back to the hub', false, page.url()));
    }
    if (emulatorUp) {
      await page.waitForTimeout(3000);
      const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('hub.recent') || '{}'));
      check(`SDK records the play locally (${standalone ? 'standalone' : 'tab'})`, !!recent['bolt-skate']);
    }
    check(`no console errors on the game page (${standalone ? 'standalone' : 'tab'})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  if (emulatorUp) { // presence + play counted, seen from the hub
    const gctx = await newCtx({ width: 1000, height: 700 });
    const game = await gctx.newPage();
    await game.goto(`${BASE}/Skate-game/`, { waitUntil: 'load' });
    const hctx = await newCtx({ width: 1000, height: 700 });
    const hub = await hctx.newPage();
    await hub.goto(`${BASE}/`); await waitStats(hub);
    await hub.waitForFunction(() => Number(document.querySelector('li[data-slug="bolt-skate"] .n-online').textContent) >= 1, null, { timeout: 20000 })
      .then(() => check('a player in the game shows as online in the hub', true), () => check('a player in the game shows as online in the hub', false));
    const plays = await hub.textContent('li[data-slug="bolt-skate"] .n-plays');
    check('the visit counted as a play', Number(plays) >= 1, plays);
    await gctx.close();
    await hub.waitForFunction(() => Number(document.querySelector('li[data-slug="bolt-skate"] .n-online').textContent) === 0, null, { timeout: 20000 })
      .then(() => check('online drops when the game tab closes', true), () => check('online drops when the game tab closes', false));
    await hctx.close();
  }
}

const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
const want = (n) => !only || only.includes(n);
try {
  console.log(`testing ${BASE} (${emulatorUp ? 'live stats on the emulator' : LIVE ? 'deployed site' : 'no stats backend'})`);
  if (want('desktop')) await suite({ width: 1280, height: 800 });
  if (want('mobile')) await suite({ width: 390, height: 844, mobile: true });
  if (want('share') && (!LIVE || existsSync(join(root, 'site', 'g')))) await sharePages();
  if (want('pwa')) await pwa();
  if (want('sdk')) await sdk();
} catch (e) {
  fail++; console.log(`  FAIL crashed: ${e.stack}`);
} finally {
  await browser.close();
  if (server) server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
