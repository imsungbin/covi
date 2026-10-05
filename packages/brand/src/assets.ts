import { EXPRESSIONS, foxMarkSvg, foxSvg, logoSvg } from './mascot.ts';
import { palette } from './tokens.ts';

/**
 * The files in assets/covi/, by name. `npm run assets` writes them; a test compares the committed
 * files with this, so they cannot drift from the mascot code.
 */
export function assetFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const expression of EXPRESSIONS)
    files[`fox-${expression}.svg`] = foxSvg({ expression, size: 256 });
  files['fox-mark.svg'] = foxMarkSvg({ size: 64 });
  files['fox-mark-inverse.svg'] = foxMarkSvg({
    size: 64,
    color: palette.paper,
    background: palette.cobalt,
  });
  files['logo.svg'] = logoSvg({ height: 64 });
  files['logo-dark.svg'] = logoSvg({ height: 64, theme: 'dark' });
  return Object.fromEntries(Object.entries(files).map(([name, svg]) => [name, `${svg}\n`]));
}
