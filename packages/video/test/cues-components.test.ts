import { describe, expect, it } from 'vitest';
import {
  buildCues,
  codeHighlights,
  edgeEntrance,
  edgeLabelEntrance,
  HIGHLIGHT_SWEEP,
  highlightStarts,
  interactionTiming,
  markTiming,
  morphTiming,
  phaseAt,
  screenshotMarks,
  settledAt,
  typeSeconds,
} from '../src/timeline/cues.ts';
import type { CodeLine, TimelineScene, TimelineVisual } from '../src/timeline/types.ts';

const image = { src: 'a.png', width: 100, height: 100 };
const box = (x: number) => ({ x, y: 0, width: 10, height: 10 });

/** Spans compared within floating-point error. */
const close = (span: readonly number[] | undefined, expected: readonly number[]) => {
  expect(span).toBeDefined();
  expect(span!.length).toBe(expected.length);
  for (const [i, e] of expected.entries()) expect(span![i]).toBeCloseTo(e, 9);
};

const LINES: CodeLine[] = [
  { type: 'del', text: 'qty = qty - 1;' },
  { type: 'add', text: 'qty = Math.max(0, qty - 1);' },
  { type: 'add', text: 'render(cart);' },
];
type Code = Extract<TimelineVisual, { kind: 'code' }>;
const morph: Code = { kind: 'code', path: 'a.js', lines: LINES, highlight: [1], mode: 'morph' };
const marks2 = [{ phase: 'mark1' }, { phase: 'mark2' }];

function scene(id: string, start: number, end: number, visual: TimelineVisual): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual,
    expression: 'explaining',
    narrator: true,
  };
}

describe('phases by name', () => {
  it('are own properties only', () => {
    expect(phaseAt({ zoom: 1 }, 'zoom')).toBe(1);
    expect(phaseAt({}, 'zoom')).toBeUndefined();
    expect(phaseAt({}, 'constructor')).toBeUndefined();
    expect(phaseAt({}, 'toString')).toBeUndefined();
  });
});

