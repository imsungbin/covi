import { placeEffects } from '@covi/audio';
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { musicLibrary } from '../src/sound.ts';
import { resolveVideoSpec, type VideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, pacingFor } from '../src/timeline/build.ts';
import {
  beatCues,
  buildCues,
  MERGE_LEAD,
  MERGE_MET,
  visualShownFrom,
} from '../src/timeline/cues.ts';
import type {
  CameraMove,
  DirectionBeat,
  DirectionElement,
  SceneDirection,
  SceneStaging,
  TimelineCue,
  TimelineScene,
  TimelineVisual,
} from '../src/timeline/types.ts';

const R = { x: 0, y: 0, width: 400, height: 200 };
const visual: DirectionElement = { id: 'visual', kind: 'visual', rect: R };
const label = (id: string): DirectionElement => ({
  id,
  kind: 'label',
  rect: R,
  text: id,
  tone: 'neutral',
});
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'x' };

function scene(
  id: string,
  start: number,
  end: number,
  extra: Partial<TimelineScene> = {},
): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: callout,
    expression: 'explaining',
    narrator: true,
    ...extra,
  };
}

/** A scene on the canvas at its stop, directed with these elements and beats. */
const directed = (
  start: number,
  elements: DirectionElement[],
  beats: DirectionBeat[],
  extra: Partial<TimelineScene> = {},
) =>
  scene('d', start, start + 10, {
    stop: { x: 0, y: 0 },
    direction: { whole: false, elements, beats },
    ...extra,
  });

/** A camera beat of 0.8 s. */
const camera = (t: number, move: CameraMove, to: string, zoom?: number): DirectionBeat => ({
  verb: 'camera',
  move,
  to,
  ...(zoom === undefined ? {} : { zoom }),
  t,
  seconds: 0.8,
});

const sounds = (cues: TimelineCue[]) =>
  cues.map((c) => [c.kind, +c.t.toFixed(6), ...(c.seconds === undefined ? [] : [c.seconds])]);

