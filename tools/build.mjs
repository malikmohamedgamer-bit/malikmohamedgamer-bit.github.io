// node tools/build.mjs [outDir=_site]: copies site/ to the deploy folder and stamps the service worker's
// VERSION (git commit + content hash), so every deploy that changes anything gets a fresh hub cache.
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || '_site');
rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'site'), out, { recursive: true });
const files = readdirSync(out, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
  .map((d) => join(d.parentPath, d.name)).sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f.slice(out.length)).update(readFileSync(f));
let sha = process.env.GITHUB_SHA || '';
if (!sha) try { sha = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = 'local'; }
const version = `${sha.slice(0, 7)}-${hash.digest('hex').slice(0, 8)}`;
const swPath = join(out, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!sw.includes("const VERSION = 'dev';")) throw new Error('sw.js: VERSION marker missing');
writeFileSync(swPath, sw.replace("const VERSION = 'dev';", `const VERSION = '${version}';`));
console.log(`built ${out} (${files.length} files), service worker version ${version}`);
