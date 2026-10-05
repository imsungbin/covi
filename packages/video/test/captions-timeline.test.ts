import { parseConfigInput, resolveConfig } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { buildCaptions, chunkCaption, toSrt, toVtt } from '../src/captions.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Scene, Storyboard } from '../src/storyboard/schema.ts';
import { buildTimeline, fitToDuration, layoutScenes, TRANSITION } from '../src/timeline/build.ts';

const options = { maxChars: 30, maxLines: 2, minDuration: 0.9 };

describe('captions', () => {
  it('keeps lines short, breaks at sentence ends, and balances two-line cues', () => {
    const cues = chunkCaption(
      'This change updates the comment flow to use optimistic updates. The comment now appears immediately.',
      options,
    );
    for (const cue of cues) {
      expect(cue.length).toBeLessThanOrEqual(2);
      for (const line of cue) expect(line.length).toBeLessThanOrEqual(30);
    }
    // A sentence end always closes a cue: no cue continues past a period.
    for (const cue of cues) expect(cue.join(' ')).not.toMatch(/[.!?] \S/);
    expect(cues.some((c) => /optimistic updates\.$/.test(c.join(' ')))).toBe(true);
    const twoLine = cues.find((c) => c.length === 2)!;
    expect(Math.abs(twoLine[0]!.length - twoLine[1]!.length)).toBeLessThan(14);
  });

  it('times cues within the speech window, in order, honoring a minimum duration', () => {
    const cues = buildCaptions(
      [
        {
          text: 'One. Two words here. And a much longer third sentence that takes more time to say.',
          start: 1,
          end: 7,
        },
      ],
      options,
    );
    expect(cues[0]!.start).toBe(1);
    expect(cues.at(-1)!.end).toBe(7);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeCloseTo(cues[i - 1]!.end, 3);
    for (const c of cues) expect(c.end - c.start).toBeGreaterThanOrEqual(0.89);
  });

  it('exports WebVTT and SRT', () => {
    const cues = [{ start: 0.5, end: 2.25, lines: ['Hello', 'world'] }];
    expect(toVtt(cues)).toBe('WEBVTT\n\n1\n00:00:00.500 --> 00:00:02.250\nHello\nworld\n');
    expect(toSrt(cues)).toBe('1\n00:00:00,500 --> 00:00:02,250\nHello\nworld\n');
  });
});

const scene = (
  id: string,
  kind: 'title' | 'callout' | 'summary',
  narration: string,
  extra: Partial<Scene> = {},
): Scene =>
  ({
    id,
    beat: id,
    narration,
    visual:
      kind === 'title'
        ? { kind: 'title', title: 'T', meta: [] }
        : kind === 'summary'
          ? { kind: 'summary', verdict: 'looks-good', headline: 'H', points: [] }
          : { kind: 'callout', tone: 'info', title: 'C' },
    ...extra,
  }) as Scene;

describe('timeline', () => {
  it('lays scenes out from narration length with overlapping transitions', () => {
    const scenes = [
      scene('s1', 'title', 'a'),
      scene('s2', 'callout', 'b'),
      scene('s3', 'summary', 'c'),
    ];
    const layout = layoutScenes(
      scenes,
      new Map([
        ['s1', 1],
        ['s2', 6],
        ['s3', 2],
      ]),
    );
    const [a, b, c] = layout.scenes;
    expect(a!.start).toBe(0);
    expect(b!.start).toBeCloseTo(a!.end - TRANSITION, 3);
    expect(b!.end - b!.start).toBeCloseTo(0.3 + 6 + 0.5, 3);
    expect(a!.end - a!.start).toBe(2.6);
    expect(c!.speechStart).toBeCloseTo(c!.start + 0.3, 3);
    // A 1 s hold after the last scene leaves room for the sonic logo after the last line.
    expect(layout.duration).toBeCloseTo(c!.end + 1, 3);
  });

  it('drops optional scenes, then suggests a faster tempo, to fit the maximum', () => {
    const config = resolveConfig([
      {
        name: 'explicit',
        values: parseConfigInput({ video: { mode: 'short', duration: 20 } }, 't'),
      },
    ]).config;
    const spec = resolveVideoSpec(config);
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'quick-review',
      draft: true,
      scenes: [
        scene('s1', 'title', 'a'),
        scene('s2', 'callout', 'b', { optional: true }),
        scene('s3', 'callout', 'c'),
        scene('s4', 'summary', 'd'),
      ],
    };
    const fit = fitToDuration(
      storyboard,
      new Map([
        ['s1', 3],
        ['s2', 6],
        ['s3', 18],
        ['s4', 3],
      ]),
      spec,
    );
    expect(fit.scenes.map((s) => s.id)).toEqual(['s1', 's3', 's4']);
    expect(fit.tempo).toBeGreaterThan(1);
    expect(fit.tempo).toBeLessThanOrEqual(1.15);
  });

  it('extends visual holds to reach the minimum', () => {
    const config = resolveConfig([
      { name: 'explicit', values: parseConfigInput({ video: { mode: 'standard' } }, 't') },
    ]).config;
    const spec = resolveVideoSpec(config);
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'quick-review',
      draft: true,
      scenes: [scene('s1', 'title', 'a'), scene('s2', 'callout', 'b'), scene('s3', 'summary', 'c')],
    };
    const fit = fitToDuration(
      storyboard,
      new Map([
        ['s1', 2],
        ['s2', 8],
        ['s3', 2],
      ]),
      spec,
    );
    expect(fit.extraHold.get('s2')).toBeGreaterThan(0);
    expect(fit.extraHold.has('s1')).toBe(false);
  });

  it('builds a timeline with captions, frames, and narrator placement', () => {
    const config = resolveConfig([]).config;
    const spec = resolveVideoSpec(config, { mode: 'short' });
    const scenes = [
      scene('s1', 'title', 'Hello there.'),
      scene('s2', 'callout', 'Something worth checking.'),
      scene('s3', 'summary', 'Looks good.'),
    ];
    const layout = layoutScenes(scenes, new Map());
    const timeline = buildTimeline({
      title: 'x',
      scenes,
      layout,
      spec,
      image: () => ({ src: '', width: 1, height: 1 }),
    });
    expect(timeline.frames).toBe(Math.round(layout.duration * 30));
    expect(timeline.orientation).toBe('vertical');
    expect(timeline.scenes.map((s) => s.narrator)).toEqual([false, true, false]);
    expect(timeline.captions.length).toBeGreaterThanOrEqual(3);
    expect(timeline.theme.name).toBe('light');
  });
});
