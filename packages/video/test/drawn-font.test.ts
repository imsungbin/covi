import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { drawnFont, smallestFont } from '../src/runtime/components/types.ts';

const browserAvailable = await canUseBrowser();

// Laid out as the composition lays out every box: border-box, under the camera's scale.
const PAGE = `<!doctype html><html><head><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
.push { transform: scale(1.5); transform-origin: 0 0; font-size: 28px; }
</style></head><body><div class="push">
<div id="narrow" style="width: 100.5px; padding: 0 7.25px">x</div>
<div id="hidden" style="display: none; width: 100.5px">x</div>
<span id="inline">xxxxxxxxxx</span>
</div></body></html>`;

describe('the drawn font', () => {
  it.skipIf(!browserAvailable)(
    'is the font as drawn, unrounded on a narrow box, and as set on a box not drawn',
    async () => {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent(PAGE);
        const read = (id: string) => page.$eval(`#${id}`, drawnFont);
        // offsetWidth rounds 100.5 px to a whole pixel, which would read 0.2 px off.
        expect(await read('narrow')).toBeCloseTo(42, 6);
        expect(await read('hidden')).toBe(28);
        // An inline box has no computed width; its rounded one still carries the camera's scale.
        expect(await read('inline')).toBeCloseTo(42, 0);
      } finally {
        await browser.close();
      }
    },
  );

  it('is absent for an item with no text', () => {
    // Infinity would reach frames.json as null, and read back as text at 0 px.
    expect(smallestFont([])).toBeUndefined();
  });
});
