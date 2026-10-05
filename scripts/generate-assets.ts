/**
 * Regenerates assets/covi/*.svg from the mascot module (packages/brand). The SVG files are derived
 * artifacts: edit packages/brand/src/mascot.ts, then run `npm run assets`. `--check` fails when the
 * committed files are stale (used by tests and CI).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetFiles } from '../packages/brand/src/assets.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'assets', 'covi');

const check = process.argv.includes('--check');
const stale: string[] = [];
await mkdir(dir, { recursive: true });
for (const [name, content] of Object.entries(assetFiles())) {
  const path = join(dir, name);
  if (check) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== content) stale.push(name);
  } else {
    await writeFile(path, content);
  }
}
if (check && stale.length) {
  console.error(`Stale assets (run npm run assets): ${stale.join(', ')}`);
  process.exit(1);
}
console.log(
  check
    ? 'Assets are up to date.'
    : `Wrote ${Object.keys(assetFiles()).length} files to assets/covi/`,
);
