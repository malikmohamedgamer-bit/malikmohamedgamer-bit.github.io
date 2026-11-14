// node tools/test-games.mjs [--local] [slug ...]
// Every game: loads with no console errors, /hub-sdk.js loads, "← Hub" appears only in standalone mode,
// the game still plays (the banner flow starts it and sends real input; the picture must keep changing),
// and the FPS keeps pointer lock + fullscreen. Default target is the live site; --local serves the sibling
// repos on one origin with tools/serve.mjs (games as committed in the working trees).
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { FLOWS, setBase } from './banners.mjs';
import { start } from './serve.mjs';

const args = process.argv.slice(2);
const local = args.includes('--local');
const only = args.filter((a) => !a.startsWith('--'));
const PORT = 8098;
const BASE = local ? `http://127.0.0.1:${PORT}` : 'https://malikmohamedgamer-bit.github.io';
setBase(BASE);
const PATHS = { riftkeep: 'TDS', rollforge: 'Tcyoon-RNG', 'bolt-skate': 'Skate-game', snapfire: 'fps-playtest' };
// errors the game already logged before the hub work (none known), matched by substring
const KNOWN = [];
// games that show their own "← Hub" link (data-hub-button="none") instead of the SDK's floating button
const OWN_LINK = { riftkeep: '[data-testid="game-hub"]' };

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); };
const server = local ? await start(PORT, { games: true }) : null;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const hash = (buf) => createHash('sha1').update(buf).digest('hex');

for (const [slug, path] of Object.entries(PATHS)) {
  if (only.length && !only.includes(slug)) continue;
  console.log(`\n== ${slug} (${BASE}/${path}/)`);
  // 1) normal browser tab: plays, no errors, SDK loaded, no hub button
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url || ''}`.trim()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const sdkRes = page.waitForResponse((r) => r.url() === `${BASE}/hub-sdk.js`, { timeout: 90000 }).catch(() => null);
    try { await FLOWS[slug](page); } catch (e) { check('game starts and takes input', false, e.message.split('\n')[0]); }
    const a = hash(await page.screenshot());
    await page.waitForTimeout(1500);
    const b = hash(await page.screenshot());
    check('game still plays after input (the picture keeps changing)', a !== b);
    const r = await sdkRes;
    check('/hub-sdk.js loads (200)', !!r && r.status() === 200, r ? String(r.status()) : 'not requested');
    check('SDK ran', await page.evaluate(() => window.__gameHubSdk === true));
    check('no "← Hub" in a normal tab (not marked as the app, no button or link shown)', await page.evaluate((sel) => !document.documentElement.hasAttribute('data-hub-app') && !document.querySelector('[data-game-hub]') && !(sel && document.querySelector(sel)?.getClientRects().length), OWN_LINK[slug] || null));
    if (slug === 'snapfire') {
      await page.mouse.click(640, 360);
      await page.waitForTimeout(600);
      const locked = await page.evaluate(() => !!document.pointerLockElement);
      check('pointer lock still works (click captures the mouse)', locked);
      if (locked) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      const fs = await page.evaluate(async () => { try { await document.getElementById('game').requestFullscreen(); return !!document.fullscreenElement; } catch (e) { return `error ${e.name}`; } });
      check('fullscreen still works', fs === true, String(fs));
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    }
    const real = errors.filter((e) => !KNOWN.some((k) => e.includes(k)));
    check('no console errors', real.length === 0, real.slice(0, 4).join(' | '));
    await ctx.close();
  }
  // 2) emulated installed app: the button shows in its corner and links to the hub
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${path}/`, { waitUntil: 'load' });
    // the way back must be visible AND on top (a game's modal <dialog> menu would hide a floating button)
    const sel = OWN_LINK[slug] || '[data-game-hub]';
    const el = await page.waitForSelector(sel, { state: 'visible', timeout: 90000 }).catch(() => null);
    if (el) await page.waitForTimeout(3000); // let the game's own start-up settle over it
    const info = el ? await el.evaluate((n) => {
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const a = n.matches('a') ? n : null;
      return { onTop: !!hit && (hit === n || n.contains(hit)), inView: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, href: a ? a.href : '/', app: document.documentElement.hasAttribute('data-hub-app') };
    }) : null;
    check(`"← Hub" ${OWN_LINK[slug] ? 'link in the game\'s own menu' : 'button'} shows in standalone mode, in view and on top`, !!info && info.onTop && info.inView, JSON.stringify(info));
    check('page marked data-hub-app in standalone mode', !!info && info.app);
    if (OWN_LINK[slug]) check('no floating button when the game shows its own link', !(await page.$('[data-game-hub]')) && !!info && info.href === `${BASE}/`);
    if (el) await page.screenshot({ path: `tools/out/shots/standalone-${slug}.png` }).catch(() => {});
    await ctx.close();
  }
}
await browser.close();
if (server) server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
