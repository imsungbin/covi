import { describe, expect, it } from 'vitest';
import { HIDE_LABEL_SCRIPT, sheetLabel, showLabelScript, tileLayout } from '../src/render/sheet.ts';
import type { Timeline } from '../src/timeline/types.ts';

const timeline = {
  fps: 30,
  scenes: [
    { id: 's1', start: 0, end: 2, evidenceIds: ['screenshot:cart-desktop-after'] },
    {
      id: 's2',
      start: 1.8,
      end: 4,
      evidenceIds: ['diff-hunk:src/cart.ts:10', 'http:1', 'trace:x-head'],
    },
    { id: 's3', start: 4, end: 5 },
  ],
} as unknown as Pick<Timeline, 'fps' | 'scenes'>;

describe('contact sheet labels', () => {
  it('names the scene a frame shows and the evidence it cites', () => {
    expect(sheetLabel(timeline, 15)).toBe('s1 · screenshot:cart-desktop-after');
    // During a transition the incoming scene is named.
    expect(sheetLabel(timeline, 57)).toBe('s2 · +1 · diff-hunk:src/cart.ts:10 · http:1');
    expect(sheetLabel(timeline, 135)).toBe('s3 · —');
  });

  it('keeps a label to one short line', () => {
    const long = {
      fps: 30,
      scenes: [{ id: 's1', start: 0, end: 1, evidenceIds: [`diff-hunk:${'a/'.repeat(80)}x.ts:1`] }],
    } as unknown as Pick<Timeline, 'fps' | 'scenes'>;
    expect(sheetLabel(long, 0).length).toBeLessThanOrEqual(96);
  });

  it('puts the label into the page as text, never as markup', () => {
    const script = showLabelScript('s1 · "</div><img src=x onerror=alert(1)>', 1080);
    expect(script).toContain('el.textContent = "s1 · \\"</div><img src=x onerror=alert(1)>"');
    expect(script).not.toContain('innerHTML');
    expect(HIDE_LABEL_SCRIPT).toContain('remove()');
  });

  it('draws the label in a band below the frame, never over it', () => {
    for (const [width, height] of [
      [1080, 1920],
      [1920, 1080],
      [360, 640],
    ] as const) {
      const { frame, label } = tileLayout(width, height);
      expect(frame).toEqual({ x: 0, y: 0, width, height });
      expect(label).toMatchObject({ x: 0, y: height, width });
      expect(label.height).toBeGreaterThan(0);
      // Even, so the stacked tile stays a valid 4:2:0 picture.
      expect(label.height % 2).toBe(0);
      // A caption band at the very bottom of the frame stays clear of the label.
      const captions = { x: 0, y: height - 0.2 * height, width, height: 0.2 * height };
      expect(captions.y + captions.height).toBeLessThanOrEqual(label.y);
    }
  });
});
