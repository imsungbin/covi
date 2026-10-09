import { describe, expect, it } from 'vitest';
import { layoutSampleFrames } from '../src/render/renderer.ts';
import {
  CARD_FILL,
  CODE_FALLBACK,
  cardHeight,
  codeCeiling,
  codeFont,
  TEXT_FLOOR,
} from '../src/runtime/sizing.ts';
import { settledAt, settledFrame, settledSpan } from '../src/timeline/cues.ts';
import type {
  SceneTransition,
  Timeline,
  TimelineScene,
  TimelineVisual,
} from '../src/timeline/types.ts';

const code: TimelineVisual = {
  kind: 'code',
  path: 'a.js',
  lines: [{ type: 'add', text: 'x' }],
  highlight: [],
};
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const terminal: TimelineVisual = {
  kind: 'terminal',
  command: 'node scripts/measure.js',
  before: 'chunks: 4',
  output: 'chunks: 1',
};

function scene(
  id: string,
  start: number,
  end: number,
  visual: TimelineVisual,
  transition?: SceneTransition,
): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual,
    expression: 'explaining',
    narrator: true,
    ...(transition ? { transition } : {}),
  };
}

/** A timeline of these scenes at 30 fps, `width` × `height`. */
function video(width: number, height: number, scenes: TimelineScene[]): Timeline {
  return {
    width,
    height,
    fps: 30,
    frames: Math.ceil(scenes.at(-1)!.end * 30),
    transition: 0.45,
    orientation: width > height ? 'landscape' : width < height ? 'vertical' : 'square',
    scenes,
  } as Timeline;
}

describe('type and card sizes', () => {
  it('grow code to the ceiling when it fits, and below the floor only when it must', () => {
    expect(TEXT_FLOOR).toEqual({ code: 24, body: 28 });
    expect(codeCeiling('landscape')).toBe(44);
    expect(codeCeiling('square')).toBe(44);
    expect(codeCeiling('vertical')).toBe(48);
    expect(codeFont(100, 'landscape', 1)).toBe(44);
    expect(codeFont(100, 'vertical', 2)).toBe(96);
    expect(codeFont(30, 'landscape', 1)).toBe(30);
    expect(codeFont(10, 'landscape', 1)).toBe(CODE_FALLBACK);
  });

  it('grow a short card until it fills 60% of the region, never past the region', () => {
    const region = { x: 0, y: 0, width: 1000, height: 500 };
    expect(CARD_FILL).toBe(0.6);
    expect(cardHeight(region, 1000, 100)).toBeCloseTo(300, 9);
    expect(cardHeight(region, 1000, 420)).toBe(420);
    // Half as wide, it would need 600 to cover 60%: the region has 500.
    expect(cardHeight(region, 500, 100)).toBe(500);
    expect(cardHeight(region, 1000, 900)).toBe(500);
  });
});

describe('settled frames', () => {
  const t = video(1920, 1080, [
    scene('s1', 0, 4, code),
    scene('s2', 3.5, 8, callout, { kind: 'push', seconds: 0.5 }),
    scene('s3', 8, 10, callout, { kind: 'cut', seconds: 0 }),
    scene('covi:outro', 9.55, 12, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
  ]);

  it('start once the entrance and the choreography are done, and end where the next scene enters', () => {
    expect(settledSpan(t, 0)).toEqual([settledAt(code, 4), 3.5]);
    const [from, to] = settledSpan(t, 1)!;
    expect(from).toBeCloseTo(3.5 + 0.6, 9);
    expect(to).toBe(8);
    expect(settledSpan(t, 2)).toEqual([8.6, 9.55]);
    expect(settledSpan(t, 9)).toBeUndefined();
    expect(settledFrame(t, 1)).toBe(123);
    expect(settledFrame(t, 2)).toBe(258);
  });

  it('fall back to the moment a scene starts to leave when it is too short to settle', () => {
    const short = video(1920, 1080, [
      scene('s1', 0, 4, callout),
      scene('s2', 3.5, 6, terminal, { kind: 'push', seconds: 0.5 }),
      scene('s3', 5.55, 9, callout, { kind: 'fade', seconds: 0.45 }),
    ]);
    // The after run prints 2.25 s in; s2 has 2.05 s before s3 fades in.
    expect(settledAt(terminal, 2.5)).toBeCloseTo(2.25, 9);
    const [from, to] = settledSpan(short, 1)!;
    expect(from).toBeCloseTo(5.55, 9);
    expect(to).toBeCloseTo(5.55, 9);
    // The last frame before s3 enters, still inside s2.
    expect(settledFrame(short, 1)).toBe(166);
  });

  it('are sampled for every story scene, beside 35% and 70% of every scene', () => {
    const frames = layoutSampleFrames(t);
    for (const i of [0, 1, 2]) expect(frames).toContain(settledFrame(t, i));
    // The outro is Covi's own card: sampled at 35% and 70% only.
    expect(frames).not.toContain(settledFrame(t, 3));
    expect(frames).toContain(Math.round((3.5 + 4.5 * 0.35) * 30));
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });
});
