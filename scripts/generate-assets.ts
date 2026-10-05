/**
 * Regenerates assets/covi/*.svg from the brand package (packages/brand). The SVG files are derived:
 * edit packages/brand/src (mascot.ts, tail.ts, mark.ts, logo.ts), then run `npm run assets`. SVG
 * files the brand no longer generates are removed. `--check` fails when the committed files are
 * stale or left over (used by tests and CI).
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetFiles } from '../packages/brand/src/assets.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'assets', 'covi');

const check = process.argv.includes('--check');
const files = assetFiles();
const stale: string[] = [];
await mkdir(dir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(dir, name);
  if (check) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== content) stale.push(name);
  } else {
    await writeFile(path, content);
  }
}
for (const name of await readdir(dir)) {
  if (!name.endsWith('.svg') || name in files) continue;
  if (check) stale.push(name);
  else await rm(join(dir, name));
}
if (check && stale.length) {
  console.error(`Stale assets (run npm run assets): ${stale.join(', ')}`);
  process.exit(1);
}
console.log(
  check ? 'Assets are up to date.' : `Wrote ${Object.keys(files).length} files to assets/covi/`,
);
