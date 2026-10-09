import { motion } from '@covi/brand';
import { describe, expect, it } from 'vitest';
import { easeOutCubic } from '../src/runtime/anim.ts';
import { cameraPlan, cameraPush, heroAccent, heroPunch } from '../src/runtime/camera.ts';
import { entering, leaving, REST, sceneStyle, transitionOf } from '../src/runtime/transitions.ts';
import { settledAt, shotSettledAt } from '../src/timeline/cues.ts';
import type { TimelineScene } from '../src/timeline/types.ts';

const W = 1920;
const U = 1;

describe('scene transitions', () => {
  it('fade the way scenes always have', () => {
    expect(entering('fade', 0, U, W)).toEqual({ ...REST, opacity: 0, y: 26 });
    const half = entering('fade', 0.5, U, W);
    expect(half.opacity).toBeCloseTo(0.875, 9);
    expect(half.y).toBeCloseTo(0.125 * 26, 9);
    expect(entering('fade', 1, U, W)).toEqual(REST);
    expect(leaving('fade', 1, U, W)).toEqual({ ...REST, opacity: 0, y: -14 });
  });

  it('cut at once', () => {
    expect(entering('cut', 0, U, W)).toEqual(REST);
    expect(leaving('cut', 0.99, U, W)).toEqual(REST);
    expect(leaving('cut', 1, U, W).opacity).toBe(0);
  });

  it('push the old scene out to the left as the new one slides in beside it', () => {
    for (const k of [0, 0.25, 0.5, 0.9, 1]) {
      expect(entering('push', k, U, W).x - leaving('push', k, U, W).x).toBeCloseTo(W, 6);
      expect(entering('push', k, U, W).opacity).toBe(1);
      expect(leaving('push', k, U, W).opacity).toBe(1);
    }
    expect(entering('push', 0, U, W).x).toBe(W);
    expect(leaving('push', 1, U, W).x).toBe(-W);
  });

  it('wipe the new scene in from the left as the old one gives way', () => {
    expect(entering('wipe', 0, U, W).clipRight).toBe(1);
    expect(entering('wipe', 0.25, U, W).clipRight).toBeCloseTo(0.9375, 9);
    expect(entering('wipe', 1, U, W)).toEqual(REST);
    // The scene roots have no background: the old scene is clipped where the new one has come,
    // so the two never show at once in any part of the frame.
    for (const k of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const edge = 1 - entering('wipe', k, U, W).clipRight;
      expect(leaving('wipe', k, U, W).clipLeft).toBeCloseTo(edge, 12);
      expect(leaving('wipe', k, U, W)).toMatchObject({ x: 0, y: 0, scale: 1, clipRight: 0 });
    }
    expect(leaving('wipe', 1, U, W).opacity).toBe(0);
  });

  it('zoom through: the old scene grows away as the new one settles in', () => {
    expect(entering('zoom-through', 0, U, W)).toMatchObject({ opacity: 0, scale: 0.92 });
    expect(entering('zoom-through', 1, U, W)).toEqual(REST);
    expect(leaving('zoom-through', 1, U, W)).toMatchObject({ opacity: 0, scale: 1.12 });
  });

  it('compose an entrance and an exit into one style', () => {
    expect(sceneStyle(REST, REST)).toEqual({
      opacity: '1.0000',
      transform: 'translate(0.00px, 0.00px)',
      clipPath: '',
    });
    expect(sceneStyle(entering('wipe', 0.25, U, W), REST).clipPath).toBe('inset(0 93.750% 0 0)');
    expect(sceneStyle(REST, leaving('wipe', 0.25, U, W)).clipPath).toBe('inset(0 0 0 6.250%)');
    expect(
      sceneStyle(entering('zoom-through', 0.5, U, W), leaving('fade', 0.5, U, W)).transform,
    ).toMatch(/ scale\(0\.9900\)$/);
  });

  it('fall back to the shared fade for timelines written before transitions had kinds', () => {
    expect(transitionOf({}, { transition: 0.45 })).toEqual({ kind: 'fade', seconds: 0.45 });
    expect(transitionOf({ transition: { kind: 'cut', seconds: 0 } }, { transition: 0.45 })).toEqual(
      { kind: 'cut', seconds: 0 },
    );
  });

  it('draw a camera move like the move it resembles when there is no canvas', () => {
    for (const k of [0, 0.3, 0.7, 1]) {
      expect(entering('pan', k, U, W)).toEqual(entering('push', k, U, W));
      expect(leaving('pan', k, U, W)).toEqual(leaving('push', k, U, W));
      expect(entering('zoom', k, U, W)).toEqual(entering('zoom-through', k, U, W));
      expect(leaving('zoom', k, U, W)).toEqual(leaving('zoom-through', k, U, W));
    }
  });
});

