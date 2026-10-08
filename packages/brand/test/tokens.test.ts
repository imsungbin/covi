import { describe, expect, it } from 'vitest';
import { themes } from '../src/tokens.ts';

/** WCAG relative luminance of a `#RRGGBB` color. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('theme tokens', () => {
  it('mark caption phrases with a color the caption text reads on, in both themes', () => {
    for (const theme of Object.values(themes))
      expect(contrast(theme.captionText, theme.captionMark), theme.name).toBeGreaterThanOrEqual(
        4.5,
      );
  });
});
