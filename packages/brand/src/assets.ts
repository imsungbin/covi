import { logoSvg } from './logo.ts';
import { foxMarkSvg } from './mark.ts';
import { EXPRESSIONS, FOX_FRAME, foxSvg } from './mascot.ts';
import { palette } from './tokens.ts';

/**
 * The files in assets/covi/, by name. `npm run assets` writes them; a test compares the committed
 * files with this, so they cannot drift from the mascot code.
 */
export function assetFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  // One frame for every expression, so they line up side by side and no tail is clipped.
  for (const expression of EXPRESSIONS)
    files[`fox-${expression}.svg`] = foxSvg({ expression, size: 256, frame: FOX_FRAME });
  // The mark's detail steps down with size, so each size range has its own file.
  files['fox-mark.svg'] = foxMarkSvg({ size: 64 });
  files['fox-mark-32.svg'] = foxMarkSvg({ size: 32 });
  files['fox-mark-16.svg'] = foxMarkSvg({ size: 16 });
  files['fox-tile-sky.svg'] = foxMarkSvg({ size: 128, background: palette.sky });
  files['fox-tile-charcoal.svg'] = foxMarkSvg({
    size: 128,
    background: palette.charcoal,
    theme: 'dark',
  });
  files['logo.svg'] = logoSvg({ height: 64 });
  files['logo-dark.svg'] = logoSvg({ height: 64, theme: 'dark' });
  files['logo-stacked.svg'] = logoSvg({ height: 220, layout: 'stacked' });
  files['logo-stacked-dark.svg'] = logoSvg({ height: 220, layout: 'stacked', theme: 'dark' });
  return Object.fromEntries(Object.entries(files).map(([name, svg]) => [name, `${svg}\n`]));
}
