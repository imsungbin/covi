import {
  buildEvidence,
  DEFAULT_CONFIG,
  type Demonstration,
  type Hunk,
  indexEvidence,
  Redactor,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import { captionOptionsFor } from '../src/captions.ts';
import { elementSlots, shotRegion } from '../src/direction/layout.ts';
import { BEAT_SECONDS, directionImages, resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { canvasStops, HERO_DROP, STOP_GAP } from '../src/direction/stops.ts';
import { computeRegions, gridSpacing } from '../src/runtime/layout.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor, phraseMoment } from '../src/timeline/build.ts';

const W = 1920;
const H = 1080;
const grid = gridSpacing(1);

describe('stops on the canvas', () => {
  const stops = canvasStops({ count: 14, seed: 42, width: W, height: H, grid });

  it('run to the right and turn down every 2–4 stops, a quarter frame apart', () => {
    expect(stops[0]).toEqual({ x: 0, y: 0 });
    let run = 0;
    for (let i = 1; i < stops.length; i++) {
      const dx = stops[i]!.x - stops[i - 1]!.x;
      const dy = stops[i]!.y - stops[i - 1]!.y;
      if (dy === 0) {
        expect(Math.abs(dx - W * (1 + STOP_GAP))).toBeLessThanOrEqual(grid);
        run++;
      } else {
        expect(dx).toBe(0);
        expect(Math.abs(dy - (H + STOP_GAP * W))).toBeLessThanOrEqual(grid);
        expect(run).toBeGreaterThanOrEqual(2);
        expect(run).toBeLessThanOrEqual(4);
        run = 0;
      }
    }
  });

  it('sit on the stage’s dot grid, the same for the same seed and different for others', () => {
    for (const s of stops) {
      expect(Math.abs(s.x / grid - Math.round(s.x / grid))).toBeLessThan(1e-9);
      expect(Math.abs(s.y / grid - Math.round(s.y / grid))).toBeLessThan(1e-9);
    }
    expect(canvasStops({ count: 14, seed: 42, width: W, height: H, grid })).toEqual(stops);
    const paths = new Set(
      Array.from({ length: 8 }, (_, seed) =>
        JSON.stringify(canvasStops({ count: 14, seed, width: W, height: H, grid })),
      ),
    );
    expect(paths.size).toBeGreaterThan(1);
  });

  it('drop the hero’s stop off the row, so the camera pulls back to reach it', () => {
    const plain = canvasStops({ count: 6, seed: 9, width: W, height: H, grid });
    const hero = canvasStops({ count: 6, hero: 3, seed: 9, width: W, height: H, grid });
    expect(hero[3]!.x).toBe(plain[3]!.x);
    expect(Math.abs(hero[3]!.y - plain[3]!.y - HERO_DROP * H)).toBeLessThanOrEqual(grid);
    expect(hero[4]).toEqual(plain[4]);
  });
});

describe('element slots', () => {
  const region = { x: 0, y: 0, width: 1000, height: 600 };
  it('weigh a row by kind: code takes three parts to a label’s one', () => {
    const [a, b] = elementSlots(['code', 'label'], 'row', region, 'landscape', 20);
    expect(a).toEqual({ x: 0, y: 0, width: 735, height: 600 });
    expect(b).toEqual({ x: 755, y: 0, width: 245, height: 600 });
  });
  it('stack a column, split in two, and lay out a grid for four or more', () => {
    expect(elementSlots(['code', 'code'], 'column', region, 'landscape', 20)[1]).toEqual({
      x: 0,
      y: 310,
      width: 1000,
      height: 290,
    });
    const split = elementSlots(['visual', 'node', 'node'], 'split', region, 'landscape', 20);
    expect(split[0]).toEqual({ x: 0, y: 0, width: 490, height: 600 });
    expect(split[1]).toEqual({ x: 510, y: 0, width: 490, height: 290 });
    expect(split[2]).toEqual({ x: 510, y: 310, width: 490, height: 290 });
    const vertical = elementSlots(['visual', 'label'], 'split', region, 'vertical', 20);
    expect(vertical[1]).toEqual({ x: 0, y: 310, width: 1000, height: 290 });
    const four = elementSlots(['node', 'node', 'node', 'node'], 'auto', region, 'landscape', 20);
    expect(four.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [510, 0],
      [0, 310],
      [510, 310],
    ]);
    expect(elementSlots(['visual'], 'auto', region, 'landscape', 20)).toEqual([region]);
    expect(elementSlots(['code', 'label'], 'auto', region, 'landscape', 20)[0]!.width).toBe(490);
  });
  it('give the visual alone its own region: a card without a header fills the frame', () => {
    const regions = computeRegions({ width: W, height: H, orientation: 'landscape' });
    expect(shotRegion(true, { kind: 'summary' }, regions)).toEqual(regions.full);
    expect(shotRegion(true, { kind: 'title' }, regions)).toEqual(regions.full);
    expect(shotRegion(true, { kind: 'title', background: {} }, regions)).toEqual(regions.media);
    expect(shotRegion(false, { kind: 'summary' }, regions)).toEqual(regions.media);
    expect(shotRegion(true, { kind: 'code' }, regions)).toEqual(regions.media);
  });
});

// A run with one hunk (holding a secret), one demo command run before and after, and one capture.
const SECRET = 'hunter2-shh-secret';
const hunk: Hunk = {
  oldStart: 10,
  oldLines: 2,
  newStart: 10,
  newLines: 2,
  lines: [
    { kind: 'context', text: '\tconst token = load();', oldLine: 10, newLine: 10 },
    { kind: 'del', text: `send(docs, "${SECRET}");`, oldLine: 11 },
    { kind: 'add', text: 'send(ids);', newLine: 11 },
  ],
};
const files = [{ path: 'src/request.js', language: 'javascript', hunks: [hunk] }];
const demo = {
  commands: [
    {
      name: 'measure',
      command: 'node scripts/measure.js',
      before: { exitCode: 0, output: 'request bytes: 120000' },
      after: { exitCode: 0, output: 'request bytes: 9000' },
      changed: true,
    },
  ],
  shots: [
    { id: 'home', kind: 'page', name: '/', viewport: 'desktop', after: { path: 'demo/home.png' } },
  ],
} as unknown as Pick<Demonstration, 'commands' | 'shots'>;
const evidence = indexEvidence(
  buildEvidence({
    diff: files,
    demo: { ...demo, requests: [], skipped: [], findings: [] } as unknown as Demonstration,
    fileSha: () => '0'.repeat(64),
  }),
);
const sources = directionSources({ files, demo, evidence });
const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const scene = (id: string, narration: string, visual: unknown, extra = {}): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual, ...extra });
const scenes = [
  scene('s1', 'The request carried every document.', { kind: 'callout', title: 'Before' }),
  scene('s2', 'Now it sends [[only the ids]], and the reader fetches each one.', {
    kind: 'callout',
    title: 'After',
  }),
  scene('s3', 'That is the change.', { kind: 'summary', verdict: 'looks-good', headline: 'H' }),
];
const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
const redactor = new Redactor({ literals: [SECRET] });
const resolve = (direction: DirectionInput) =>
  resolveDirection({
    plan: DirectionSchema.parse(direction),
    scenes,
    layout,
    spec,
    language: 'en',
    sources,
    image: (path) => ({ src: `assets/${path}`, width: 800, height: 600 }),
    seed: 5,
    redact: (value) => redactor.redactDeep(value),
  });

