import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec, type VideoSpec } from '../src/spec.ts';
import { StoryboardSchema } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, pacingFor } from '../src/timeline/build.ts';
import { buildCues, RISER_LEAD } from '../src/timeline/cues.ts';
import type { TimelineCue, TimelineScene, TimelineVisual } from '../src/timeline/types.ts';

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

const at = (cues: TimelineCue[]) => cues.map((c) => [c.kind, +c.t.toFixed(6)]);

describe('the hero stack', () => {
  it('raises into the hero and hits at its phase', () => {
    const cues = buildCues([
      scene('a', 0, 4),
      scene('h', 4, 8, {
        hero: true,
        transition: { kind: 'fade', seconds: 0.45 },
        phases: { hero: 1.5 },
      }),
    ]);
    expect(RISER_LEAD).toBe(0.8);
    expect(at(cues)).toEqual([
      ['riser', 4.7],
      ['hero', 5.5],
    ]);
    expect(cues.every((c) => c.scene === 'h')).toBe(true);
  });

  it('lets the riser carry the zoom-through into the hero', () => {
    // Short-form: the hero's line starts as it settles, so the whoosh would fall inside the riser.
    const tight = buildCues([
      scene('a', 0, 4.3),
      scene('h', 4, 8, {
        hero: true,
        transition: { kind: 'zoom-through', seconds: 0.6 },
        phases: { hero: 0.6 },
      }),
    ]);
    expect(at(tight)).toEqual([
      ['riser', 3.8],
      ['hero', 4.6],
    ]);
    // A standard review breathes before the hero's line: the whoosh comes first, then the riser.
    const breathing = buildCues([
      scene('a', 0, 4.3),
      scene('h', 4, 8, {
        hero: true,
        transition: { kind: 'zoom-through', seconds: 0.6 },
        phases: { hero: 2 },
      }),
    ]);
    expect(at(breathing)).toEqual([
      ['transition', 4.3],
      ['riser', 5.2],
      ['hero', 6],
    ]);
  });

  it('leaves out a riser that would start before the video', () => {
    expect(at(buildCues([scene('h', 0, 4, { hero: true, phases: { hero: 0.3 } })]))).toEqual([
      ['hero', 0.3],
    ]);
  });

  it('stays silent for a hero without its phase (a timeline from before the accent)', () => {
    expect(buildCues([scene('h', 0, 4, { hero: true })])).toEqual([]);
  });
});

describe('transition whooshes', () => {
  it('sound mid-move for push, wipe, and zoom-through, never for fade or cut', () => {
    const cues = buildCues([
      scene('a', 0, 4),
      scene('b', 4, 8, { transition: { kind: 'push', seconds: 0.5 } }),
      scene('c', 8, 12, { transition: { kind: 'wipe', seconds: 0.55 } }),
      scene('d', 12, 16, { transition: { kind: 'fade', seconds: 0.45 } }),
      scene('e', 16, 20, { transition: { kind: 'cut', seconds: 0 } }),
      scene('f', 20, 24, { transition: { kind: 'zoom-through', seconds: 0.6 } }),
    ]);
    expect(cues.map((c) => [c.kind, c.scene, c.detail, +c.t.toFixed(6)])).toEqual([
      ['transition', 'b', 'push', 4.25],
      ['transition', 'c', 'wipe', 8.275],
      ['transition', 'f', 'zoom-through', 20.3],
    ]);
  });

  it('sound mid-move when the camera pans or zooms to the next stop', () => {
    const cues = buildCues([
      scene('a', 0, 4),
      scene('b', 4, 8, { transition: { kind: 'pan', seconds: 0.7 } }),
      scene('c', 8, 12, { transition: { kind: 'zoom', seconds: 0.9 } }),
    ]);
    expect(cues.map((c) => [c.kind, c.scene, c.detail, +c.t.toFixed(6)])).toEqual([
      ['transition', 'b', 'pan', 4.35],
      ['transition', 'c', 'zoom', 8.45],
    ]);
  });
});

describe("a scene's own cues", () => {
  it('play at their moments, and none past the end of the scene', () => {
    const cues = buildCues([
      scene('s', 2, 6, {
        cues: [
          { at: 1, kind: 'click' },
          { at: 3.5, kind: 'reveal' },
          { at: 4.5, kind: 'finding' },
        ],
      }),
    ]);
    expect(at(cues)).toEqual([
      ['click', 3],
      ['reveal', 5.5],
    ]);
  });

  it("end a riser cue at its moment, and merge one that repeats Covi's", () => {
    const cues = buildCues([
      scene('a', 0, 4),
      scene('h', 4, 8, {
        hero: true,
        phases: { hero: 1.5 },
        cues: [
          { at: 1.5, kind: 'riser' },
          { at: 1.5, kind: 'hero' },
        ],
      }),
    ]);
    expect(at(cues)).toEqual([
      ['riser', 4.7],
      ['hero', 5.5],
    ]);
    expect(at(buildCues([scene('s', 0, 4, { cues: [{ at: 0.5, kind: 'riser' }] })]))).toEqual([]);
  });
});

describe('the timeline', () => {
  it('never depends on the music or the effects', () => {
    const scenes = StoryboardSchema.parse({
      title: 'T',
      template: 'bug-fix',
      scenes: [
        { id: 's1', beat: 'context', narration: 'Here is the cart.', visual: callout },
        {
          id: 's2',
          beat: 'proof',
          hero: true,
          narration: 'Minus stops at zero.',
          cues: [{ at: 'hero', kind: 'riser' }],
          visual: callout,
        },
        {
          id: 's3',
          beat: 'summary',
          narration: 'Ready to merge.',
          transition: 'push',
          visual: callout,
        },
      ],
    }).scenes;
    const build = (spec: VideoSpec) =>
      buildTimeline({
        title: 'T',
        scenes,
        layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
        spec,
        image: () => ({ src: 'a.png', width: 100, height: 100 }),
      });
    const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
    const loud = build(spec);
    const quiet = build({ ...spec, soundEffects: false, music: { ...spec.music, use: 'none' } });
    expect(quiet).toEqual(loud);
    const kinds = loud.cues.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['riser', 'hero', 'transition']));
    expect(kinds.filter((k) => k === 'riser')).toHaveLength(1);
  });
});
