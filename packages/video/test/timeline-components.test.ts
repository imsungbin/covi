import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, type StoryboardInput, StoryboardSchema } from '../src/storyboard/schema.ts';
import {
  buildTimeline,
  layoutScenes,
  minSecondsFor,
  pacingFor,
  sceneCues,
} from '../src/timeline/build.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
const image = { path: 'demo/a.png' };
const box = (x: number) => ({ x, y: 0, width: 10, height: 10 });
const wrap = {
  id: 'wrap',
  beat: 'summary',
  narration: 'Done.',
  visual: { kind: 'callout', tone: 'info', title: 'C' },
} as const;

const FIX = {
  id: 'fix',
  beat: 'fix',
  narration: 'Minus one becomes a clamp at zero, so the cart stops.',
  sync: { morph: 'becomes a clamp', stop: 'the cart stops' },
  cues: [{ at: 'stop', kind: 'click' }],
  visual: {
    kind: 'code',
    path: 'src/cart.js',
    mode: 'morph',
    lines: [
      { type: 'del', text: 'qty = qty - 1;' },
      { type: 'add', text: 'qty = Math.max(0, qty - 1);' },
      { type: 'context', text: 'render(cart);' },
    ],
    highlight: [{ lines: [1, 2], sync: 'stop' }],
    caption: 'Clamped at zero',
  },
} as const;

const PAGE = {
  id: 'page',
  beat: 'proof',
  hero: true,
  narration: 'The total updates, the badge clears, and checkout opens.',
  sync: { mark2: 'the badge clears', open: 'checkout opens' },
  cues: [
    { at: 'hero', kind: 'riser' },
    { at: 1.2, kind: 'reveal' },
  ],
  visual: {
    kind: 'screenshot',
    image,
    marks: [
      { focus: box(0), label: 'Total' },
      { focus: box(20), label: 'Badge' },
      { focus: box(40), sync: 'open' },
    ],
    click: { x: 45, y: 5 },
  },
} as const;

const FLOW = {
  id: 'flow',
  beat: 'interaction',
  narration: 'Add an item, then open the cart.',
  sync: { step2: 'then open the cart' },
  visual: {
    kind: 'interaction',
    steps: [
      { image, marks: [{ focus: box(0) }] },
      { image, marks: [{ focus: box(10) }, { focus: box(20) }] },
      { image },
    ],
  },
} as const;

const scenes = (list: unknown[]) =>
  StoryboardSchema.parse({
    title: 'T',
    template: 'bug-fix',
    scenes: list as StoryboardInput['scenes'],
  }).scenes;

function build(list: Scene[]) {
  const layout = layoutScenes(list, new Map(), new Map(), 'en', pacingFor(spec));
  return buildTimeline({
    title: 'T',
    scenes: list,
    layout,
    spec,
    image: () => ({ src: 'a.png', width: 100, height: 100 }),
  });
}

describe('code in the timeline', () => {
  it('carries a morph, its groups, and its caption, and the scene its cues', () => {
    const [fix] = build(scenes([FIX, wrap])).scenes;
    expect(fix!.visual).toMatchObject({
      kind: 'code',
      mode: 'morph',
      highlight: [1, 2],
      groups: [{ lines: [1, 2], phase: 'stop' }],
      caption: 'Clamped at zero',
    });
    expect(fix!.phases!.stop).toBeGreaterThan(fix!.phases!.morph!);
    expect(fix!.cues).toEqual([{ at: fix!.phases!.stop, kind: 'click' }]);
  });

  it('keeps plain code as PR 2 drew it', () => {
    const plain = {
      id: 'fix',
      beat: 'fix',
      narration: 'Minus one becomes zero.',
      visual: { kind: 'code', path: 'src/cart.js', lines: FIX.visual.lines, highlight: [1, 1] },
    };
    const [scene] = build(scenes([plain, wrap])).scenes;
    expect(scene!.visual).toMatchObject({ kind: 'code', highlight: [1, 1] });
    expect(scene!.visual).not.toHaveProperty('groups');
    expect(scene!.visual).not.toHaveProperty('mode');
    expect(scene).not.toHaveProperty('cues');
  });

  it('skips what a phrase redaction removed, without failing', () => {
    const [fix, after] = scenes([FIX, wrap]);
    const redacted = { ...fix!, narration: 'Minus one becomes a clamp at zero, so [REDACTED].' };
    const [scene] = build([redacted, after!]).scenes;
    expect(scene!.phases).not.toHaveProperty('stop');
    expect(scene).not.toHaveProperty('cues');
    // The group keeps its phase name; with no time for it, the runtime lights it unpinned.
    expect(scene!.visual).toMatchObject({ groups: [{ lines: [1, 2], phase: 'stop' }] });
  });
});

