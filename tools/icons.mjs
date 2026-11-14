// node tools/icons.mjs [--copy]
// One icon family for the hub and every game: same frame, corner radius and lighting; each icon has
// its own colour and one bold emblem. Writes SVG masters + rasters to tools/out/icons/<slug>/ and,
// with --copy, into the hub site and each game repo (sibling folders of this repo).
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'tools', 'out', 'icons');

// Emblems are drawn in a 512 x 512 space, centred on (256, 256), about 300 px across.
// `em` = emblem gradient, `ac` = accent gradient, `ink` = the dark background ink for cut-outs.
const ICONS = {
  hub: {
    fit: [256, 290, 0.78],
    color: '#22D3EE', light: '#C8F7FF', bg: ['#0B2A33', '#04090D'], accent: ['#FFFFFF', '#9FEFFF'],
    emblem: `
      <path fill="url(#em)" d="M168 168h176c58 0 92 34 104 92l16 74c10 46-14 78-50 78-24 0-40-14-54-36l-22-34H174l-22 34c-14 22-30 36-54 36-36 0-60-32-50-78l16-74c12-58 46-92 104-92z"/>
      <rect x="150" y="226" width="30" height="94" rx="8" fill="url(#ink)"/>
      <rect x="118" y="258" width="94" height="30" rx="8" fill="url(#ink)"/>
      <circle cx="344" cy="246" r="21" fill="url(#ac)"/>
      <circle cx="388" cy="290" r="21" fill="url(#ac)"/>
      <circle cx="300" cy="290" r="21" fill="url(#ac)"/>
      <circle cx="344" cy="334" r="21" fill="url(#ac)"/>`,
  },
  riftkeep: {
    fit: [256, 244, 0.95],
    color: '#A07BFF', light: '#EDE6FF', bg: ['#22134A', '#0A0716'], accent: ['#FFE9A8', '#FFB020'],
    emblem: `
      <path fill="url(#ac)" d="M256 62l50 62-50 62-50-62z"/>
      <path fill="url(#em)" fill-rule="evenodd" d="M156 206h44v26h36v-26h40v26h36v-26h44v70h-18v150H174V276h-18z M226 426v-58a30 30 0 0 1 60 0v58z M246 296h20v40h-20z"/>`,
  },
  rollforge: {
    fit: [272, 230, 0.86],
    color: '#FF8A1F', light: '#FFE7C7', bg: ['#3A1C05', '#0E0702'], accent: ['#FFFFFF', '#FFE27A'],
    emblem: `
      <g transform="rotate(-14 248 268)">
        <rect x="128" y="148" width="240" height="240" rx="52" fill="url(#em)"/>
        <circle cx="186" cy="206" r="26" fill="url(#ink)"/>
        <circle cx="310" cy="206" r="26" fill="url(#ink)"/>
        <circle cx="248" cy="268" r="26" fill="url(#ink)"/>
        <circle cx="186" cy="330" r="26" fill="url(#ink)"/>
        <circle cx="310" cy="330" r="26" fill="url(#ink)"/>
      </g>
      <path fill="url(#ac)" d="M388 64l14 40 40 14-40 14-14 40-14-40-40-14 40-14z"/>`,
  },
  'bolt-skate': {
    fit: [256, 263, 0.8],
    color: '#FFC21A', glow: '#1E90FF', light: '#FFF6C2', bg: ['#0E2236', '#050A12'], accent: ['#BDF3FF', '#26B8E8'],
    emblem: `
      <path fill="url(#em)" d="M300 52L156 262h92l-30 124 152-214h-96z"/>
      <path fill="url(#ac)" d="M92 380c6 20 22 30 44 30h240c22 0 38-10 44-30l18 6c-8 32-32 50-62 50H136c-30 0-54-18-62-50z"/>
      <circle cx="168" cy="452" r="22" fill="url(#ac)"/>
      <circle cx="344" cy="452" r="22" fill="url(#ac)"/>`,
  },
  snapfire: {
    fit: [256, 256, 0.88],
    color: '#FF5A36', light: '#FFD9CC', bg: ['#3A0E08', '#0F0503'], accent: ['#FFFFFF', '#FFC2AE'],
    emblem: `
      <circle cx="256" cy="256" r="118" fill="none" stroke="url(#em)" stroke-width="38"/>
      <rect x="238" y="64" width="36" height="120" rx="12" fill="url(#em)"/>
      <rect x="238" y="328" width="36" height="120" rx="12" fill="url(#em)"/>
      <rect x="64" y="238" width="120" height="36" rx="12" fill="url(#em)"/>
      <rect x="328" y="238" width="120" height="36" rx="12" fill="url(#em)"/>
      <circle cx="256" cy="256" r="26" fill="url(#ac)"/>`,
  },
};