const image = { src: 'a.png', width: 100, height: 100 };
const scene = (visual: TimelineScene['visual'], extra: Partial<TimelineScene> = {}) =>
  ({
    id: 's',
    beat: 's',
    eyebrow: 's',
    start: 10,
    end: 14,
    visual,
    expression: 'explaining',
    narrator: true,
    speech: { start: 10.3, end: 13.5, text: 'x' },
    ...extra,
  }) as TimelineScene;
const shot = { kind: 'screenshot', image, device: 'desktop' } as const;
const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;

describe('the camera', () => {
  it('drifts across a capture, at most 2%, eased in and out', () => {
    const plan = cameraPlan(scene(shot))!;
    expect(plan).toMatchObject({ duration: 4, drift: true, still: false });
    expect(cameraPush(0, plan)).toBe(0);
    expect(cameraPush(2, plan)).toBeCloseTo(motion.drift / 2, 9);
    expect(cameraPush(4, plan)).toBeCloseTo(motion.drift, 9);
    for (let t = 0; t <= 4; t += 0.1) expect(cameraPush(t, plan)).toBeLessThanOrEqual(0.02 + 1e-12);
  });

  it('pushes in on a finished visual while its line continues', () => {
    const plan = cameraPlan(scene(callout))!;
    expect(plan).toMatchObject({ drift: false, settled: 0.6, speechEnd: 3.5 });
    expect(cameraPush(0.6, plan)).toBe(0);
    expect(cameraPush(2.3, plan)).toBeCloseTo(motion.linger / 2, 9);
    expect(cameraPush(4, plan)).toBeCloseTo(motion.linger, 9);
    // A visual still moving when its line ends has nothing to linger on.
    const finding = { title: 'x', certainty: 'risk', severity: 'low' } as const;
    const late = cameraPlan(
      scene(
        { kind: 'findings', findings: [finding, finding, finding] },
        { speech: { start: 10.2, end: 11, text: 'x' } },
      ),
    )!;
    expect(cameraPush(3.9, late)).toBe(0);
  });

  it('pushes in from the entrance on a visual whose events are pinned apart', () => {
    // Output pinned late in the line: the window is up by 0.5 s and nothing else moves until
    // typing starts, so the camera carries the gap.
    const terminal = { kind: 'terminal', command: 'npm test', output: 'ok' } as const;
    const plan = cameraPlan(
      scene(terminal, {
        end: 16,
        phases: { output: 4 },
        speech: { start: 10.3, end: 15.6, text: 'x' },
      }),
    )!;
    expect(plan.settled).toBeLessThanOrEqual(0.5);
    for (let t = 1; t < 3; t += 0.25)
      expect(cameraPush(t + 0.25, plan)).toBeGreaterThan(cameraPush(t, plan));
    for (let t = 0; t <= 6; t += 0.1)
      expect(cameraPush(t, plan)).toBeLessThanOrEqual(motion.punch + 1e-12);
    // Without a pinned event the push still waits for the choreography to finish.
    expect(cameraPlan(scene(terminal, { end: 16 }))!.settled).toBeGreaterThan(0.5);
  });

  it('pushes in on a diagram once its nodes are up, while its edges draw', () => {
    // Edges drawn centre to centre hide mostly under the nodes: the frame would look still
    // until the choreography ends.
    const nodes = [
      { id: 'a', label: 'A', changed: false },
      { id: 'b', label: 'B', changed: true },
    ];
    const diagram: TimelineScene['visual'] = {
      kind: 'diagram',
      nodes,
      edges: [{ from: 'a', to: 'b', label: 'calls' }],
    };
    const plan = cameraPlan(scene(diagram))!;
    expect(plan.settled).toBeLessThanOrEqual(0.5);
    for (let t = 0.75; t < 1.75; t += 0.25)
      expect(cameraPush(t + 0.25, plan)).toBeGreaterThan(cameraPush(t, plan));
    for (let t = 0; t <= 4; t += 0.1)
      expect(cameraPush(t, plan)).toBeLessThanOrEqual(motion.punch + 1e-12);
  });

  it('holds still when the storyboard says so, but the hero still punches', () => {
    expect(cameraPush(3, cameraPlan(scene(shot, { camera: 'static' }))!)).toBe(0);
    const hero = cameraPlan(scene(shot, { camera: 'static', hero: true, phases: { hero: 1 } }))!;
    expect(hero.hero).toBe(1);
    expect(cameraPush(1.1, hero)).toBeCloseTo(motion.punch, 9);
    expect(cameraPush(1.6, hero)).toBe(0);
    // Drift and punch together never push past the punch alone.
    const drifting = cameraPlan(scene(shot, { hero: true, phases: { hero: 3.9 } }))!;
    expect(cameraPush(4, drifting)).toBeCloseTo(motion.punch, 9);
  });

  it('leaves the outro alone, and lingers on cards and titles over a capture', () => {
    expect(cameraPlan(scene({ kind: 'outro' }))).toBeUndefined();
    const summary: TimelineScene['visual'] = {
      kind: 'summary',
      verdict: 'looks-good',
      headline: 'H',
      points: [],
    };
    expect(cameraPlan(scene(summary))).toMatchObject({ drift: false });
    expect(
      cameraPlan(scene({ kind: 'title', title: 'T', meta: [], background: image })),
    ).toMatchObject({ drift: true });
    expect(cameraPlan(scene({ kind: 'title', title: 'T', meta: [] }))).toMatchObject({
      drift: false,
    });
  });
});