describe('marks in the timeline', () => {
  it('carry each mark with its phase, and the hero its own cues', () => {
    const [page] = build(scenes([PAGE, wrap])).scenes;
    expect(page!.visual).toMatchObject({
      kind: 'screenshot',
      marks: [
        { focus: box(0), label: 'Total', phase: 'mark1' },
        { focus: box(20), label: 'Badge', phase: 'mark2' },
        { focus: box(40), phase: 'open' },
      ],
    });
    expect(page!.cues).toEqual([
      { at: page!.phases!.hero, kind: 'riser' },
      { at: 1.2, kind: 'reveal' },
    ]);
  });

  it('give each interaction step its own marks, numbered through the visual', () => {
    const [flow] = build(scenes([FLOW, wrap])).scenes;
    const steps = (flow!.visual as { steps: Array<Record<string, unknown>> }).steps;
    expect(steps[0]!.marks).toEqual([{ focus: box(0), phase: 'mark1' }]);
    expect(steps[1]!.marks).toEqual([
      { focus: box(10), phase: 'mark2' },
      { focus: box(20), phase: 'mark3' },
    ]);
    expect(steps[2]).not.toHaveProperty('marks');
  });

  it('keep a screenshot with focus as it was', () => {
    const shot = { kind: 'screenshot', image, focus: box(0), click: { x: 1, y: 1 } };
    const [scene] = build(
      scenes([{ id: 's', beat: 'b', narration: 'Look.', visual: shot }, wrap]),
    ).scenes;
    expect(scene!.visual).not.toHaveProperty('marks');
    expect(scene!.visual).toMatchObject({ focus: box(0) });
  });
});

describe('scene cues', () => {
  it('place a cue at a phase, or at its seconds', () => {
    expect(
      sceneCues(
        {
          cues: [
            { at: 'stop', kind: 'click' },
            { at: 0.4, kind: 'reveal' },
          ],
        },
        { stop: 1.25 },
        3,
      ),
    ).toEqual([
      { at: 1.25, kind: 'click' },
      { at: 0.4, kind: 'reveal' },
    ]);
  });

  it('skip a cue whose phrase is gone, even one named constructor', () => {
    expect(
      sceneCues(
        {
          cues: [
            { at: 'gone', kind: 'click' },
            { at: 0.4, kind: 'reveal' },
          ],
        },
        {},
        3,
      ),
    ).toEqual([{ at: 0.4, kind: 'reveal' }]);
    expect(sceneCues({ cues: [{ at: 'constructor', kind: 'click' }] }, {}, 3)).toBeUndefined();
    expect(sceneCues({ cues: [{ at: 'toString', kind: 'click' }] }, undefined, 3)).toBeUndefined();
    expect(sceneCues({}, { stop: 1 }, 3)).toBeUndefined();
  });

  it('skip a cue past the end of its scene', () => {
    const cues = [
      { at: 3, kind: 'click' },
      { at: 3.01, kind: 'reveal' },
    ] as const;
    expect(sceneCues({ cues: [...cues] }, {}, 3)).toEqual([{ at: 3, kind: 'click' }]);
    const late = { ...FIX, cues: [{ at: 29, kind: 'reveal' }] };
    const [fix] = build(scenes([late, wrap])).scenes;
    expect(fix!.end - fix!.start).toBeLessThan(29);
    expect(fix).not.toHaveProperty('cues');
  });

  it('keep a cue at the very end of its scene, whatever the float error', () => {
    const words = 'the cart stops at zero and'.split(' ');
    const lines = ['Done.', ...[3, 4, 5, 6].map((n) => `${words.slice(0, n).join(' ')}.`)];
    const list = lines.map((narration, i) => ({
      ...wrap,
      id: `s${i}`,
      narration,
      ...(i === 3 ? { cues: [{ at: 3.05, kind: 'reveal' }] } : {}),
    }));
    const last = build(scenes(list)).scenes[3]!;
    // The scene is 3.05 s long, which subtraction makes 3.049999999999999.
    expect(last.end - last.start).toBeLessThan(3.05);
    expect(last.end - last.start).toBeCloseTo(3.05, 9);
    expect(last.cues).toEqual([{ at: 3.05, kind: 'reveal' }]);
  });
});

describe('minimum time on screen', () => {
  it('gives a morph, a tour of marks, and marked steps a little more', () => {
    const [fix, page, flow] = scenes([FIX, PAGE, FLOW]);
    expect(minSecondsFor(fix!.visual)).toBe(2.5);
    expect(minSecondsFor({ ...fix!.visual, mode: 'diff' })).toBe(2);
    expect(minSecondsFor(page!.visual)).toBeCloseTo(3.6, 9);
    expect(
      minSecondsFor({ kind: 'screenshot', image, device: 'desktop', marks: [{ focus: box(0) }] }),
    ).toBe(3);
    expect(minSecondsFor(flow!.visual)).toBeCloseTo(1.2 * 3 + 0.4 * 3, 9);
  });
});
