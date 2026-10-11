import { describe, expect, it } from 'vitest';
import {
  choreographyChecks,
  droppedBeatsCheck,
  motionBusyCheck,
  motionGapCheck,
  outOfFrameCheck,
  overlapCheck,
  readingSeconds,
  readingTimeCheck,
} from '../src/choreography.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import { settledFrame } from '../src/timeline/cues.ts';
import type {
  DirectionBeat,
  DirectionElement,
  LayoutReport,
  Timeline,
  TimelineScene,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const label = (id: string, text: string): DirectionElement => ({
  id,
  kind: 'label',
  rect,
  text,
  tone: 'neutral',
});
const scene = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    speech: { start: start + 0.3, end: end - 0.5, text: 'x' },
    ...extra,
  }) as TimelineScene;
const shot = (elements: DirectionElement[], beats: DirectionBeat[] = []) => ({
  whole: false,
  elements,
  beats,
});
const outro = (start: number) =>
  scene('covi:outro', start, start + 2.5, { visual: { kind: 'outro' }, speech: undefined });
const timeline = (scenes: TimelineScene[]) =>
  ({
    scenes,
    transition: 0.45,
    fps: 30,
    frames: Math.round((scenes.at(-1)?.end ?? 0) * 30),
    width: 1920,
    height: 1080,
    orientation: 'landscape',
  }) as Timeline;
const reveal = (element: string, t: number): DirectionBeat => ({
  verb: 'reveal',
  element,
  style: 'rise',
  t,
  seconds: 0.5,
});

