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
import {
  BEAT_SECONDS,
  CODE_LINES,
  directionImages,
  resolveDirection,
  shownShot,
} from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { canvasStops, HERO_DROP, STOP_GAP } from '../src/direction/stops.ts';
import { sceneEvidence } from '../src/grounding.ts';
import { computeRegions, gridSpacing } from '../src/runtime/layout.ts';
import { orientationOf, resolveVideoSpec } from '../src/spec.ts';
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

  it('never let two stops’ frames overlap, the hero’s included, on any frame', () => {
    const overlaps: string[] = [];
    let bounded = 0;
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const unit = computeRegions({
        width,
        height,
        orientation: orientationOf(width, height),
      }).unit;
      const g = gridSpacing(unit);
      for (let seed = 0; seed < 24; seed++) {
        const plain = canvasStops({ count: 9, seed, width, height, grid: g });
        for (let hero = 0; hero < 9; hero++) {
          const path = canvasStops({ count: 9, hero, seed, width, height, grid: g });
          path.forEach((p, a) => {
            // Only the hero moves.
            if (a !== hero) expect(p).toEqual(plain[a]);
            path.slice(a + 1).forEach((q, k) => {
              const apart =
                p.x + width <= q.x ||
                q.x + width <= p.x ||
                p.y + height <= q.y ||
                q.y + height <= p.y;
              if (!apart)
                overlaps.push(`${width}x${height} seed ${seed} hero ${hero}: ${a}/${a + 1 + k}`);
            });
          });
          const drop = path[hero]!.y - plain[hero]!.y;
          expect(drop).toBeGreaterThan(0);
          expect(drop).toBeLessThanOrEqual(HERO_DROP * height + g);
          if (drop < HERO_DROP * height - g) bounded++;
        }
      }
    }
    expect(overlaps).toEqual([]);
    // The bound is exercised: some heroes end a row, with the path turning down right under them.
    expect(bounded).toBeGreaterThan(0);
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
  it('give one element the whole region, whatever the layout', () => {
    for (const layout of ['auto', 'single', 'row', 'column', 'split'] as const)
      expect(elementSlots(['visual'], layout, region, 'landscape', 20)).toEqual([region]);
    expect(elementSlots(['code'], 'split', region, 'vertical', 20)).toEqual([region]);
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
  const directed: DirectionInput = {
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
  };
  const staging = resolve(directed);
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

  it('aims the camera at a revealed element only once it is in place', () => {
    const [, shot] = resolve({
      shots: [
        {
          scene: 's2',
          layout: 'row',
          elements: [
            { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:10', side: 'diff' },
            { id: 'note', kind: 'label', text: 'Much smaller' },
          ],
          beats: [
            { verb: 'camera', move: 'zoom', to: 'note', at: 'only the ids' },
            { verb: 'reveal', element: 'note', style: 'pop', at: 'only the ids' },
            { verb: 'camera', move: 'pan', to: 'req', at: 'only the ids' },
          ],
        },
      ],
    });
    const beats = shot!.direction.beats;
    const reveal = beats.find((b) => b.verb === 'reveal')!;
    const onNote = beats.find((b) => b.verb === 'camera' && b.to === 'note')!;
    const onReq = beats.find((b) => b.verb === 'camera' && b.to === 'req')!;
    expect(onNote.t).toBeCloseTo(reveal.t + reveal.seconds, 3);
    expect(onNote.seconds).toBe(BEAT_SECONDS.camera);
    // An element that is there from the start is aimed at on its phrase.
    expect(onReq.t).toBe(reveal.t);
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
    options: { spec?: typeof spec; redactor?: Redactor } = {},
  ) => {
    const frame = options.spec ?? spec;
    const redaction = options.redactor ?? redactor;
    return resolveDirection({
      plan: DirectionSchema.parse({ shots: [shot] }),
      scenes: [only],
      layout: layoutScenes([only], new Map(), new Map(), 'en', pacingFor(frame)),
      spec: frame,
      language: 'en',
      sources: directionSources(run),
      image: (path) => ({ src: `assets/${path}`, width: 800, height: 600 }),
      seed: 5,
      redact: (value) => redaction.redactDeep(value),
    })[0]!;
  };

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
    const plain = scene('constructor', 'Plain.', { kind: 'callout', title: 'Plain' });
    const unshot = resolveDirection({
      plan: { shots: [] },
      scenes: [plain],
      layout: layoutScenes([plain], new Map(), new Map(), 'en', pacingFor(spec)),
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

  // A later hunk of a file: its old and new line numbers differ.
  const later: Hunk = {
    oldStart: 20,
    oldLines: 3,
    newStart: 25,
    newLines: 3,
    lines: [
      { kind: 'context', text: 'a();', oldLine: 20, newLine: 25 },
      { kind: 'del', text: 'b();', oldLine: 21 },
      { kind: 'add', text: 'c();', newLine: 26 },
      { kind: 'context', text: 'd();', oldLine: 22, newLine: 27 },
    ],
  };
  const laterFiles = [{ path: 'src/later.js', hunks: [later] }];
  const laterRun = {
    files: laterFiles,
    evidence: indexEvidence(buildEvidence({ diff: laterFiles })),
  };
  const codeOf = (element: Record<string, unknown>, options = {}) => {
    const only = scene('n', 'The numbers.', { kind: 'callout', title: 'Numbers' });
    const shot = { scene: 'n', elements: [{ id: 'c', kind: 'code', ...element }] };
    const [code] = alone(only, shot as DirectionInput['shots'][number], laterRun, options).direction
      .elements;
    if (code?.kind !== 'code') throw new Error('expected code');
    return code.visual.lines;
  };

  it('numbers code lines as the side shows the file: base by the old file, head by the new', () => {
    const numbers = (side: 'base' | 'head' | 'diff') =>
      codeOf({ evidence: 'diff-hunk:src/later.js:25', side }).map((l) => [l.type, l.number]);
    expect(numbers('base')).toEqual([
      ['context', 20],
      ['del', 21],
      ['context', 22],
    ]);
    expect(numbers('head')).toEqual([
      ['context', 25],
      ['add', 26],
      ['context', 27],
    ]);
    expect(numbers('diff')).toEqual([
      ['context', 25],
      ['del', 21],
      ['add', 26],
      ['context', 27],
    ]);
  });

  it('shows the lines a code element asks for, 1-based and inclusive within its side', () => {
    expect(codeOf({ evidence: 'diff-hunk:src/later.js:25', side: 'base', lines: [2, 3] })).toEqual([
      { type: 'del', text: 'b();', number: 21 },
      { type: 'context', text: 'd();', number: 22 },
    ]);
    // Asked for, a long window is shown whole: only the default window is cut to fit.
    const many: Hunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 30,
      lines: Array.from({ length: 30 }, (_, i) => ({
        kind: 'add' as const,
        text: `l${i}();`,
        newLine: i + 1,
      })),
    };
    const manyFiles = [{ path: 'm.js', hunks: [many] }];
    const run = { files: manyFiles, evidence: indexEvidence(buildEvidence({ diff: manyFiles })) };
    const only = scene('m', 'Many lines.', { kind: 'callout', title: 'Many' });
    const [code] = alone(
      only,
      {
        scene: 'm',
        elements: [{ id: 'c', kind: 'code', evidence: 'diff-hunk:m.js:1', lines: [3, 22] }],
      },
      run,
    ).direction.elements;
    if (code?.kind !== 'code') throw new Error('expected code');
    expect(code.visual.lines.map((l) => l.number)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 3),
    );
  });

  it('fits tall frames: 18 code lines, 8 output lines, and three elements in a column', () => {
    const tall = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
    expect(orientationOf(tall.width, tall.height)).toBe('vertical');
    const long: Hunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 40,
      lines: Array.from({ length: 40 }, (_, i) => ({
        kind: 'add' as const,
        text: `t${i}();`,
        newLine: i + 1,
      })),
    };
    const tallFiles = [{ path: 't.js', hunks: [long] }];
    const output = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const tallDemo = {
      commands: [
        { name: 'many', command: 'node many.js', after: { exitCode: 0, output }, changed: true },
      ],
      shots: [],
    } as unknown as Pick<Demonstration, 'commands' | 'shots'>;
    const run = {
      files: tallFiles,
      demo: tallDemo,
      evidence: indexEvidence(
        buildEvidence({
          diff: tallFiles,
          demo: {
            ...tallDemo,
            requests: [],
            skipped: [],
            findings: [],
          } as unknown as Demonstration,
        }),
      ),
    };
    const staged = alone(
      scene('t', 'A tall frame.', { kind: 'callout', title: 'Tall' }),
      {
        scene: 't',
        elements: [
          { id: 'c', kind: 'code', evidence: 'diff-hunk:t.js:1' },
          { id: 'o', kind: 'output', evidence: 'terminal:1' },
          { id: 'l', kind: 'label', text: 'Tall' },
        ],
      },
      run,
      { spec: tall },
    );
    const [code, out, label] = staged.direction.elements;
    if (code?.kind !== 'code' || out?.kind !== 'output')
      throw new Error('expected code and output');
    expect(code.visual.lines).toHaveLength(CODE_LINES.vertical);
    const shown = out.visual.output.split('\n');
    expect(shown).toHaveLength(8);
    expect(shown.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => `line ${i}`));
    // `auto` with three on a tall frame: one column, top to bottom.
    const media = computeRegions({ ...tall, orientation: 'vertical' }).media;
    expect([code, out, label].map((e) => e!.rect.x)).toEqual([media.x, media.x, media.x]);
    expect(code.rect.y).toBeLessThan(out.rect.y);
    expect(out.rect.y).toBeLessThan(label!.rect.y);
  });

  it('redacts what an agent writes, too: node names and labels', () => {
    const word = 'Classified';
    const staged = alone(
      scene('w', 'The words.', { kind: 'callout', title: 'Words' }),
      {
        scene: 'w',
        elements: [
          { id: 'n', kind: 'node', label: word },
          { id: 'l', kind: 'label', text: `${word} notes` },
        ],
      },
      { files, demo, evidence },
      { redactor: new Redactor({ literals: [word] }) },
    );
    expect(JSON.stringify(staged)).not.toContain(word);
    expect(staged.direction.elements).toMatchObject([
      { kind: 'node', label: '[REDACTED]' },
      { kind: 'label', text: '[REDACTED] notes' },
    ]);
  });

  it('grounds a scene in what resolved: dropped elements cite nothing, a fallback its visual', () => {
    const capture = scene('g', 'The page.', {
      kind: 'screenshot',
      image: { path: 'demo/home.png' },
    });
    const run = { files, demo, evidence };
    const shotOf = (elements: unknown[]) =>
      DirectionSchema.parse({ shots: [{ scene: 'g', elements }] }).shots[0]!;
    // The output cites a hunk, which it cannot show: it is not drawn, so it grounds nothing.
    const partly = shotOf([
      { id: 'n', kind: 'node', label: 'Reader', evidence: ['terminal:1'] },
      { id: 'o', kind: 'output', evidence: 'diff-hunk:src/request.js:10' },
    ]);
    const drawn = alone(capture, partly, run);
    expect(drawn.direction.elements.map((e) => e.id)).toEqual(['n']);
    expect(sceneEvidence(capture, evidence, [], partly)).toContain('diff-hunk:src/request.js:10');
    expect(sceneEvidence(capture, evidence, [], shownShot(partly, drawn.direction))).toEqual([
      'terminal:1',
    ]);
    // Nothing resolved: the storyboard visual shows, and grounds the scene.
    const gone = shotOf([{ id: 'o', kind: 'output', evidence: 'diff-hunk:src/request.js:10' }]);
    const fallback = alone(capture, gone, run);
    expect(fallback.direction.whole).toBe(true);
    expect(shownShot(gone, fallback.direction)).toBeUndefined();
    expect(sceneEvidence(capture, evidence, [], shownShot(gone, fallback.direction))).toEqual([
      'screenshot:home',
    ]);
    expect(shownShot(undefined, drawn.direction)).toBeUndefined();
  });

  it('matches each scene to its timing by id, and refuses a scene the layout lacks', () => {
    const input = {
      plan: DirectionSchema.parse(directed),
      scenes,
      spec,
      language: 'en' as const,
      sources,
      image: (path: string) => ({ src: `assets/${path}`, width: 800, height: 600 }),
      seed: 5,
      redact: <T>(value: T) => redactor.redactDeep(value),
    };
    // Out of order, so the directed scene's place in the layout holds another scene's line.
    const [first, ...rest] = layout.scenes;
    const rotated = { ...layout, scenes: [...rest, first!] };
    expect(resolveDirection({ ...input, layout: rotated })).toEqual(staging);
    const short = { ...layout, scenes: layout.scenes.slice(0, 2) };
    expect(() => resolveDirection({ ...input, layout: short })).toThrow(
      'Story scene 3 has no timing in the layout.',
    );
  });
});
