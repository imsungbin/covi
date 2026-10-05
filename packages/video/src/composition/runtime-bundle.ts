import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resourcePath } from '@covi/core';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_ENTRY = join(here, '..', 'runtime', 'index.ts');
let cached: string | undefined;

/**
 * The browser runtime as a single script. Source checkouts bundle it on demand with esbuild (so
 * edits apply immediately); published packages ship a prebuilt copy in dist/runtime.
 */
export async function runtimeScript(): Promise<string> {
  if (cached) return cached;
  if (existsSync(SOURCE_ENTRY) && process.env.COVI_USE_DIST !== '1') {
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      entryPoints: [SOURCE_ENTRY],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',
      write: false,
      legalComments: 'none',
      logLevel: 'silent',
    });
    cached = result.outputFiles[0]!.text;
    return cached;
  }
  cached = await readFile(resourcePath('dist', 'runtime', 'composition.js'), 'utf8');
  return cached;
}

export { SOURCE_ENTRY as RUNTIME_SOURCE_ENTRY };