describe('resolving a direction', () => {
  const staging = resolve({
    shots: [
      {
        scene: 's2',
        layout: 'row',
        elements: [
          { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:10', side: 'diff' },
          { id: 'out', kind: 'output', evidence: 'terminal:1', side: 'base' },
          { id: 'page', kind: 'capture', evidence: 'screenshot:home' },
          { id: 'reader', kind: 'node', label: 'Reader' },
          { id: 'note', kind: 'label', text: 'Much smaller', tone: 'success' },
        ],
        beats: [
          { verb: 'place', element: 'req' },
          { verb: 'camera', move: 'zoom', to: 'req', zoom: 1.5 },
          { verb: 'reveal', element: 'note', style: 'pop', at: 'only the ids' },
          { verb: 'reveal', element: 'reader', at: 'a phrase redaction removed' },
        ],
      },
    ],
  });
  const [s1, s2, s3] = staging;

  it('gives every story scene a stop, and the scenes without a shot their visual alone', () => {
    expect(staging).toHaveLength(3);
    expect(s1!.stop).toEqual({ x: 0, y: 0 });
    expect(s2!.stop.x).toBeGreaterThan(0);
    expect(s1!.direction).toEqual({
      whole: true,
      elements: [
        {
          id: 'visual',
          kind: 'visual',
          rect: computeRegions({ ...spec, orientation: 'landscape' }).media,
        },
      ],
      beats: [],
    });
    expect(s3!.direction.elements[0]!.rect).toEqual(
      computeRegions({ ...spec, orientation: 'landscape' }).full,
    );
  });

  it('takes each element’s content from the evidence it cites', () => {
    const [req, out, page, reader, note] = s2!.direction.elements;
    expect(s2!.direction.whole).toBe(false);
    expect(req).toMatchObject({
      kind: 'code',
      visual: {
        kind: 'code',
        path: 'src/request.js',
        language: 'javascript',
        highlight: [],
        lines: [
          { type: 'context', text: '  const token = load();', number: 10 },
          { type: 'del', number: 11 },
          { type: 'add', text: 'send(ids);', number: 11 },
        ],
      },
    });
    expect(out).toMatchObject({
      kind: 'output',
      visual: {
        kind: 'terminal',
        title: 'measure',
        command: 'node scripts/measure.js',
        output: 'request bytes: 120000',
      },
    });
    expect(page).toMatchObject({
      kind: 'capture',
      visual: { kind: 'screenshot', image: { src: 'assets/demo/home.png' }, device: 'desktop' },
    });
    expect(reader).toMatchObject({ kind: 'node', label: 'Reader' });
    expect(note).toMatchObject({ kind: 'label', text: 'Much smaller', tone: 'success' });
    // Slots fill the media region in a row, left to right.
    const xs = s2!.direction.elements.map((e) => e.rect.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('redacts everything it resolves', () => {
    expect(JSON.stringify(staging)).not.toContain(SECRET);
    expect(JSON.stringify(staging)).toContain('[REDACTED]');
  });

  it('times beats on their phrases, spreads the rest through the line, and drops place', () => {
    const timing = layout.scenes[1]!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const text = 'Now it sends only the ids, and the reader fetches each one.';
    const beats = s2!.direction.beats;
    expect(beats.map((b) => b.verb)).toEqual(['camera', 'reveal', 'reveal']);
    const pop = beats.find((b) => b.verb === 'reveal' && b.element === 'note')!;
    expect(pop).toMatchObject({ style: 'pop', seconds: BEAT_SECONDS.reveal });
    expect(pop.t).toBe(phraseMoment(text, 'only the ids', timing, options));
    // Unpinned (or pinned to a phrase the line lost) beats take evenly spaced slots from 0.15.
    const speech = timing.speechEnd - timing.speechStart;
    const lead = timing.speechStart - timing.start;
    const camera = beats.find((b) => b.verb === 'camera')!;
    expect(camera).toMatchObject({
      move: 'zoom',
      to: 'req',
      zoom: 1.5,
      seconds: BEAT_SECONDS.camera,
    });
    expect(camera.t).toBeCloseTo(lead + speech * 0.15, 3);
    const lost = beats.find((b) => b.verb === 'reveal' && b.element === 'reader')!;
    expect(lost.t).toBeCloseTo(lead + speech * (0.15 + (0.85 * 2) / 3), 3);
    expect(lost).toMatchObject({ style: 'rise' });
    // In time order.
    expect(beats.map((b) => b.t)).toEqual([...beats.map((b) => b.t)].sort((a, b) => a - b));
  });

  it('lists the run images a shot shows, for the composition', () => {
    expect(
      directionImages(
        DirectionSchema.parse({
          shots: [
            { scene: 's2', elements: [{ id: 'p', kind: 'capture', evidence: 'screenshot:home' }] },
          ],
        }),
        sources,
      ),
    ).toEqual(['demo/home.png']);
  });

  it('keeps at most 14 lines of a long hunk, around its changes', () => {
    const long: Hunk = {
      oldStart: 1,
      oldLines: 30,
      newStart: 1,
      newLines: 31,
      lines: [
        ...Array.from({ length: 20 }, (_, i) => ({
          kind: 'context' as const,
          text: `c${i}`,
          oldLine: i + 1,
          newLine: i + 1,
        })),
        { kind: 'add' as const, text: 'added();', newLine: 21 },
        ...Array.from({ length: 10 }, (_, i) => ({
          kind: 'context' as const,
          text: `d${i}`,
          oldLine: 21 + i,
          newLine: 22 + i,
        })),
      ],
    };
    const longFiles = [{ path: 'a.js', hunks: [long] }];
    const longEvidence = indexEvidence(buildEvidence({ diff: longFiles }));
    const [only] = resolveDirection({
      plan: DirectionSchema.parse({
        shots: [
          { scene: 's1', elements: [{ id: 'c', kind: 'code', evidence: 'diff-hunk:a.js:1' }] },
        ],
      }),
      scenes: [scenes[0]!],
      layout: { ...layout, scenes: [layout.scenes[0]!] },
      spec,
      language: 'en',
      sources: directionSources({ files: longFiles, evidence: longEvidence }),
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (v) => v,
    });
    const code = only!.direction.elements[0]!;
    if (code.kind !== 'code') throw new Error('expected code');
    expect(code.visual.lines).toHaveLength(14);
    expect(code.visual.lines.some((l) => l.text === 'added();')).toBe(true);
  });

  // One scene, resolved alone against its own run.
  const alone = (
    only: Scene,
    shot: DirectionInput['shots'][number],
    run: Parameters<typeof directionSources>[0],
  ) =>
    resolveDirection({
      plan: DirectionSchema.parse({ shots: [shot] }),
      scenes: [only],
      layout: layoutScenes([only], new Map(), new Map(), 'en', pacingFor(spec)),
      spec,
      language: 'en',
      sources: directionSources(run),
      image: (path) => ({ src: `assets/${path}`, width: 800, height: 600 }),
      seed: 5,
      redact: (value) => redactor.redactDeep(value),
    })[0]!;

  it('redacts code and output before cutting them, so a cut never splits a secret', () => {
    const pad = 'x'.repeat(90);
    const secretHunk: Hunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      lines: [{ kind: 'add', text: `${pad}${SECRET}`, newLine: 1 }],
    };
    const secretFiles = [{ path: 'k.js', hunks: [secretHunk] }];
    // Output lines are cut at 90 characters: this one would keep the secret's first letters.
    const output = `${'y'.repeat(85)}${SECRET}`;
    const secretDemo = {
      commands: [
        {
          name: 'leak',
          command: 'node leak.js',
          after: { exitCode: 0, output },
          changed: true,
        },
      ],
      shots: [],
    } as unknown as Pick<Demonstration, 'commands' | 'shots'>;
    const run = {
      files: secretFiles,
      demo: secretDemo,
      evidence: indexEvidence(
        buildEvidence({
          diff: secretFiles,
          demo: {
            ...secretDemo,
            requests: [],
            skipped: [],
            findings: [],
          } as unknown as Demonstration,
        }),
      ),
    };
    const staged = alone(
      scene('k', 'The key leaks.', { kind: 'callout', title: 'Leak' }),
      {
        scene: 'k',
        elements: [
          { id: 'c', kind: 'code', evidence: 'diff-hunk:k.js:1' },
          { id: 'o', kind: 'output', evidence: 'terminal:1' },
        ],
      },
      run,
    );
    const [code, out] = staged.direction.elements;
    expect(code).toMatchObject({ kind: 'code', visual: { lines: [{ text: `${pad}[REDAC` }] } });
    expect(out).toMatchObject({ kind: 'output', visual: { output: `${'y'.repeat(85)}[REDA` } });
    expect(JSON.stringify(staged)).not.toContain(SECRET.slice(0, 5));
  });

  it('keeps the visual when nothing a shot cites can be shown, and drops the beats on what is gone', () => {
    // An id is a plain string: one named like an object's built-ins is looked up like any other.
    const staged = alone(
      scene('constructor', 'Nothing to show here.', { kind: 'callout', title: 'Gone' }),
      {
        scene: 'constructor',
        // Named like the visual that takes its place: its beats still have nothing to move.
        elements: [{ id: 'visual', kind: 'output', evidence: 'screenshot:home' }],
        beats: [
          { verb: 'reveal', element: 'visual' },
          { verb: 'camera', move: 'zoom', to: 'visual' },
        ],
      },
      { files, demo, evidence },
    );
    expect(staged.direction).toEqual({
      whole: true,
      elements: [
        {
          id: 'visual',
          kind: 'visual',
          rect: computeRegions({ ...spec, orientation: 'landscape' }).media,
        },
      ],
      beats: [],
    });
    const unshot = resolveDirection({
      plan: { shots: [] },
      scenes: [scene('constructor', 'Plain.', { kind: 'callout', title: 'Plain' })],
      layout: { ...layout, scenes: [layout.scenes[0]!] },
      spec,
      language: 'en',
      sources,
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (v) => v,
    })[0]!;
    expect(unshot.direction.whole).toBe(true);
    expect(unshot.direction.elements.map((e) => e.kind)).toEqual(['visual']);
  });

  it('drops the hero’s stop and spreads beats over a scene without a line', () => {
    const quiet = scene('q', '', { kind: 'callout', title: 'Quiet' }, { hero: true });
    const loud = scene('l', 'Then the change lands.', { kind: 'callout', title: 'Loud' });
    const both = [loud, quiet, loud].map((s, i) => ({ ...s, id: `${s.id}${i}` }));
    const timed = layoutScenes(both, new Map(), new Map(), 'en', pacingFor(spec));
    const staged = resolveDirection({
      plan: DirectionSchema.parse({
        shots: [
          {
            scene: 'q1',
            elements: [{ id: 'n', kind: 'node', label: 'Reader' }],
            beats: [{ verb: 'reveal', element: 'n' }],
          },
        ],
      }),
      scenes: both,
      layout: timed,
      spec,
      language: 'en',
      sources,
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (v) => v,
    });
    const plain = canvasStops({ count: 3, seed: 5, width: W, height: H, grid });
    expect(staged.map((s) => s.stop)).toEqual(
      canvasStops({ count: 3, hero: 1, seed: 5, width: W, height: H, grid }),
    );
    expect(staged[1]!.stop.y).toBeGreaterThan(plain[1]!.y);
    const q = timed.scenes[1]!;
    expect(q.speechEnd).toBe(q.speechStart);
    expect(staged[1]!.direction.beats[0]!.t).toBeCloseTo((q.end - q.start) * 0.15, 3);
  });
});