function svg(icon, { fullBleed = false, scale = 1 } = {}) {
  const r = fullBleed ? 0 : 108;
  const inset = fullBleed ? 0 : 16;
  const size = 512 - inset * 2;
  const frame = `x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${r}"`;
  const s = scale;
  const t = s === 1 ? '' : ` transform="translate(${256 - 256 * s} ${256 - 256 * s}) scale(${s})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${icon.bg[0]}"/><stop offset="1" stop-color="${icon.bg[1]}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.4" r="0.62"><stop offset="0" stop-color="${icon.glow || icon.color}" stop-opacity="0.5"/><stop offset="1" stop-color="${icon.glow || icon.color}" stop-opacity="0"/></radialGradient>
    <linearGradient id="em" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${icon.light}"/><stop offset="1" stop-color="${icon.color}"/></linearGradient>
    <linearGradient id="ac" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${icon.accent[0]}"/><stop offset="1" stop-color="${icon.accent[1]}"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${icon.bg[0]}"/><stop offset="1" stop-color="${icon.bg[1]}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.55"/></filter>
  </defs>
  <rect ${frame} fill="url(#bg)"/>
  <rect ${frame} fill="url(#glow)"/>
  <g filter="url(#shadow)"${t}><g transform="translate(256 256) scale(${icon.fit[2]}) translate(${-icon.fit[0]} ${-icon.fit[1]})">${icon.emblem}
  </g></g>
  <rect ${frame} fill="url(#sheen)"/>${fullBleed ? '' : `
  <rect x="${inset + 4}" y="${inset + 4}" width="${size - 8}" height="${size - 8}" rx="${r - 4}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="8"/>`}
</svg>
`;
}

const png = (svgText, w) => new Resvg(svgText, { fitTo: { mode: 'width', value: w } }).render().asPng();

function ico(pngs) { // PNG-compressed ICO entries (supported by every current browser)
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, buf], i) => {
    const o = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, o); head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(buf.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p[1])]);
}

const FILES = ['favicon.svg', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-maskable.svg'];

for (const [slug, icon] of Object.entries(ICONS)) {
  const dir = join(outRoot, slug);
  mkdirSync(dir, { recursive: true });
  const rounded = svg(icon);
  const bleed = svg(icon, { fullBleed: true, scale: 0.86 }); // apple-touch: the OS rounds the corners
  const mask = svg(icon, { fullBleed: true, scale: 0.72 });  // emblem inside the central 80% safe zone
  writeFileSync(join(dir, 'favicon.svg'), rounded);
  writeFileSync(join(dir, 'icon-maskable.svg'), mask);
  writeFileSync(join(dir, 'favicon-32.png'), png(rounded, 32));
  writeFileSync(join(dir, 'favicon.ico'), ico([16, 32, 48].map((s) => [s, png(rounded, s)])));
  writeFileSync(join(dir, 'apple-touch-icon.png'), png(bleed, 180));
  writeFileSync(join(dir, 'icon-192.png'), png(rounded, 192));
  writeFileSync(join(dir, 'icon-512.png'), png(rounded, 512));
  writeFileSync(join(dir, 'icon-maskable-512.png'), png(mask, 512));
  for (const s of [16, 24, 48, 64]) writeFileSync(join(dir, `preview-${s}.png`), png(rounded, s));
}

// Contact sheet: every icon at 16, 24, 32, 48, 64 and 192 px, plus the maskable crop, for eyeballing.
{
  const slugs = Object.keys(ICONS);
  const sizes = [16, 24, 32, 48, 64, 128];
  const rowH = 150;
  let body = '';
  slugs.forEach((slug, i) => {
    let x = 16;
    const y = 16 + i * rowH;
    for (const s of sizes) {
      body += `<svg x="${x}" y="${y + (128 - s) / 2}" width="${s}" height="${s}" viewBox="0 0 512 512">${svg(ICONS[slug]).replace(/<\/?svg[^>]*>/g, '').replaceAll('id="', `id="${slug}${s}`).replaceAll('url(#', `url(#${slug}${s}`)}</svg>`;
      x += s + 24;
    }
    const m = svg(ICONS[slug], { fullBleed: true, scale: 0.72 }).replace(/<\/?svg[^>]*>/g, '').replaceAll('id="', `id="${slug}m`).replaceAll('url(#', `url(#${slug}m`);
    body += `<svg x="${x}" y="${y}" width="128" height="128" viewBox="0 0 512 512"><clipPath id="${slug}c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#${slug}c)">${m}</g></svg>`;
  });
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${16 + slugs.length * rowH}"><rect width="100%" height="100%" fill="#1b1d22"/>${body}</svg>`;
  writeFileSync(join(outRoot, 'sheet.png'), new Resvg(sheet).render().asPng());
}

if (process.argv.includes('--copy')) {
  const gh = join(root, '..');
  const targets = {
    hub: join(root, 'site', 'icons'),
    riftkeep: join(gh, 'TDS', 'assets', 'icons'),
    rollforge: join(gh, 'Tcyoon-RNG', 'assets', 'icons'),
    'bolt-skate': join(gh, 'Skate-game', 'assets', 'icons'),
    snapfire: join(gh, 'fps-playtest', 'assets', 'icons'),
  };
  for (const [slug, dest] of Object.entries(targets)) {
    mkdirSync(dest, { recursive: true });
    for (const f of FILES) copyFileSync(join(outRoot, slug, f), join(dest, f));
    // Riftkeep's own manifest also lists icon.svg; keep that name pointing at the new master.
    if (slug === 'riftkeep' && existsSync(join(dest, 'icon.svg'))) copyFileSync(join(outRoot, slug, 'favicon.svg'), join(dest, 'icon.svg'));
    console.log(`copied ${slug} -> ${dest}`);
  }
}
console.log(`icons written to ${outRoot}`);