describe('the hero accent', () => {
  it('punches in fast and out slowly', () => {
    expect(heroPunch(-0.01)).toBe(0);
    expect(heroPunch(0)).toBe(0);
    expect(heroPunch(0.1)).toBe(1);
    expect(heroPunch(0.35)).toBeCloseTo(0.5, 9);
    expect(heroPunch(0.6)).toBe(0);
  });

  it('flashes for under 0.2 s and rings once', () => {
    expect(motion.flash.seconds).toBeLessThanOrEqual(0.2);
    expect(heroAccent(-0.01)).toEqual({ flash: 0, ring: 0, ringOpacity: 0 });
    expect(heroAccent(0.04).flash).toBeCloseTo(motion.flash.opacity, 9);
    expect(heroAccent(motion.flash.seconds).flash).toBe(0);
    expect(heroAccent(0.35).ring).toBeCloseTo(easeOutCubic(0.5), 9);
    expect(heroAccent(0.7)).toEqual({ flash: 0, ring: 0, ringOpacity: 0 });
  });
});

describe('the camera in a directed scene', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const base = {
    id: 's',
    beat: 's',
    eyebrow: 's',
    start: 0,
    end: 6,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    speech: { start: 0.3, end: 5, text: 'x' },
  } as TimelineScene;

  it('pushes in once the shot’s beats are done, not before', () => {
    expect(cameraPlan(base)!.settled).toBe(0.6);
    const directed: TimelineScene = {
      ...base,
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect }],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual', t: 2, seconds: 0.8 }],
      },
    };
    expect(cameraPlan(directed)!.settled).toBeCloseTo(2.8, 9);
  });

  it('waits for every element’s own choreography from its reveal', () => {
    const code = {
      kind: 'code' as const,
      path: 'a.js',
      lines: [
        { type: 'del' as const, text: 'a' },
        { type: 'add' as const, text: 'b' },
      ],
      highlight: [],
    };
    const scene: TimelineScene = {
      ...base,
      direction: {
        whole: false,
        elements: [
          { id: 'c', kind: 'code', rect, visual: code },
          { id: 'l', kind: 'label', rect, text: 'Hi', tone: 'neutral' },
        ],
        beats: [
          { verb: 'reveal', element: 'l', style: 'rise', t: 1, seconds: 0.5 },
          { verb: 'reveal', element: 'c', style: 'rise', t: 2, seconds: 0.5 },
        ],
      },
    };
    // The code's lines have entered 0.57 s after its reveal; the label 0.5 s after its own.
    expect(shotSettledAt(scene)).toBeCloseTo(2 + settledAt(code, 4), 9);
    expect(shotSettledAt(base)).toBe(settledAt(base.visual, 6, undefined));
  });

  it('drifts across a capture shown alone, and holds it still beside other elements', () => {
    const capture = {
      ...base,
      visual: {
        kind: 'screenshot',
        image: { src: 'a.png', width: 10, height: 10 },
        device: 'desktop',
      },
    } as TimelineScene;
    const whole = {
      whole: true,
      elements: [{ id: 'visual', kind: 'visual' as const, rect }],
      beats: [],
    };
    expect(cameraPlan({ ...capture, direction: whole })!.drift).toBe(true);
    expect(cameraPlan({ ...capture, direction: { ...whole, whole: false } })!.drift).toBe(false);
  });
});
