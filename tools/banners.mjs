// node tools/banners.mjs [slug ...] [--out dir]
// Takes a real 1280x720 gameplay screenshot of each live game with Playwright (Edge) and saves it as
// tools/out/banners/<slug>.jpg. Each flow starts the game and sends real input before the shot.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : join(root, 'tools', 'out', 'banners');
const only = args.filter((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
let BASE = process.env.HUB_BASE || 'https://malikmohamedgamer-bit.github.io';
export const setBase = (b) => { BASE = b; };

const wait = (p, ms) => p.waitForTimeout(ms);
const hold = async (p, key, ms) => { await p.keyboard.down(key); await wait(p, ms); await p.keyboard.up(key); };

export const FLOWS = {
  async riftkeep(p) {
    await p.goto(`${BASE}/TDS/`, { waitUntil: 'load' });
    await p.getByTestId('lobby').waitFor({ timeout: 90000 });
    const tut = p.getByTestId('lobby').locator('[name="tutorial"]');
    if (await tut.count()) await tut.uncheck();
    await p.getByTestId('start').click();
    await p.waitForFunction(() => window.TDS && window.TDS.match && window.TDS.ctrl.view, null, { timeout: 90000 });
    await p.evaluate(() => { // build a defence through the game's normal command path
      window.TDS.debug.setCash(20000);
      for (const [tower, x, z] of [['rifleman', -10, -12], ['rifleman', -10, 0], ['ember_adept', -4, -6], ['rifleman', -18, -8], ['ember_adept', -2, 4], ['rifleman', -16, 4]]) {
        try { window.TDS.ctrl.command({ type: 'place', tower, x, z }); } catch { /* tile refused */ }
      }
    });
    await p.getByTestId('skip').click(); // start the wave
    await p.evaluate(() => window.TDS.debug.fastForward(9));
    await p.evaluate(() => { window.TDS.teleport(-2, 6); window.TDS.setDistance(20); window.TDS.lookAt(-12, -6, 0.5); });
    await wait(p, 2500);
  },
  async rollforge(p) {
    await p.goto(`${BASE}/Tcyoon-RNG/`, { waitUntil: 'load' });
    await wait(p, 6000);
    await p.locator('.modal [data-choice="relaxed"]').click();
    await p.evaluate(() => window.__game.game.tutorial.skip({ forever: true }));
    await p.evaluate(() => { window.__game.game.debug.grantMoney(5000); window.__game.game.debug.grantXp(400); });
    for (let i = 0; i < 12; i++) { await p.keyboard.press('Space'); await wait(p, 900); } // real rolls
    await p.evaluate(() => { // put what was rolled on the base, as a player would from the Backpack
      const g = window.__game.game;
      const spots = [[1, 1], [2, 1], [3, 1], [4, 1], [1, 3], [2, 3], [3, 3], [4, 3], [1, 5], [2, 5], [3, 5], [4, 5], [5, 2], [5, 4]];
      for (const [x, y] of spots) { const uid = g.state.bag[0]; if (uid == null) break; try { g.place(uid, x, y, 0); } catch { /* blocked tile */ } }
      g.debug.advance(20);
    });
    await p.keyboard.press('Escape');
    await wait(p, 1500);
    for (let i = 0; i < 3; i++) await p.getByRole('button', { name: /^Got it$/ }).click({ timeout: 1500 }).catch(() => {});
    await wait(p, 2000);
  },
  async 'bolt-skate'(p) {
    await p.goto(`${BASE}/Skate-game/`, { waitUntil: 'load' });
    await wait(p, 5000);
    await p.getByText(/Free roam/i).first().click();
    await wait(p, 800);
    await p.getByText(/Maple Street/i).first().click();
    await wait(p, 6000);
    await hold(p, 'w', 2500);
    await p.keyboard.down('w'); await p.keyboard.press('Space'); await wait(p, 350);
    await p.keyboard.up('w');
  },
  async snapfire(p) {
    await p.goto(`${BASE}/fps-playtest/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.unityInstance, null, { timeout: 120000 });
    await wait(p, 5000);
    const click = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); await wait(p, 120); await p.mouse.up(); };
    await click(160, 404); // PLAY
    await wait(p, 4000);
    await click(240, 589); // PRACTICE VS BOT (offline)
    await wait(p, 4500);
    await p.mouse.move(700, 380); await hold(p, 'w', 700);
    await wait(p, 300);
  },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  for (const [slug, flow] of Object.entries(FLOWS)) {
    if (only.length && !only.includes(slug)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await flow(page);
      await page.screenshot({ path: join(out, `${slug}.jpg`), type: 'jpeg', quality: 85 });
      console.log(`${slug}: saved${errors.length ? ` (page errors: ${errors.join(' / ')})` : ''}`);
    } catch (e) {
      await page.screenshot({ path: join(out, `${slug}-failed.png`) }).catch(() => {});
      console.log(`${slug}: FAILED ${e.message}`);
    }
    await page.close();
  }
  await browser.close();
}