describe('the sounds of a directed scene', () => {
  it('whoosh mid-move for the camera, tick through a count, thump on a merge, accent a reveal', () => {
    const cues = beatCues(
      directed(
        10,
        [visual, label('bytes'), label('req')],
        [
          { verb: 'reveal', element: 'bytes', style: 'pop', t: 1, seconds: 0.5 },
          { verb: 'camera', move: 'zoom', to: 'bytes', t: 2, seconds: 0.8 },
          { verb: 'count', element: 'bytes', t: 3, seconds: 1.6 },
          { verb: 'merge', element: 'req', t: 5, seconds: 2.4 },
          { verb: 'count-up', element: 'bytes', value: 28, t: 8, seconds: 1.6 },
        ],
      ),
    );
    expect(sounds(cues)).toEqual([
      ['appear', 11],
      ['camera', 12.4],
      ['count', 13, 1.6],
      // A merge stretched toward the next beat thumps as its pieces meet, 90% of the way in.
      ['merge', 17.16],
      ['count', 18, 1.6],
    ]);
    expect(cues.find((c) => c.kind === 'camera')).toMatchObject({ scene: 'd', detail: 'zoom' });
    expect(MERGE_MET).toBe(0.9);
    expect(MERGE_LEAD).toBe(0.2);
  });

  it('make no sound of their own for a morph, a flow, a split, or a stack', () => {
    const cues = beatCues(
      directed(
        0,
        [label('a'), label('b')],
        [
          { verb: 'morph', element: 'a', t: 1, seconds: 1.6 },
          { verb: 'flow', from: 'a', to: 'b', t: 3, seconds: 1.2 },
          {
            verb: 'split',
            element: 'a',
            count: 4,
            name: 'chunks',
            side: 'base',
            t: 5,
            seconds: 0.9,
          },
          { verb: 'stack', element: 'b', t: 7, seconds: 1.8 },
        ],
      ),
    );
    expect(cues).toEqual([]);
  });

  it('keep the camera silent when it does not move: off the canvas, at no element, or already there', () => {
    const zoom = (t: number, to = 'a', zoom?: number): DirectionBeat => ({
      verb: 'camera',
      move: 'zoom',
      to,
      ...(zoom === undefined ? {} : { zoom }),
      t,
      seconds: 0.8,
    });
    const shot = directed(
      0,
      [label('a'), label('b')],
      [zoom(1), zoom(2), zoom(3, 'a', 1.5), zoom(4, 'ghost'), zoom(5, 'b'), zoom(6)],
    );
    // The second beat repeats the first; the one at no element is skipped, as the stage skips it.
    expect(sounds(beatCues(shot))).toEqual([
      ['camera', 1.4],
      ['camera', 3.4],
      ['camera', 5.4],
      ['camera', 6.4],
    ]);
    const { stop: _, ...offCanvas } = shot;
    expect(beatCues(offCanvas)).toEqual([]);
  });

  it('keep a pan silent toward the element the camera already frames', () => {
    const shot = directed(
      0,
      [label('a'), label('b')],
      [
        camera(1, 'zoom', 'a', 2),
        camera(2, 'pan', 'a'),
        camera(3, 'pan', 'b'),
        camera(4, 'zoom', 'b'),
        camera(5, 'pan', 'b'),
      ],
    );
    // A pan keeps the scale and centres its target: toward the one already framed, nothing moves.
    expect(sounds(beatCues(shot))).toEqual([
      ['camera', 1.4],
      ['camera', 3.4],
      ['camera', 4.4],
    ]);
  });

  it('keep the camera silent at rest: a pan or a zoom of 1 leaves it there', () => {
    const shot = directed(
      0,
      [label('a'), label('b')],
      [
        camera(1, 'pan', 'a'),
        camera(2, 'zoom', 'a', 1),
        camera(3, 'follow', 'b', 1),
        camera(4, 'zoom', 'b', 2),
        camera(5, 'pan', 'a'),
      ],
    );
    // Unmagnified, the stage keeps the view on its region whatever the camera aims at.
    expect(sounds(beatCues(shot))).toEqual([
      ['camera', 4.4],
      ['camera', 5.4],
    ]);
  });

  it('remember only the beats that move the camera', () => {
    const shot = directed(
      0,
      [label('a'), label('b')],
      [
        camera(1, 'zoom', 'a', 2),
        camera(2, 'pan', 'a'),
        camera(3, 'zoom', 'a', 2),
        camera(4, 'zoom', 'ghost', 2),
        camera(5, 'zoom', 'a', 2),
      ],
    );
    expect(sounds(beatCues(shot))).toEqual([['camera', 1.4]]);
  });

  it('whoosh for every beat that moves the camera, back to rest included', () => {
    const shot = directed(
      0,
      [label('a'), label('b')],
      [
        camera(1, 'zoom', 'a', 2),
        camera(2, 'zoom', 'a', 1),
        camera(3, 'pan', 'b'),
        camera(4, 'follow', 'b', 2),
        camera(5, 'zoom', 'b', 2),
        camera(6, 'pan', 'a'),
      ],
    );
    // A pan at rest stays there; a follow frames its target its own way, so a zoom to it moves.
    expect(sounds(beatCues(shot))).toEqual([
      ['camera', 1.4],
      ['camera', 2.4],
      ['camera', 4.4],
      ['camera', 5.4],
      ['camera', 6.4],
    ]);
  });

  it('accent only the first reveal of an element, the one the stage draws', () => {
    const cues = beatCues(
      directed(
        0,
        [label('a'), label('b')],
        [
          { verb: 'reveal', element: 'a', style: 'pop', t: 1, seconds: 0.5 },
          { verb: 'reveal', element: 'b', style: 'pop', t: 2, seconds: 0.5 },
          { verb: 'reveal', element: 'a', style: 'rise', t: 3, seconds: 0.5 },
        ],
      ),
    );
    expect(sounds(cues)).toEqual([
      ['appear', 1],
      ['appear', 2],
    ]);
  });

  it('thump a stretched merge clear of the count that follows it, so both are heard', () => {
    // The resolver stretches a merge until 0.15 s before the next beat (here a count landing on
    // its phrase); times rounded to the millisecond can leave 0.149 s, inside the spacing the
    // effects keep.
    const cues = beatCues(
      directed(
        0,
        [label('req'), label('bytes')],
        [
          { verb: 'merge', element: 'req', t: 1, seconds: 2.4 },
          { verb: 'count', element: 'bytes', t: 3.549, seconds: 1.6 },
        ],
      ),
    );
    const { placed, dropped } = placeEffects(cues, musicLibrary().soundEffects);
    expect(dropped).toEqual([]);
    expect(placed.map((p) => p.kind)).toEqual(['merge', 'count']);
  });

  it('thump a merge that makes way for a count clear of it', () => {
    // A merge without a phrase moves earlier to end exactly as a count starts.
    const cues = beatCues(
      directed(
        0,
        [label('req'), label('bytes')],
        [
          { verb: 'merge', element: 'req', t: 1, seconds: 0.8 },
          { verb: 'count', element: 'bytes', t: 1.8, seconds: 1.6 },
        ],
      ),
    );
    expect(sounds(cues)).toEqual([
      ['merge', 1.6],
      ['count', 1.8, 1.6],
    ]);
    const { placed, dropped } = placeEffects(cues, musicLibrary().soundEffects);
    expect(dropped).toEqual([]);
    expect(placed.map((p) => p.kind)).toEqual(['merge', 'count']);
  });

  it('thump a short merge no earlier than half way through it', () => {
    const cues = beatCues(
      directed(0, [label('req')], [{ verb: 'merge', element: 'req', t: 1, seconds: 0.3 }]),
    );
    expect(sounds(cues)).toEqual([['merge', 1.15]]);
  });

  it('let the riser carry a camera move into the hero, as it carries the entrance', () => {
    const hero = directed(
      0,
      [label('a'), label('b')],
      [
        { verb: 'camera', move: 'zoom', to: 'a', t: 2.5, seconds: 0.8 },
        { verb: 'camera', move: 'pan', to: 'b', t: 5, seconds: 0.8 },
      ],
      { hero: true, phases: { hero: 3.5 } },
    );
    expect(sounds(buildCues([hero]))).toEqual([
      ['riser', 2.7],
      ['hero', 3.5],
      ['camera', 5.4],
    ]);
  });
});

