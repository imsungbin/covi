#!/usr/bin/env node
// Covi command-line entry point.
// In a source checkout the TypeScript sources run directly (Node 22.18+ strips types natively), so
// edits take effect without a build. Published packages ship only the prebuilt bundle in dist/.
import { existsSync } from 'node:fs';

const source = new URL('../packages/cli/src/main.ts', import.meta.url);
const bundle = new URL('../dist/covi.mjs', import.meta.url);
const canRunSource =
  Boolean(process.features?.typescript) && existsSync(source) && process.env.COVI_USE_DIST !== '1';

if (!canRunSource && !existsSync(bundle)) {
  console.error('Covi needs Node.js 22.18+ to run from source, or a build (npm run build).');
  process.exit(4);
}
const { main } = await import(canRunSource ? source.href : bundle.href);
process.exitCode = await main(process.argv.slice(2));
