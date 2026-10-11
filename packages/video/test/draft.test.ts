import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav } from '@covi/audio';
import { resolveConfig, seedFrom } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { AssetCollector } from '../src/composition/build.ts';
import { defaultDirection, entrances, mergeDirection } from '../src/direction/director.ts';
import { resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { DRAFT_FPS, draftSpec } from '../src/draft.ts';
import { masterVoice, SAMPLE_RATE } from '../src/sound.ts';
import { orientationOf, resolveVideoSpec, type VideoSpec } from '../src/spec.ts';
import { type StoryboardInput, StoryboardSchema } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, pacingFor } from '../src/timeline/build.ts';
import type { Rect, Timeline } from '../src/timeline/types.ts';

const spec = (width: number, height: number, fps = 30): VideoSpec => ({
  ...resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width, height }),
  fps,
});

describe('the draft spec', () => {
  it('halves the size on even pixels and draws at 15 fps, and changes nothing else', () => {
    const full = spec(1920, 1080);
    expect(draftSpec(full)).toEqual({ ...full, width: 960, height: 540, fps: DRAFT_FPS });
    expect(draftSpec(spec(1080, 1920))).toMatchObject({ width: 540, height: 960 });
    expect(draftSpec(spec(1366, 768))).toMatchObject({ width: 682, height: 384 });
    // A video already slower than the draft keeps its own frame rate.
    expect(draftSpec(spec(1280, 720, 12)).fps).toBe(12);
  });
});

const title = 'Send only the ids';
const scenes: StoryboardInput['scenes'] = [
  {
    id: 's1',
    beat: 'problem',
    narration: 'The request carried every document, so the reader timed out.',
    visual: { kind: 'callout', tone: 'warning', title: 'Timed out' },
  },
  {
    id: 's2',
    beat: 'fix',
    eyebrow: 'The fix',
    narration: 'Now it sends only the ids, and the reader fetches each one.',
    hero: true,
    visual: {
      kind: 'code',
      path: 'src/request.js',
      lines: [
        { type: 'del', text: 'return send(docs);' },
        { type: 'add', text: 'return send(docs.map((d) => d.id));' },
      ],
      highlight: [1],
    },
  },
  {
    id: 's3',
    beat: 'summary',
    narration: 'Ready to merge.',
    visual: { kind: 'summary', verdict: 'looks-good', headline: 'Ids only', points: [] },
  },
];
const shots: DirectionInput['shots'] = [
  {
    scene: 's1',
    enter: 'cut',
    layout: 'row',
    elements: [
      { id: 'req', kind: 'node', label: 'Request' },
      { id: 'reader', kind: 'node', label: 'Reader' },
      { id: 'late', kind: 'label', text: 'Timed out', tone: 'warning' },
    ],
    beats: [
      { verb: 'reveal', element: 'reader', style: 'pop' },
      { verb: 'reveal', element: 'late', style: 'type', at: 'timed out' },
      { verb: 'camera', move: 'zoom', to: 'late' },
    ],
  },
];

/** The timeline the pipeline builds for one direction at one size, without narration. */
function build(at: VideoSpec): Timeline {
  const parsed = StoryboardSchema.parse({ title, template: 'bug-fix', scenes }).scenes;
  const seed = seedFrom(title);
  const plan = mergeDirection(
    DirectionSchema.parse({ shots }),
    defaultDirection({ scenes: parsed, seed, orientation: orientationOf(at.width, at.height) }),
  );
  const enter = entrances(plan, parsed, undefined, seed);
  const layout = layoutScenes(parsed, new Map(), new Map(), 'en', pacingFor(at), enter);
  const assets = new AssetCollector('/nonexistent');
  const staging = resolveDirection({
    plan,
    scenes: parsed,
    layout,
    spec: at,
    language: 'en',
    sources: directionSources({}),
    image: assets.image,
    seed,
    redact: (value) => value,
  });
  return buildTimeline({
    title,
    scenes: parsed,
    layout,
    spec: at,
    image: assets.image,
    entrances: enter,
    staging,
  });
}

/** Everything a viewer sees happen, and when. */
function choreography(t: Timeline) {
  return {
    duration: t.duration,
    captions: t.captions,
    cues: t.cues,
    scenes: t.scenes.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      transition: s.transition,
      phases: s.phases,
      beats: s.direction?.beats,
      // The resolver leaves a beat out by the room its slot has; the reasons hold no pixels, so a
      // draft whose left-out beats differed from the video's would mislead.
      dropped: s.direction?.dropped,
      elements: s.direction?.elements.map((e) => [e.id, e.kind]),
    })),
  };
}

/** Every stop and slot, in the pixels of a frame `scale` times as large. */
const positions = (t: Timeline, scale: number) =>
  t.scenes
    .flatMap((s) => [
      ...(s.stop ? [s.stop.x, s.stop.y] : []),
      ...(s.direction?.elements ?? []).flatMap((e: { rect: Rect }) => [
        e.rect.x,
        e.rect.y,
        e.rect.width,
        e.rect.height,
      ]),
    ])
    .map((v) => v * scale);

describe('a draft', () => {
  for (const [width, height] of [
    [1920, 1080],
    [1080, 1920],
    [1366, 768],
  ] as const)
    it(`is the same video, scaled: the same moments, every position at half (${width}×${height})`, () => {
      const full = build(spec(width, height));
      const draft = build(draftSpec(spec(width, height)));
      expect(draft).toMatchObject({ orientation: full.orientation, fps: 15 });
      expect(draft.frames).toBe(Math.round(full.duration * 15));
      expect(choreography(draft)).toEqual(choreography(full));
      // An odd half (683) rounds down to even pixels, and positions follow the frame it draws.
      if (width % 4 || height % 4) return;
      const [big, small] = [positions(full, 1), positions(draft, 2)];
      expect(small).toHaveLength(big.length);
      for (const [i, v] of small.entries()) expect(v).toBeCloseTo(big[i]!, 1);
    });
});

describe('a draft’s sound', () => {
  it('masters the voice alone, and nothing without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-draft-'));
    try {
      const path = join(dir, 'master.wav');
      const silent = { speech: [], duration: 2, placement: 'continuous' as const };
      expect(masterVoice(silent, path)).toBeUndefined();
      expect(existsSync(path)).toBe(false);
      const voice = Float32Array.from({ length: 2 * SAMPLE_RATE }, (_, i) =>
        i < SAMPLE_RATE ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) : 0,
      );
      const speech: Array<[number, number]> = [[0, 1]];
      expect(masterVoice({ ...silent, voice, speech }, path)).toBe(path);
      const wav = readWav(path);
      expect(wav.sampleRate).toBe(SAMPLE_RATE);
      expect(wav.channels).toHaveLength(2);
      expect(wav.channels[0]!.length).toBe(2 * SAMPLE_RATE);
      // The voice is heard where it speaks, on both sides, and nothing plays where it is silent.
      const rms = (c: Float32Array, from: number, to: number) => {
        const [a, b] = [Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE)];
        let sum = 0;
        for (let i = a; i < b; i++) sum += c[i]! ** 2;
        return Math.sqrt(sum / (b - a));
      };
      for (const channel of wav.channels) {
        expect(rms(channel, 0.1, 0.9)).toBeGreaterThan(0.05);
        expect(rms(channel, 1.1, 2)).toBeLessThan(1e-4);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
