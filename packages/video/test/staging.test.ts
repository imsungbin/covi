import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, OUTRO_ID, pacingFor } from '../src/timeline/build.ts';
import type { SceneStaging, TransitionKind } from '../src/timeline/types.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const scenes = ['s1', 's2', 's3'].map(
  (id) => ({ id, beat: id, narration: 'A short line here.', visual: callout }) as Scene,
);
const image = () => ({ src: 'a.png', width: 1, height: 1 });
const staged = (text: string, x: number): SceneStaging => ({
  stop: { x, y: 0 },
  direction: {
    whole: false,
    elements: [
      {
        id: 'note',
        kind: 'label',
        rect: { x: 0, y: 0, width: 100, height: 40 },
        text,
        tone: 'neutral',
      },
    ],
    beats: [],
  },
});

describe('a timeline with direction', () => {
  const entrances = new Map<string, TransitionKind>([
    ['s2', 'pan'],
    ['s3', 'zoom'],
  ]);
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec), entrances);
  const timeline = buildTimeline({
    title: 'T',
    scenes,
    layout,
    spec,
    image,
    entrances,
    staging: [staged('One', 0), staged('Two', 2400), staged('요청', 4800)],
  });

  it('gives each story scene its stop, shot, and entrance; the outro stays off the canvas', () => {
    const [s1, s2, s3] = timeline.scenes;
    expect(s1).toMatchObject({ stop: { x: 0, y: 0 } });
    expect(s1!.transition).toBeUndefined();
    expect(s2).toMatchObject({
      stop: { x: 2400, y: 0 },
      transition: { kind: 'pan', seconds: 0.7 },
    });
    expect(s3!.transition).toEqual({ kind: 'zoom', seconds: 0.9 });
    expect(s2!.direction!.elements[0]).toMatchObject({ kind: 'label', text: 'Two' });
    const outro = timeline.scenes.at(-1)!;
    expect(outro.id).toBe(OUTRO_ID);
    expect(outro).not.toHaveProperty('stop');
    expect(outro).not.toHaveProperty('direction');
    expect(timeline.cues.filter((c) => c.kind === 'transition').map((c) => c.detail)).toEqual([
      'pan',
      'zoom',
    ]);
  });

  it('embeds the CJK fonts a label needs, even in an English video', () => {
    expect(timeline.language).toBe('en');
    expect(timeline.fonts.cjk).toEqual(['ko']);
  });

  it('leaves a timeline without direction as it was', () => {
    const plain = buildTimeline({
      title: 'T',
      scenes,
      layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
      spec,
      image,
    });
    expect(plain.scenes.some((s) => 'stop' in s || 'direction' in s)).toBe(false);
    expect(plain.scenes[1]!.transition).toEqual({ kind: 'fade', seconds: 0.45 });
  });
});
