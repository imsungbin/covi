/**
 * Builds the distributable package:
 *   dist/covi.mjs                  the CLI, with Covi's internal packages bundled in
 *   dist/runtime/composition.js    the browser runtime that draws video frames
 * Third-party packages that ship binaries or data files (Playwright, fonts) stay external.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'runtime'), { recursive: true });

await build({
  entryPoints: [join(root, 'packages/cli/src/main.ts')],
  outfile: join(dist, 'covi.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Runtime dependencies resolved from node_modules at run time (binaries, fonts, browsers).
  external: [...Object.keys(pkg.dependencies), 'esbuild'],
  banner: {
    // Some bundled CommonJS dependencies call require(); give ESM output a real one.
    js: "import { createRequire as __coviCreateRequire } from 'node:module'; const require = __coviCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});

const runtime = await build({
  entryPoints: [join(root, 'packages/video/src/runtime/index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
await writeFile(join(dist, 'runtime', 'composition.js'), runtime.outputFiles[0]!.text);
await writeFile(join(dist, 'BUILD'), `covi ${pkg.version}\n`);
console.log(`Built dist/covi.mjs and dist/runtime/composition.js (covi ${pkg.version})`);