describe('what the storyboard visual does', () => {
  const findings: TimelineVisual = {
    kind: 'findings',
    findings: [{ title: 'F', certainty: 'likely', severity: 'high' }],
  };
  const shot = (direction: SceneDirection) =>
    scene('f', 0, 6, { visual: findings, stop: { x: 0, y: 0 }, direction });

  it('sounds while the shot shows it, and not when the shot leaves it out', () => {
    const kinds = (s: TimelineScene) => buildCues([s]).map((c) => c.kind);
    expect(kinds(scene('f', 0, 6, { visual: findings }))).toEqual(['finding']);
    expect(kinds(shot({ whole: true, elements: [visual], beats: [] }))).toEqual(['finding']);
    expect(visualShownFrom(shot({ whole: false, elements: [label('note')], beats: [] }))).toBe(
      undefined,
    );
    expect(kinds(shot({ whole: false, elements: [label('note')], beats: [] }))).toEqual([]);
  });

  it('keeps only what happens after the shot reveals it', () => {
    const late = (t: number) =>
      shot({
        whole: false,
        elements: [visual, label('note')],
        beats: [{ verb: 'reveal', element: 'visual', style: 'rise', t, seconds: 0.5 }],
      });
    // The card lands 0.45 s in: revealed at 0.2 s it is heard, revealed at 2 s it is not.
    expect(buildCues([late(0.2)]).map((c) => c.kind)).toEqual(['appear', 'finding']);
    expect(buildCues([late(2)]).map((c) => c.kind)).toEqual(['appear']);
    expect(visualShownFrom(late(2))).toBe(2);
  });
});

describe('a directed timeline', () => {
  it('never depends on the music or the effects', () => {
    const board = ['s1', 's2'].map(
      (id) => ({ id, beat: id, narration: 'A short line here.', visual: callout }) as Scene,
    );
    const staging: SceneStaging[] = [
      {
        stop: { x: 0, y: 0 },
        direction: {
          whole: false,
          elements: [visual, label('bytes')],
          beats: [
            { verb: 'reveal', element: 'bytes', style: 'pop', t: 0.4, seconds: 0.5 },
            { verb: 'count', element: 'bytes', t: 1, seconds: 1.6 },
          ],
        },
      },
      {
        stop: { x: 2400, y: 0 },
        direction: {
          whole: false,
          elements: [label('req')],
          beats: [
            { verb: 'camera', move: 'zoom', to: 'req', t: 0.3, seconds: 0.8 },
            { verb: 'merge', element: 'req', t: 1.2, seconds: 0.8 },
          ],
        },
      },
    ];
    const entrances = new Map([['s2', 'pan' as const]]);
    const build = (spec: VideoSpec) =>
      buildTimeline({
        title: 'T',
        scenes: board,
        layout: layoutScenes(board, new Map(), new Map(), 'en', pacingFor(spec), entrances),
        spec,
        image: () => ({ src: 'a.png', width: 1, height: 1 }),
        entrances,
        staging,
      });
    const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
    const loud = build(spec);
    for (const quiet of [
      { ...spec, soundEffects: false },
      { ...spec, music: { ...spec.music, use: 'none' as const } },
      { ...spec, music: { ...spec.music, use: 'compose' as const } },
    ])
      expect(build(quiet)).toEqual(loud);
    expect(loud.cues.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['appear', 'count', 'transition', 'camera', 'merge']),
    );
  });
});