describe('motion gaps', () => {
  // A held picture: no push-in, and the second label waits 2.5 s after the first.
  const held = scene('s1', 0, 6, {
    camera: 'static',
    direction: shot([label('a', 'One'), label('b', 'Two')], [reveal('a', 0.5), reveal('b', 3)]),
  });

  it('name a stretch of narration with nothing moving, and what ends it', () => {
    const check = motionGapCheck(timeline([held, outro(6)]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain('s1 (2.0 s from 1.0 s, until the reveal at 3.0 s)');
    // The last label has risen by 3.5 s; nothing moves again before the outro.
    expect(check.message).toContain('s1 (2.0 s from 3.5 s, until the outro at 6.0 s)');
  });

  it('count the wait between beats even while the camera pushes in through it', () => {
    // Under the default camera the shot pushes in from its entrance at an even pace, but that
    // push is motion only once the shot has settled (3.5 s): the 2 s wait for the second label
    // is still a gap, and the push covers the rest of the line.
    const pushing = { ...held, camera: undefined };
    const check = motionGapCheck(timeline([pushing, outro(6)]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain('s1 (2.0 s from 1.0 s, until the reveal at 3.0 s)');
    expect(check.message).not.toContain('3.5 s');
  });

  it('stay quiet when the beats leave just under 1.5 s of narration between them', () => {
    const close = scene('s1', 0, 6, {
      direction: shot([label('a', 'One'), label('b', 'Two')], [reveal('a', 0.5), reveal('b', 2.4)]),
    });
    const check = motionGapCheck(timeline([close, outro(6)]));
    expect(check.status).toBe('pass');
    expect(check.message).toContain('the longest still stretch under it is 1.4 s');
  });

  it('do not count silence: a still stretch with no line is not a gap', () => {
    const quiet = { ...held, speech: undefined };
    expect(motionGapCheck(timeline([quiet, outro(6)])).status).toBe('pass');
  });
});

describe('busy pictures', () => {
  it('warn when more than three beats start within a second', () => {
    const beats = [0.5, 0.7, 0.9, 1.2].map((t, i) => reveal(`e${i}`, t));
    const elements = beats.map((_, i) => label(`e${i}`, 'X'));
    const crowded = scene('s1', 0, 6, { direction: shot(elements, beats) });
    expect(motionBusyCheck(timeline([crowded])).message).toContain(
      '4 beats start within 1 s in s1 (from 0.5 s)',
    );
    const spread = beats.map((b, i) => ({ ...b, t: 0.5 + 0.4 * i }));
    expect(
      motionBusyCheck(timeline([scene('s1', 0, 6, { direction: shot(elements, spread) })])).status,
    ).toBe('pass');
  });

  it('warn on more than two camera moves within two seconds, a pan between stops among them', () => {
    const camera = (t: number): DirectionBeat => ({
      verb: 'camera',
      move: 'zoom',
      to: 'a',
      t,
      seconds: 0.8,
    });
    const stop = { x: 0, y: 0 };
    const scenes = (stops: boolean) => [
      scene('s1', 0, 4, stops ? { stop } : {}),
      scene('s2', 4, 9, {
        transition: { kind: 'pan', seconds: 0.7 },
        ...(stops ? { stop: { x: 2400, y: 0 } } : {}),
        direction: shot([label('a', 'A')], [camera(0.8), camera(1.6)]),
      }),
    ];
    expect(motionBusyCheck(timeline(scenes(true))).message).toContain(
      '3 camera moves within 2 s in s2 (from 4.0 s)',
    );
    // Without a canvas a pan is drawn as a push: not a camera move.
    expect(motionBusyCheck(timeline(scenes(false))).status).toBe('pass');
  });
});

describe('reading time', () => {
  it('reads Latin text at 15 characters a second and CJK at 8, after a glance', () => {
    expect(readingSeconds('Reader')).toBeCloseTo(0.4 + 6 / 15, 9);
    expect(readingSeconds('리더 단계')).toBeCloseTo(0.4 + 4 / 8, 9);
    expect(readingSeconds('  ')).toBeCloseTo(0.4, 9);
  });

  it('warn on words that leave before they can be read', () => {
    const words = 'Reader fetches each document';
    // Revealed at 3.6 s, fully in at 4.1 s; the next scene starts to enter at 4.55 s. Its 25
    // characters want 0.4 + 25 / 15 s.
    const late = scene('s1', 0, 5, { direction: shot([label('l', words)], [reveal('l', 3.6)]) });
    const next = scene('s2', 4.55, 9, { transition: { kind: 'fade', seconds: 0.45 } });
    const check = readingTimeCheck(timeline([late, next]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain(`"${words}" in s1 for 0.5 s (2.1 s wanted)`);
    const early = { ...late, direction: shot([label('l', words)], [reveal('l', 0.5)]) };
    expect(readingTimeCheck(timeline([early, next])).status).toBe('pass');
  });

  it('hold the code a morph adds until it can be read, for at most 2 s', () => {
    // `return` stays and the elided runs' markers are no change: only the added call is read.
    const morph = (added: string): DirectionElement => ({
      id: 'm',
      kind: 'morph',
      rect,
      morph: {
        path: 'a.ts',
        base: [
          { type: 'del', number: 1, tokens: [{ text: 'return' }, { text: ' ' }, { text: 'a' }] },
          { type: 'elided', tokens: [{ text: '… 3 lines' }] },
        ],
        head: [
          { type: 'add', number: 1, tokens: [{ text: 'return' }, { text: ' ' }, { text: added }] },
          { type: 'elided', tokens: [{ text: '… 4 lines' }] },
        ],
        rows: [
          [0, 0],
          [1, 1],
        ],
        tokens: [[0, 0, 0, 0]],
      },
    });
    const morphing = (added: string, t: number) =>
      scene('s1', 0, 5, {
        direction: shot([morph(added)], [{ verb: 'morph', element: 'm', t, seconds: 0.8 }]),
      });
    const next = scene('s2', 4.55, 9, { transition: { kind: 'fade', seconds: 0.45 } });
    // Its added tokens settle at 3.5 + 0.8 + 0.5 = 4.8 s, after the next scene starts to enter.
    expect(readingTimeCheck(timeline([morphing('fetchAll(ids)', 3.5), next])).message).toContain(
      'the code that morph "m" adds in s1 for 0.0 s (1.3 s wanted)',
    );
    // Settled at 2.3 s, a long addition has its 2 s by 4.55 s.
    expect(readingTimeCheck(timeline([morphing('x'.repeat(60), 1), next])).status).toBe('pass');
  });
});

describe('dropped beats', () => {
  it('say which beats did not play, and why', () => {
    const s = scene('s1', 0, 6, {
      direction: {
        ...shot([label('a', 'A')]),
        dropped: [
          {
            verb: 'merge',
            element: 'p',
            reason: 'the merge of "p" at 2.0 s comes before its split',
          },
          {
            verb: 'split',
            element: 'p',
            reason: 'the slot of node "n" has no room beside its label for 3 pieces',
          },
        ],
      },
    });
    const check = droppedBeatsCheck(timeline([s]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain(
      'a merge in s1: the merge of "p" at 2.0 s comes before its split',
    );
    // A reason that does not name its beat still says which verb was left out.
    expect(check.message).toContain(
      'a split in s1: the slot of node "n" has no room beside its label for 3 pieces',
    );
    expect(droppedBeatsCheck(timeline([scene('s1', 0, 6)])).status).toBe('pass');
  });
});

describe('shots on the frame', () => {
  const media = computeRegions({ width: 1920, height: 1080, orientation: 'landscape' }).media;
  const t = timeline([scene('s1', 0, 6, { direction: shot([label('a', 'A'), label('b', 'B')]) })]);
  const at = (elements: Array<{ id: string; rect: typeof rect }>, frame = settledFrame(t, 0)!) =>
    [
      { frame, scene: 's1', items: [], imagesLoaded: true, shot: { region: media, elements } },
    ] as LayoutReport[];
  const box = (x: number, y: number, width = 400, height = 300) => ({ x, y, width, height });

  it('warn on elements that collide, but not on one set inside another', () => {
    const a = box(media.x, media.y);
    expect(
      overlapCheck(
        t,
        at([
          { id: 'a', rect: a },
          { id: 'b', rect: box(media.x + 350, media.y) },
        ]),
      ).message,
    ).toContain('"a" and "b" in s1 (13%)');
    // 3% of the smaller: close, not colliding.
    expect(
      overlapCheck(
        t,
        at([
          { id: 'a', rect: a },
          { id: 'b', rect: box(media.x + 388, media.y) },
        ]),
      ).status,
    ).toBe('pass');
    // A packet on its node lies wholly inside it, by design.
    expect(
      overlapCheck(
        t,
        at([
          { id: 'a', rect: a },
          { id: 'p', rect: box(media.x + 50, media.y + 50, 100, 60) },
        ]),
      ).status,
    ).toBe('pass');
  });

  it('fail an element drawn past the frame, within a few pixels of tolerance', () => {
    const past = outOfFrameCheck(t, at([{ id: 'a', rect: box(t.width - 380, media.y) }]));
    expect(past).toMatchObject({ id: 'out-of-frame', status: 'fail' });
    expect(past.message).toContain('"a" in s1');
    const edge = box(t.width - 403, media.y);
    expect(outOfFrameCheck(t, at([{ id: 'a', rect: edge }])).status).toBe('pass');
    // The side margin is drawn even while the viewport clips: only the region's rows are cut.
    const margin = box(media.x + media.width - 380, media.y);
    expect(outOfFrameCheck(t, at([{ id: 'a', rect: margin }])).status).toBe('pass');
    const above = outOfFrameCheck(t, at([{ id: 'a', rect: box(media.x, media.y - 20) }]));
    expect(above.status).toBe('fail');
  });

  it('read only frames where the scene has settled, and say when nothing was measured', () => {
    const early = at([{ id: 'a', rect: box(media.x + media.width - 100, media.y) }], 1);
    expect(outOfFrameCheck(t, early).message).toBe('No shot was measured at a settled frame.');
    // A frames.json written before shots were reported: nothing to hold, nothing failed.
    const old = at([]).map(({ shot: _, ...report }) => report);
    expect(outOfFrameCheck(t, old)).toMatchObject({ status: 'pass' });
    expect(overlapCheck(t, old)).toMatchObject({ status: 'pass' });
  });

  it('come in one order, out-of-frame the only one that fails', () => {
    const checks = choreographyChecks(t, at([{ id: 'a', rect: box(-50, media.y) }]));
    expect(checks.map((c) => c.id)).toEqual([
      'motion-gap',
      'motion-busy',
      'reading-time',
      'overlap',
      'out-of-frame',
      'dropped-beats',
    ]);
    expect(checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['out-of-frame']);
  });
});
