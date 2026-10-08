import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { entered } from '../src/runtime/components/types.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes } from '../src/timeline/build.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
const build = (scenes: Scene[]) =>
  buildTimeline({
    title: 'T',
    scenes,
    layout: layoutScenes(scenes, new Map()),
    spec,
    image: () => ({ src: 'a.png', width: 1280, height: 800 }),
  });
const title = (extra: Record<string, unknown> = {}) => ({
  kind: 'title',
  title: 'Clamp quantities at zero',
  eyebrow: 'The bug',
  meta: [],
  ...extra,
});
const wrap = {
  id: 's2',
  beat: 'summary',
  narration: 'Done.',
  visual: { kind: 'callout', tone: 'info', title: 'C' },
};

describe('the opening scene', () => {
  it('is in place from frame 0, while later scenes enter', () => {
    expect(entered({ t: 0, open: true }, 0, 0.55)).toBe(1);
    expect(entered({ t: 0, open: false }, 0, 0.55)).toBe(0);
    expect(entered({ t: 0.275, open: false }, 0, 0.55)).toBeCloseTo(0.5, 9);
  });
});

describe('a title over a capture', () => {
  it('shows the capture, puts the title in the header, and keeps the narrator', () => {
    const over = build([
      {
        id: 's1',
        beat: 'context',
        narration: 'Remove one too many.',
        visual: title({ background: { path: 'demo/a.png' } }),
      },
      wrap,
    ] as Scene[]).scenes[0]!;
    expect(over).toMatchObject({
      eyebrow: 'The bug',
      heading: 'Clamp quantities at zero',
      narrator: true,
    });
  });

  it("lets the scene's own eyebrow and heading win", () => {
    const over = build([
      {
        id: 's1',
        beat: 'context',
        eyebrow: 'Cart',
        heading: 'Minus one',
        narration: 'Remove one too many.',
        visual: title({ background: { path: 'demo/a.png' } }),
      },
      wrap,
    ] as Scene[]).scenes[0]!;
    expect(over).toMatchObject({ eyebrow: 'Cart', heading: 'Minus one' });
  });

  it('leaves a title card as it was: the large fox, no header', () => {
    const card = build([
      { id: 's1', beat: 'context', narration: 'Hello.', visual: title() },
      wrap,
    ] as Scene[]).scenes[0]!;
    expect(card).toMatchObject({ eyebrow: 'context', narrator: false });
    expect(card.heading).toBeUndefined();
  });
});
