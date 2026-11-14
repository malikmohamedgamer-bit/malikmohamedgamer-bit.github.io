// node tools/og.mjs: draws the hub's share image site/og.png (1200x630) from the hub icon master.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icon = readFileSync(join(root, 'tools/out/icons/hub/favicon.svg'), 'utf8').replace(/<\/?svg[^>]*>/g, '');
const rows = [0, 1, 2, 3].map((i) => {
  const y = 150 + i * 92;
  const w = [340, 300, 360, 270][i];
  const c = ['#A07BFF', '#FF8A1F', '#FFC21A', '#FF5A36'][i];
  return `<g opacity="${1 - i * 0.17}"><rect x="664" y="${y}" width="476" height="72" rx="16" fill="#131722" stroke="#252B3A" stroke-width="2"/>
    <rect x="664" y="${y + 18}" width="5" height="36" rx="2.5" fill="${c}"/>
    <rect x="686" y="${y + 14}" width="44" height="44" rx="11" fill="${c}" opacity=".9"/>
    <rect x="746" y="${y + 20}" width="${w - 140}" height="13" rx="6.5" fill="#E9EDF5" opacity=".85"/>
    <rect x="746" y="${y + 42}" width="${w - 190}" height="10" rx="5" fill="${c}" opacity=".7"/>
    <rect x="1040" y="${y + 20}" width="80" height="32" rx="10" fill="${c}"/>
    <circle cx="${746 + w - 120}" cy="${y + 47}" r="5" fill="#3DDC84"/></g>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="g" cx=".25" cy=".35" r=".8"><stop offset="0" stop-color="#0E3440"/><stop offset="1" stop-color="#07090D"/></radialGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <svg x="70" y="70" width="230" height="230" viewBox="0 0 512 512">${icon}</svg>
  <text x="70" y="400" font-family="Segoe UI, Arial, sans-serif" font-size="96" font-weight="800" fill="#E9EDF5" letter-spacing="-2">Game Hub</text>
  <text x="74" y="462" font-family="Segoe UI, Arial, sans-serif" font-size="29" font-weight="600" fill="#22D3EE">Free browser games · live player counts</text>
  <text x="74" y="540" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#8C95A8">malikmohamedgamer-bit.github.io</text>
  ${rows}
</svg>`;
writeFileSync(join(root, 'site/og.png'), new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
console.log('wrote site/og.png');
