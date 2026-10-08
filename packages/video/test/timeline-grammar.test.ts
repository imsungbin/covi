import { motion } from '@covi/brand';
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { storyboardImages } from '../src/pipeline.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, TRANSITION_KINDS } from '../src/storyboard/schema.ts';
import {
  buildTimeline,
  layoutScenes,
  OUTRO_ID,
  pacingFor,
  sceneTransition,
} from '../src/timeline/build.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const shot = {
  kind: 'screenshot',
  image: { path: 'demo/a.png' },
  focus: { x: 0, y: 0, width: 10, height: 10 },
  click: { x: 5, y: 5 },
  device: 'desktop',
} as const;
const scene = (id: string, narration: string, extra: Record<string, unknown> = {}): Scene =>
  ({ id, beat: id, narration, visual: callout, ...extra }) as Scene;

function build(scenes: Scene[]) {
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  return buildTimeline({
    title: 'T',
    scenes,
    layout,
    spec,
    image: () => ({ src: 'a.png', width: 100, height: 100 }),
  });
}

describe('transitions in the timeline', () => {
  it('fade by default, zoom through into the hero, and take their length from the brand', () => {
    expect(sceneTransition({})).toEqual({ kind: 'fade', seconds: 0.45 });
    expect(sceneTransition({ hero: true })).toEqual({ kind: 'zoom-through', seconds: 0.6 });
    expect(sceneTransition({ hero: true, transition: 'cut' })).toEqual({ kind: 'cut', seconds: 0 });
    for (const kind of TRANSITION_KINDS)
      expect(sceneTransition({ transition: kind }).seconds).toBe(motion.transitions[kind]);
    expect(Object.keys(motion.transitions).sort()).toEqual([...TRANSITION_KINDS].sort());
  });

  it('give every scene but the first its transition, and the outro its fade', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'Two.', { transition: 'push' }),
      scene('s3', 'Three.'),
    ]);
    expect(timeline.scenes.at(-1)!.id).toBe(OUTRO_ID);
    expect(timeline.scenes.map((s) => s.transition)).toEqual([
      undefined,
      { kind: 'push', seconds: 0.5 },
      { kind: 'fade', seconds: 0.45 },
      { kind: 'fade', seconds: 0.45 },
    ]);
  });
});

describe('phases', () => {
  it('pin each sync phrase to when it is spoken, in seconds since the scene started', () => {
    const timeline = build([
      scene('s1', 'Here is the composer.'),
      scene('s2', 'Open the composer, type a comment, then press Post.', {
        visual: shot,
        sync: { zoom: 'type a comment', click: 'press Post' },
      }),
      scene('s3', 'Done.'),
    ]);
    const s2 = timeline.scenes[1]!;
    const speech = { start: s2.speech!.start - s2.start, end: s2.speech!.end - s2.start };
    const { zoom, click } = s2.phases!;
    expect(zoom).toBeGreaterThan(speech.start);
    expect(click).toBeGreaterThan(zoom!);
    expect(click).toBeLessThan(speech.end);
    expect(timeline.scenes[0]).not.toHaveProperty('phases');
  });

  it('put the hero phase on its sync phrase, else on the start of its line', () => {
    const hero = (extra: Record<string, unknown>) =>
      build([
        scene('s1', 'One.'),
        scene('s2', 'The counter turns amber.', extra),
        scene('s3', 'Done.'),
      ]).scenes[1]!;
    const cut = hero({ hero: true, transition: 'cut' });
    expect(cut.hero).toBe(true);
    expect(cut.phases).toEqual({ hero: Number((cut.speech!.start - cut.start).toFixed(3)) });
    const synced = hero({ hero: true, sync: { hero: 'turns amber' } });
    // A sync phrase puts the hero phase where the phrase is spoken in its caption window.
    expect(synced.phases).toEqual({ hero: 1.241 });
  });

  it('never put the default hero phase before the hero has zoomed through', () => {
    const hero = build([
      scene('s1', 'One.'),
      scene('s2', 'The counter turns amber.', { hero: true }),
      scene('s3', 'Done.'),
    ]).scenes[1]!;
    // Its line starts 60% into the zoom-through; the accent waits for the zoom to finish.
    expect(hero.transition).toEqual({ kind: 'zoom-through', seconds: 0.6 });
    expect(hero.speech!.start - hero.start).toBeLessThan(0.6);
    expect(hero.phases).toEqual({ hero: 0.6 });
  });

  it('skip a phrase that redaction removed instead of failing', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'The key [REDACTED] leaked.', { sync: { highlight: 'sk-live-123' } }),
      scene('s3', 'Done.'),
    ]);
    expect(timeline.scenes[1]).not.toHaveProperty('phases');
  });

  it('skip a phrase that redaction made ambiguous instead of guessing', () => {
    // Redaction rewrites the sync phrase too, so a phrase that quoted one secret can match two.
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'Paste [REDACTED], then [REDACTED].', {
        visual: shot,
        sync: { click: '[REDACTED]' },
      }),
      scene('s3', 'Done.'),
    ]);
    expect(timeline.scenes[1]).not.toHaveProperty('phases');
  });

  it('time a phrase in the line the captions show, even when the voice reads another form', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'Open the composer, type a comment, then press Post.', {
        visual: shot,
        say: 'Open it and post.',
        sync: { zoom: 'type a comment' },
      }),
      scene('s3', 'Done.'),
    ]);
    const s2 = timeline.scenes[1]!;
    const at = s2.start + s2.phases!.zoom!;
    const cue = timeline.captions.find((c) => c.start <= at && at < c.end);
    expect(cue?.lines.join(' ')).toMatch(/\btype\b/);
  });
});

describe('the line, the hero, and the camera', () => {
  it('speak and caption the line without markup', () => {
    const timeline = build([scene('s1', 'It counts [[down to zero]].'), scene('s2', 'Done.')]);
    expect(timeline.scenes[0]!.speech!.text).toBe('It counts down to zero.');
    expect(timeline.captions.flatMap((c) => c.lines).join(' ')).not.toMatch(/\[\[|\]\]/);
  });

  it('carry the hero and a static camera, and add nothing to a storyboard that uses neither', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'Two.', { hero: true, camera: 'static' }),
      scene('s3', 'Three.', { camera: 'drift' }),
    ]);
    expect(timeline.scenes[1]).toMatchObject({ hero: true, camera: 'static' });
    expect(timeline.scenes[2]).not.toHaveProperty('camera');
    for (const s of build([scene('s1', 'One.'), scene('s2', 'Two.')]).scenes) {
      expect(s).not.toHaveProperty('phases');
      expect(s).not.toHaveProperty('hero');
      expect(s).not.toHaveProperty('camera');
    }
  });

  it('set a title over a capture, and list the capture among the images to prepare', () => {
    const title = {
      kind: 'title',
      title: 'T',
      meta: [],
      background: { path: 'demo/a.png', label: '/' },
    } as const;
    const scenes = [scene('s1', 'One.', { visual: title }), scene('s2', 'Two.', { visual: shot })];
    expect(build(scenes).scenes[0]!.visual).toEqual({
      kind: 'title',
      title: 'T',
      meta: [],
      background: { src: 'a.png', width: 100, height: 100, label: '/' },
    });
    expect(storyboardImages({ scenes })).toEqual(['demo/a.png', 'demo/a.png']);
  });
});