describe('a code morph', () => {
  it('types a line in 0.2–0.6 s by its characters', () => {
    expect(typeSeconds('qty = Math.max(0, qty - 1);')).toBeCloseTo(0.45, 9);
    expect(typeSeconds('render(cart);')).toBeCloseTo(13 / 60, 9);
    // Thirty emoji are thirty characters (sixty UTF-16 units would take 0.6 s).
    expect(typeSeconds('🙂'.repeat(30))).toBeCloseTo(0.5, 9);
    expect(typeSeconds('x'.repeat(100))).toBe(0.6);
    expect(typeSeconds('')).toBe(0.2);
  });

  it('strikes the old lines, then types the new ones a quarter into the scene', () => {
    const m = morphTiming(4, LINES);
    close(m.strike, [1, 1.35]);
    close(m.typing.get(1), [1.25, 1.7]);
    close(m.typing.get(2), [1.37, 1.37 + 13 / 60]);
    expect(m.typing.has(0)).toBe(false);
    expect(m.end).toBeCloseTo(1.7, 9);
  });

  it('starts at its morph phase, and a late one still ends with the scene', () => {
    const k = 0.4 / 0.7;
    const m = morphTiming(4, LINES, { morph: 3.6 });
    close(m.strike, [3.6, 3.6 + 0.35 * k]);
    close(m.typing.get(1), [3.6 + 0.25 * k, 4]);
    expect(m.end).toBeCloseTo(4, 9);
    expect(m.end).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('lights highlights after the typing, unless a phase says when', () => {
    expect(codeHighlights(morph, 4).get(1)).toBeCloseTo(1.8, 9);
    expect(codeHighlights(morph, 4, { highlight: 2.2 }).get(1)).toBeCloseTo(2.2, 9);
  });

  it('lights the highlights within the scene after a late morph', () => {
    // The morph ends with the scene, so its highlights sweep in over the scene's last moment.
    expect(codeHighlights(morph, 4, { morph: 3.6 }).get(1)).toBeCloseTo(4 - HIGHLIGHT_SWEEP, 9);
    expect(settledAt(morph, 4, { morph: 3.6 })).toBeCloseTo(4, 9);
  });
});

describe('highlight groups', () => {
  const grouped: Code = {
    kind: 'code',
    path: 'a.js',
    lines: LINES,
    highlight: [1, 2],
    groups: [{ lines: [1, 2], phase: 'stop' }],
  };

  it('light a group together at its phase', () => {
    const starts = codeHighlights(grouped, 4, { stop: 2.4 });
    expect(starts.get(1)).toBeCloseTo(2.4, 9);
    expect(starts.get(2)).toBeCloseTo(2.45, 9);
  });

  it("falls back when a group's phase is missing, even constructor", () => {
    const starts = codeHighlights(
      { ...grouped, groups: [{ lines: [1, 2], phase: 'constructor' }] },
      4,
      {},
    );
    expect(starts.get(1)).toBeCloseTo(4 * 0.32 + 0.05, 9);
    expect(starts.get(2)).toBeCloseTo(4 * 0.32 + 0.1, 9);
  });

  it('keep a plain list as PR 2 timed it', () => {
    const starts = highlightStarts(4, [1, 3]);
    expect(starts.get(1)).toBeCloseTo(1.33, 9);
    expect(starts.get(3)).toBeCloseTo(1.43, 9);
  });
});

describe('marks', () => {
  it('spread from 22% of the time, all starting before 80%, the first zooming as a focus does', () => {
    const one = markTiming(0, 4, [undefined]);
    expect(one[0]!.start).toBeCloseTo(0.88, 9);
    close(one[0]!.pan, [0.88, 1.92]);
    const two = markTiming(0, 4, [undefined, undefined]);
    close(two[0]!.pan, [0.88, 1.92]);
    close(two[1]!.pan, [2.04, 2.64]);
    const three = markTiming(0, 4, [undefined, undefined, undefined]);
    close(
      three.map((m) => m.start),
      [0.88, 4 * (0.22 + 0.58 / 3), 4 * (0.22 + 1.16 / 3)],
    );
    // A pan never runs past the next mark's start.
    for (const [i, m] of three.entries())
      expect(m.pan[1]).toBeLessThanOrEqual((three[i + 1]?.start ?? 4) + 1e-9);
  });

  it('start at their phases, sharing the time between pinned ones', () => {
    close(
      markTiming(0, 4, [undefined, 2.5]).map((m) => m.start),
      [1.25, 2.5],
    );
    const pinned = markTiming(0, 4, [1, undefined, undefined]);
    close(
      pinned.map((m) => m.start),
      [1, 2, 3],
    );
    close(pinned[0]!.pan, [1, 2]);
    close(pinned[1]!.pan, [2, 2.6]);
    // A pin outside the window is no pin; marks never run backwards.
    close(markTiming(2, 4, [1])[0]!.pan, [2.44, 2.96]);
    const backwards = markTiming(0, 4, [3, 1]);
    expect(backwards[1]!.start).toBeGreaterThanOrEqual(backwards[0]!.start);
  });

  it('take a screenshot from mark to mark, then click from the last', () => {
    const s = screenshotMarks(4, marks2);
    close(s.marks[0]!.pan, [0.88, 1.92]);
    close(s.marks[1]!.pan, [2.04, 2.64]);
    close(s.spot, [1.192, 1.92]);
    close(s.move, [2.64, 3.24]);
    close(s.press, [3.24, 3.96]);
    const pinned = screenshotMarks(4, marks2, { mark2: 1.5, click: 3 });
    close(pinned.marks[0]!.pan, [0.75, 1.5]);
    close(pinned.marks[1]!.pan, [1.5, 2.1]);
    close(pinned.spot, [0.975, 1.5]);
    close(pinned.move, [2.4, 3]);
    close(pinned.press, [3, 3.72]);
    // `zoom` pins the first mark; a phase named like an object property pins nothing.
    expect(screenshotMarks(4, marks2, { zoom: 1 }).marks[0]!.start).toBe(1);
    expect(screenshotMarks(4, [{ phase: 'constructor' }]).marks[0]!.start).toBeCloseTo(0.88, 9);
  });

  it('tour each interaction step within its slot', () => {
    const steps = [[{ phase: 'mark1' }], [{ phase: 'mark2' }, { phase: 'mark3' }]];
    const timing = interactionTiming(6, 2, {}, steps);
    close(timing[0]!.marks![0]!.pan, [0.66, 1.44]);
    close(timing[0]!.zoom, [0.66, 1.44]);
    close(timing[0]!.spot, [0.894, 1.44]);
    // The pointer leaves the last mark only once the camera has reached it.
    close(timing[0]!.move, [1.44, 1.8]);
    close(timing[0]!.press, [1.8, 2.55]);
    close(timing[1]!.marks![0]!.pan, [3.66, 4.44]);
    close(timing[1]!.marks![1]!.pan, [4.53, 5.13]);
    const pinned = interactionTiming(6, 2, { mark3: 5 }, steps);
    close(pinned[1]!.marks![0]!.pan, [4, 4.78]);
    close(pinned[1]!.marks![1]!.pan, [5, 5.6]);
  });

  it('ignores a mark pinned outside its step', () => {
    const steps = [[{ phase: 'mark1' }], [{ phase: 'mark2' }, { phase: 'mark3' }]];
    const outside = interactionTiming(6, 2, { mark3: 2 }, steps);
    close(outside[1]!.marks![0]!.pan, [3.66, 4.44]);
    close(outside[1]!.marks![1]!.pan, [4.53, 5.13]);
    // Steps without marks keep PR 2's timing.
    expect(interactionTiming(6, 2, {}, [undefined, undefined])).toEqual(interactionTiming(6, 2));
  });

  it('never send the pointer backwards when a click is pinned before the last mark', () => {
    const shot = screenshotMarks(4, marks2, { click: 2.2 });
    expect(shot.move[0]).toBeLessThanOrEqual(shot.move[1]);
    expect(shot.move[1]).toBeCloseTo(2.2, 9);
    const [step] = interactionTiming(6, 1, { click: 1.2 }, [marks2]);
    expect(step!.move[0]).toBeLessThanOrEqual(step!.move[1]);
    expect(step!.move[1]).toBeCloseTo(1.2, 9);
  });
});

describe('a phase redaction removed', () => {
  it('pins nothing: everything falls back to its default place', () => {
    const steps = [[{ phase: 'mark1' }], [{ phase: 'mark2' }, { phase: 'mark3' }]];
    const other = { open: 1.1 };
    expect(screenshotMarks(4, marks2, other)).toEqual(screenshotMarks(4, marks2));
    expect(interactionTiming(6, 2, other, steps)).toEqual(interactionTiming(6, 2, {}, steps));
    expect(morphTiming(4, LINES, other)).toEqual(morphTiming(4, LINES));
    const grouped: Code = { ...morph, groups: [{ lines: [1], phase: 'stop' }] };
    expect(codeHighlights(grouped, 4, other)).toEqual(codeHighlights(grouped, 4));
  });
});

describe('diagram edges', () => {
  it('draw one after another, each label arriving with its line', () => {
    close(edgeEntrance(0), [0.8, 1.5]);
    close(edgeEntrance(2), [1.04, 1.74]);
    close(edgeLabelEntrance(1), [1.42, 1.82]);
  });
});

describe('settling and sounds', () => {
  const shot = (click: boolean): TimelineVisual => ({
    kind: 'screenshot',
    image,
    device: 'desktop',
    marks: [
      { focus: box(0), phase: 'mark1' },
      { focus: box(20), phase: 'mark2' },
    ],
    ...(click ? { click: { x: 25, y: 5 } } : {}),
  });

  it('settle when the last mark, the morph, or the last label has arrived', () => {
    expect(settledAt(shot(false), 4)).toBeCloseTo(2.64, 9);
    expect(settledAt(shot(true), 4)).toBeCloseTo(3.96, 9);
    expect(
      settledAt(
        {
          kind: 'interaction',
          steps: [
            { image, marks: [{ focus: box(0), phase: 'mark1' }] },
            {
              image,
              marks: [
                { focus: box(10), phase: 'mark2' },
                { focus: box(20), phase: 'mark3' },
              ],
            },
          ],
        },
        6,
      ),
    ).toBeCloseTo(5.13, 9);
    expect(settledAt(morph, 4)).toBeCloseTo(2.2, 9);
    const nodes = [
      { id: 'a', label: 'A', changed: false },
      { id: 'b', label: 'B', changed: true },
    ];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a', label: 'calls' },
    ];
    expect(settledAt({ kind: 'diagram', nodes, edges }, 4)).toBeCloseTo(1.82, 9);
    expect(
      settledAt({ kind: 'diagram', nodes, edges: edges.map(({ from, to }) => ({ from, to })) }, 4),
    ).toBeCloseTo(1.62, 9);
    // An edge keeps its place in the list even when it names a node that is not there, so its
    // label's timing is the same here and in the runtime.
    const dangling = [{ from: 'a', to: 'gone' }, ...edges];
    expect(settledAt({ kind: 'diagram', nodes, edges: dangling }, 4)).toBeCloseTo(1.94, 9);
  });

  it('sound a click after the marks, where the pointer presses', () => {
    const cues = buildCues([
      scene('s', 2, 6, shot(true)),
      scene('i', 10, 14, {
        kind: 'interaction',
        steps: [
          {
            image,
            click: { x: 1, y: 1 },
            marks: [
              { focus: box(0), phase: 'mark1' },
              { focus: box(20), phase: 'mark2' },
            ],
          },
        ],
      }),
    ]);
    expect(cues.map((c) => [c.kind, c.scene, +c.t.toFixed(6)])).toEqual([
      ['click', 's', 5.24],
      ['click', 'i', 13.04],
    ]);
  });

  it('press a click within the scene, even after a late last mark', () => {
    const late = screenshotMarks(4, marks2, { mark2: 3.5 });
    expect(late.press[0]).toBeLessThanOrEqual(4);
    expect(late.move[1]).toBeLessThanOrEqual(4);
    const [cue] = buildCues([{ ...scene('s', 2, 6, shot(true)), phases: { mark2: 3.5 } }]);
    expect(cue!.t).toBeLessThanOrEqual(6);
    expect(settledAt(shot(true), 4, { mark2: 3.5 })).toBeLessThanOrEqual(4);
  });
});
