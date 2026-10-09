import { describe, expect, it } from 'vitest';
import { leadKind } from '../src/density.ts';
import { MORPH_SETTLE, shotSettledAt } from '../src/timeline/cues.ts';
import type { TimelineScene } from '../src/timeline/types.ts';

describe('a morph on the timeline', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const directed = {
    id: 's',
    beat: 's',
    eyebrow: 's',
    start: 0,
    end: 8,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    direction: {
      whole: false,
      elements: [
        {
          id: 'm',
          kind: 'morph',
          rect,
          morph: { path: 'a.js', base: [], head: [], rows: [], tokens: [] },
        },
      ],
      beats: [{ verb: 'morph', element: 'm', t: 2, seconds: 1.6 }],
    },
  } as TimelineScene;

  it('settles once the added tokens have taken their colors', () => {
    expect(shotSettledAt(directed)).toBeCloseTo(2 + 1.6 + MORPH_SETTLE, 9);
  });

  it('reads as code for the monotony check', () => {
    expect(leadKind(directed)).toBe('code');
  });
});
