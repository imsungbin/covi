import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEvidence,
  type Demonstration,
  type Hunk,
  indexEvidence,
  resolveConfig,
  seedFrom,
} from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  type LayoutReport,
  layoutChecks,
  layoutScenes,
  pacingFor,
  type Rect,
  resolveVideoSpec,
  type StoryboardInput,
  StoryboardSchema,
  type Timeline,
  type TransitionKind,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultDirection,
  entrances,
  mergeDirection,
} from '../../packages/video/src/direction/director.ts';
import { resolveDirection } from '../../packages/video/src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../../packages/video/src/direction/schema.ts';
import { directionSources, type SourcesInput } from '../../packages/video/src/direction/sources.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * The canvas, drawn in Chromium: scenes sit at stops, the camera pans and zooms between them and
 * moves inside a stop on its beats, and the viewport keeps what it magnifies inside the scene's
 * region. Files under tests/ are typechecked without DOM types, so the page reads its own
 * elements from scripts, and nothing here imports a runtime file.
 */

const available = await canUseBrowser();
const dirs: string[] = [];
let browser: Browser | undefined;
beforeAll(async () => {
  if (available) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const W = 640;
const H = 360;
const regions = computeRegions({ width: W, height: H, orientation: 'landscape' });
const pivot = {
  x: regions.media.x + regions.media.width / 2,
  y: regions.media.y + regions.media.height / 2,
};

interface Drawn {
  id: string;
  display: string;
  opacity: string;
  transform: string | null;
  clip: string | null;
  header: string | null;
}

const TRANSFORM = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/;
/** A canvas layer's transform: its offset and scale. */
function camera(transform: string | null) {
  const m = TRANSFORM.exec(transform ?? '');
  if (!m) throw new Error(`not a canvas transform: ${transform}`);
  return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) };
}
const insetTop = (clip: string | null) => Number(/inset\(([\d.]+)px/.exec(clip ?? '')![1]);

/**
 * Builds a directed 640×360 composition the way the pipeline does (default director, the given
 * shots over it, entrances, timing, resolution) and opens it. `off` builds it as 0.2.0 did;
 * `edit` changes the timeline before it is written; `capture` puts a 640×400 capture at demo/a.png.
 */
async function directed(
  scenes: StoryboardInput['scenes'],
  shots: DirectionInput['shots'] = [],
  options: {
    off?: boolean;
    sources?: SourcesInput;
    edit?: (timeline: Timeline) => void;
    capture?: boolean;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-canvas-'));
  dirs.push(dir);
  if (options.capture) {
    const capture = await browser!.newPage({ viewport: { width: 640, height: 400 } });
    await capture.setContent(
      '<body style="margin:0;background:linear-gradient(90deg,#2a6f97,#f4a261)"></body>',
    );
    mkdirSync(join(dir, 'demo'));
    await capture.screenshot({ path: join(dir, 'demo', 'a.png') });
    await capture.close();
  }
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width: W, height: H });
  const title = 'Send only the ids';
  const parsed = StoryboardSchema.parse({ title, template: 'bug-fix', scenes }).scenes;
  const seed = seedFrom(title);
  const evidence = options.sources?.evidence;
  const sources = directionSources(options.sources ?? {});
  const plan = options.off
    ? undefined
    : mergeDirection(
        shots.length ? DirectionSchema.parse({ shots }) : undefined,
        defaultDirection({ scenes: parsed, evidence, seed }),
      );
  const enter = plan ? entrances(plan, parsed, evidence, seed) : new Map<string, TransitionKind>();
  const layout = layoutScenes(parsed, new Map(), new Map(), 'en', pacingFor(spec), enter);
  const assets = new AssetCollector(dir);
  if (options.capture) await assets.prepare(['demo/a.png']);
  const staging = plan
    ? resolveDirection({
        plan,
        scenes: parsed,
        layout,
        spec,
        language: 'en',
        sources,
        image: assets.image,
        seed,
        redact: (value) => value,
      })
    : undefined;
  const timeline = buildTimeline({
    title,
    scenes: parsed,
    layout,
    spec,
    image: assets.image,
    entrances: enter,
    ...(staging ? { staging } : {}),
  });
  options.edit?.(timeline);
  const composition = join(dir, 'composition');
  await writeComposition(composition, timeline, assets.files);
  const page = await browser!.newPage({ viewport: { width: W, height: H } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(composition, 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const scene = (id: string) => timeline.scenes.find((s) => s.id === id)!;
  const frameAt = (id: string, seconds: number) =>
    Math.round((scene(id).start + seconds) * timeline.fps);
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  const state = (frame: number) =>
    seek(
      frame,
      `return [...document.querySelectorAll('[data-scene]')].map((s) => ({
         id: s.dataset.scene,
         display: s.style.display,
         opacity: s.style.opacity,
         transform: s.querySelector(':scope > .stop-view > .layer')?.style.transform ?? null,
         clip: s.querySelector(':scope > .stop-view')?.style.clipPath ?? null,
         header: s.querySelector(':scope > .scene-header')?.style.opacity ?? null,
       }));`,
    ) as Promise<Drawn[]>;
  const of = (drawn: Drawn[], id: string) => drawn.find((d) => d.id === id)!;
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const grid = (frame: number) =>
    seek(
      frame,
      `const g = document.querySelector('.canvas-grid');
       return g ? { display: g.style.display, position: g.style.backgroundPosition, size: g.style.backgroundSize } : null;`,
    ) as Promise<{ display: string; position: string; size: string } | null>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, page, scene, frameAt, seek, state, of, report, grid, shot, errors };
}

const code = {
  kind: 'code',
  path: 'src/request.js',
  language: 'javascript',
  lines: [
    { type: 'context', text: 'function build(docs) {' },
    { type: 'del', text: '  return send(docs);' },
    { type: 'add', text: '  return send(docs.map((d) => d.id));' },
    { type: 'context', text: '}' },
  ],
  highlight: [2],
} satisfies StoryboardInput['scenes'][number]['visual'];
const story: StoryboardInput['scenes'] = [
  {
    id: 's1',
    beat: 'context',
    narration: 'The request carried every document.',
    visual: { kind: 'title', title: 'Send only the ids', meta: [] },
  },
  {
    id: 's2',
    beat: 'problem',
    eyebrow: 'Before',
    narration: 'So the reader timed out.',
    visual: { kind: 'callout', tone: 'warning', title: 'Timed out' },
  },
  {
    id: 's3',
    beat: 'fix',
    eyebrow: 'The fix',
    narration: 'Now it sends only the ids, and nothing else.',
    minSeconds: 6,
    visual: code,
  },
  {
    id: 's4',
    beat: 'summary',
    narration: 'Ready.',
    visual: { kind: 'summary', verdict: 'looks-good', headline: 'Ids only', points: [] },
  },
];
const moves: DirectionInput['shots'] = [
  { scene: 's2', enter: 'pan', elements: [{ id: 'visual', kind: 'visual' }] },
  {
    scene: 's3',
    enter: 'zoom',
    elements: [{ id: 'visual', kind: 'visual' }],
    beats: [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: 1.5, at: 'and nothing else' }],
  },
];

describe.skipIf(!available)('the canvas', () => {
  it('pans from stop to stop: both pictures travel under one camera, the region passing between', async () => {
    const v = await directed(story, moves);
    const s1 = v.scene('s1');
    const s2 = v.scene('s2');
    expect(s2.transition).toEqual({ kind: 'pan', seconds: 0.7 });
    expect(s2.stop!.x).toBeGreaterThan(s1.stop!.x);
    const mid = await v.state(v.frameAt('s2', 0.35));
    const [a, b] = [v.of(mid, 's1'), v.of(mid, 's2')];
    expect([a.display, b.display]).toEqual(['block', 'block']);
    expect([Number(a.opacity), Number(b.opacity)]).toEqual([1, 1]);
    const [ca, cb] = [camera(a.transform), camera(b.transform)];
    expect(ca.tx).toBeLessThan(0);
    expect(cb.tx).toBeGreaterThan(0);
    // One camera: the stops keep their distance on screen, at the camera's scale.
    expect(cb.tx - ca.tx).toBeCloseTo((s2.stop!.x - s1.stop!.x) * cb.scale, 0);
    expect(ca.scale).toBeCloseTo(cb.scale, 4);
    // The title owns the full frame, the callout only the media region: the clip passes between.
    expect(insetTop(b.clip)).toBeGreaterThan(regions.full.y + 2);
    expect(insetTop(b.clip)).toBeLessThan(regions.media.y - 2);
    const rest = await v.state(v.frameAt('s2', 0.75));
    expect(v.of(rest, 's1').display).toBe('none');
    const settled = camera(v.of(rest, 's2').transform);
    expect(Math.abs(settled.tx)).toBeLessThan(1);
    expect(settled.scale).toBeCloseTo(1, 2);
    // At rest nothing is clipped: the stop is drawn whole, as without a canvas.
    expect(v.of(rest, 's2').clip).toBe('');
    expect(v.errors).toEqual([]);
  });

  it('zooms out to show both stops, then into the next; only the old header fades', async () => {
    const v = await directed(story, moves);
    expect(v.scene('s3').transition).toEqual({ kind: 'zoom', seconds: 0.9 });
    const mid = await v.state(v.frameAt('s3', 0.45));
    const [a, b] = [camera(v.of(mid, 's2').transform), camera(v.of(mid, 's3').transform)];
    expect(a.scale).toBeCloseTo(b.scale, 4);
    expect(b.scale).toBeLessThan(0.75);
    expect(Number(v.of(mid, 's2').header)).toBeLessThan(1);
    expect(Number(v.of(mid, 's2').opacity)).toBe(1);
    const after = await v.state(v.frameAt('s3', 0.95));
    expect(camera(v.of(after, 's3').transform).scale).toBeCloseTo(1, 1);
    expect(v.of(after, 's3').header).toBe('');
  });

  it('zooms toward the highlighted line on its phrase', async () => {
    const v = await directed(story, moves);
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats[0]!;
    expect(beat).toMatchObject({ verb: 'camera', to: 'visual', zoom: 1.5 });
    const before = await v.state(v.frameAt('s3', beat.t - 0.05));
    expect(camera(v.of(before, 's3').transform).scale).toBeLessThan(1.1);
    const frame = v.frameAt('s3', beat.t + beat.seconds + 0.1);
    const zoomed = camera(v.of(await v.state(frame), 's3').transform);
    expect(zoomed.scale).toBeGreaterThan(1.45);
    expect(zoomed.scale).toBeLessThan(1.6);
    const row = (await v.seek(
      frame,
      `const r = document.querySelector('[data-scene="s3"] .ln.add').getBoundingClientRect();
       return { x: r.x, y: r.y, width: r.width, height: r.height };`,
    )) as { x: number; y: number; width: number; height: number };
    const m = regions.media;
    expect(row.y).toBeGreaterThanOrEqual(m.y - 1);
    expect(row.y + row.height).toBeLessThanOrEqual(m.y + m.height + 1);
    // Closer to the middle of the frame than it sits at rest.
    expect(Math.abs(row.y + row.height / 2 - pivot.y)).toBeLessThan(m.height / 4);
  });

  it('clips what the camera magnifies to the scene’s rows, and reports it clipped', async () => {
    const v = await directed(story, moves);
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats[0]!;
    const zoomed = await v.report(v.frameAt('s3', beat.t + beat.seconds + 0.1));
    const m = regions.media;
    expect(zoomed.items.length).toBeGreaterThan(0);
    const media = zoomed.items.filter((i) => i.role !== 'text');
    for (const item of media) {
      expect(item.rect.x).toBeGreaterThanOrEqual(-1);
      expect(item.rect.y).toBeGreaterThanOrEqual(m.y - 1);
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(W + 1);
      expect(item.rect.y + item.rect.height).toBeLessThanOrEqual(m.y + m.height + 1);
    }
    // Only the header and captions are protected: the frame's sides show what the camera shows.
    expect(Math.max(...media.map((i) => i.rect.x + i.rect.width))).toBeGreaterThan(
      m.x + m.width + 1,
    );
    const checks = layoutChecks(v.timeline, [zoomed]);
    expect(checks.find((c) => c.id === 'captions-clear-of-content')!.status).toBe('pass');
  });

  it('moves the canvas’s dots with the camera, lined up with the stage’s at rest', async () => {
    const v = await directed(story, moves);
    const at = (position: string) => Number(position.split('px')[0]);
    const rest = (await v.grid(v.frameAt('s2', 0.75)))!;
    const size = Number(rest.size.split('px')[0]);
    expect(rest.display).toBe('block');
    expect(Math.min(at(rest.position), size - at(rest.position))).toBeLessThan(0.5);
    const travelling = new Set<string>();
    for (const k of [0.2, 0.3, 0.4])
      travelling.add((await v.grid(v.frameAt('s2', 0.7 * k)))!.position);
    expect(travelling.size).toBe(3);
  });

  it('is deterministic: the same timeline renders the same frame bytes', async () => {
    const [a, b] = [await directed(story, moves), await directed(story, moves)];
    for (const [id, seconds] of [
      ['s2', 0.35],
      ['s3', 0.45],
    ] as const) {
      const frame = a.frameAt(id, seconds);
      expect((await a.shot(frame)).equals(await b.shot(frame))).toBe(true);
    }
  });

  it('draws every scene on screen with one camera when a scene is too short to settle between moves', async () => {
    // The callout lasts 1.2 s: the zoom out of it starts while the pan into it is still going.
    const v = await directed(story, moves, {
      edit: (timeline) => {
        const [s2, s3] = [timeline.scenes[1]!, timeline.scenes[2]!];
        s3.start = s2.start + 0.3;
        s2.end = s3.start + s3.transition!.seconds;
      },
    });
    const ids = ['s1', 's2', 's3'];
    const stops = ids.map((id) => v.scene(id).stop!);
    let before: number | undefined;
    for (let frame = v.frameAt('s2', 0.25); frame <= v.frameAt('s2', 1.25); frame++) {
      const drawn = await v.state(frame);
      const shown = ids.flatMap((id, k) => {
        const d = v.of(drawn, id);
        return d.display === 'block' ? [{ k, ...camera(d.transform) }] : [];
      });
      // Every picture on screen sits where one camera puts it.
      const [a] = shown;
      for (const b of shown.slice(1)) {
        expect(b.scale).toBeCloseTo(a!.scale, 4);
        expect(b.tx - a!.tx).toBeCloseTo((stops[b.k]!.x - stops[a!.k]!.x) * a!.scale, 0);
        expect(b.ty - a!.ty).toBeCloseTo((stops[b.k]!.y - stops[a!.k]!.y) * a!.scale, 0);
      }
      // And that camera never jumps from one frame to the next, also where the pan hands over.
      if (before !== undefined) expect(Math.abs(a!.scale - before)).toBeLessThan(0.1);
      before = a!.scale;
    }
    expect(v.errors).toEqual([]);
  });

  it('reports a scene that pushes out where it is drawn, its clip moving with it', async () => {
    const v = await directed(story, moves);
    expect(v.scene('s4').transition!.kind).toBe('push');
    const frame = v.frameAt('s4', 0.25);
    const report = await v.report(frame);
    expect(report.scene).toBe('s3');
    const tx = camera(
      (await v.seek(frame, `return document.querySelector('[data-scene="s3"]').style.transform;`)) +
        ' scale(1)',
    ).tx;
    expect(tx).toBeLessThan(-W / 4);
    const m = regions.media;
    const media = report.items.filter((i) => i.role !== 'text');
    expect(media.length).toBeGreaterThan(0);
    for (const item of media) {
      expect(item.rect.x).toBeGreaterThanOrEqual(tx - 1);
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(W + tx + 1);
    }
    expect(Math.min(...media.map((i) => i.rect.x))).toBeLessThan(m.x - 10);
  });

  it('leaves no trace of measuring a beat’s target before the first frame', async () => {
    // A still camera: the two differ only in the beat, so the frames before it are the same.
    const still = story.map((s) => (s.id === 's3' ? { ...s, camera: 'static' as const } : s));
    const without = moves.map((s) => (s.scene === 's3' ? { ...s, beats: [] } : s));
    const [a, b] = [await directed(still, moves), await directed(still, without)];
    expect(a.scene('s3').direction!.beats).toHaveLength(1);
    expect(b.scene('s3').direction!.beats).toHaveLength(0);
    const frame = a.frameAt('s3', a.scene('s3').direction!.beats[0]!.t - 0.3);
    expect((await a.shot(frame)).equals(await b.shot(frame))).toBe(true);
  });

  it('clips only while the camera travels or magnifies, and never with a neighbour in the frame', async () => {
    const v = await directed(story, moves);
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats[0]!;
    const clipOf = async (id: string, seconds: number) =>
      v.of(await v.state(v.frameAt(id, seconds)), id).clip;
    // Drawn whole at rest, before the beat zooms in; clipped mid-move and while magnified.
    expect(await clipOf('s2', 1)).toBe('');
    expect(await clipOf('s3', 1.2)).toBe('');
    expect(await clipOf('s4', 1.5)).toBe('');
    expect(await clipOf('s3', 0.45)).not.toBe('');
    expect(await clipOf('s3', beat.t + beat.seconds + 0.1)).not.toBe('');
    // While the viewport closes (the move's first fifth) and opens again (its last), the stop the
    // camera is not at has nothing in the frame, so nothing of it shows over the header or captions.
    const inFrame = (id: string, frame: number) =>
      v.seek(
        frame,
        `const layer = document.querySelector('[data-scene="${id}"] > .stop-view > .layer');
         return [...layer.querySelectorAll('*')].some((n) => {
           const r = n.getBoundingClientRect();
           return r.width > 0 && r.height > 0 && r.right > 0 && r.left < ${W} && r.bottom > 0 && r.top < ${H};
         });`,
      ) as Promise<boolean>;
    for (const [from, to] of [
      ['s1', 's2'],
      ['s2', 's3'],
    ] as const) {
      const scene = v.scene(to);
      const seconds = scene.transition!.seconds;
      let checked = 0;
      for (let frame = v.frameAt(to, 0); frame <= v.frameAt(to, seconds); frame++) {
        const k = (frame / v.timeline.fps - scene.start) / seconds;
        if (k > 0.2 && k < 0.8) continue;
        expect(await inFrame(k <= 0.2 ? to : from, frame)).toBe(false);
        checked++;
      }
      expect(checked).toBeGreaterThan(4);
    }
  });

  it('hands the header over across a camera move: two are never on screen at once', async () => {
    const pan = moves.map((s) => (s.scene === 's3' ? { ...s, enter: 'pan' as const } : s));
    for (const shots of [moves, pan]) {
      const v = await directed(story, shots);
      const s3 = v.scene('s3');
      const seconds = s3.transition!.seconds;
      for (let frame = v.frameAt('s3', 0); frame <= v.frameAt('s3', seconds + 0.6); frame++) {
        const shown = (await v.seek(
          frame,
          `return [...document.querySelectorAll('[data-scene]')]
             .filter((s) => s.style.display === 'block')
             .map((s) => {
               const h = s.querySelector(':scope > .scene-header');
               if (!h) return 0;
               const parts = [...h.children].map((c) => Number.parseFloat(c.style.opacity || '1'));
               return Number.parseFloat(h.style.opacity || '1') * Math.max(...parts) *
                 Number.parseFloat(s.style.opacity || '1');
             });`,
        )) as number[];
        expect(shown.filter((o) => o > 0.05).length).toBeLessThanOrEqual(1);
      }
      // The new header is in place once the move is done.
      const eyebrow = await v.seek(
        v.frameAt('s3', seconds + 0.6),
        `return document.querySelector('[data-scene="s3"] .eyebrow').style.opacity;`,
      );
      expect(Number(eyebrow)).toBeCloseTo(1, 2);
    }
  });

  it('eases the narrator in from a card with its own fox, and out into one', async () => {
    const into = {
      scene: 's4',
      enter: 'pan' as const,
      elements: [{ id: 'visual', kind: 'visual' as const }],
    };
    const v = await directed(story, [...moves, into]);
    expect(v.scene('s4').transition!.kind).toBe('pan');
    for (const id of ['s2', 's4']) {
      const seconds = v.scene(id).transition!.seconds;
      const seen: number[] = [];
      for (let frame = v.frameAt(id, -0.1); frame <= v.frameAt(id, seconds + 0.1); frame++)
        seen.push(
          Number(await v.seek(frame, `return document.querySelector('.narrator').style.opacity;`)),
        );
      for (const [k, opacity] of seen.entries())
        if (k > 0) expect(Math.abs(opacity - seen[k - 1]!)).toBeLessThan(0.2);
      // It does come (from the title) and go (into the summary).
      expect(Math.abs(seen.at(-1)! - seen[0]!)).toBeGreaterThan(0.9);
    }
  });

  it('points the hero ring and reports the focus where the camera draws a capture', async () => {
    const page = {
      id: 's2',
      beat: 'fix',
      eyebrow: 'The page',
      hero: true,
      narration: 'First look here, then at the save button.',
      sync: { hero: 'the save button' },
      visual: {
        kind: 'screenshot',
        image: { path: 'demo/a.png' },
        focus: { x: 540, y: 0, width: 100, height: 60 },
        device: 'desktop',
      },
    } satisfies StoryboardInput['scenes'][number];
    const zoom: DirectionInput['shots'] = [
      {
        scene: 's2',
        elements: [{ id: 'visual', kind: 'visual' }],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: 2, at: 'First look here' }],
      },
    ];
    const v = await directed([story[0]!, page, story[3]!], zoom, { capture: true });
    const s2 = v.scene('s2');
    const beat = s2.direction!.beats[0]!;
    const hero = s2.phases!.hero!;
    expect(hero).toBeGreaterThan(beat.t + beat.seconds);
    const frame = v.frameAt('s2', hero + 0.2);
    const drawn = (await v.seek(
      frame,
      `const box = (n) => {
         const r = n.getBoundingClientRect();
         return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(n.style.opacity) };
       };
       // The frame's focus ring as drawn (the focus and a margin, kept inside the frame), where it
       // is laid out before the camera moves it, and the hero's ring.
       const f = document.querySelector('[data-scene="s2"] .focus-ring');
       const laid = { x: Number.parseFloat(f.style.left), y: Number.parseFloat(f.style.top) };
       return { focus: box(f), laid, ring: box(document.querySelector('.hero-accent .ring')) };`,
    )) as {
      focus: Rect & { opacity: number };
      laid: { x: number; y: number };
      ring: Rect & { opacity: number };
    };
    const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const inside = (p: { x: number; y: number }, r: Rect) =>
      p.x >= r.x - 1 && p.x <= r.x + r.width + 1 && p.y >= r.y - 1 && p.y <= r.y + r.height + 1;
    expect(drawn.focus.opacity).toBeGreaterThan(0.5);
    expect(drawn.ring.opacity).toBeGreaterThan(0.05);
    // In the image's corner the frame's own zoom cannot center the focus: the beat moves it far.
    expect(Math.hypot(drawn.focus.x - drawn.laid.x, drawn.focus.y - drawn.laid.y)).toBeGreaterThan(
      40,
    );
    // The hero's ring opens around the focus as the camera draws it, not where it is laid out; the
    // focus is reported there too.
    expect(inside(center(drawn.ring), drawn.focus)).toBe(true);
    const focus = (await v.report(frame)).items.find((i) => i.role === 'focus')!;
    expect(inside(focus.rect, drawn.focus)).toBe(true);
    expect(
      inside(
        { x: focus.rect.x + focus.rect.width, y: focus.rect.y + focus.rect.height },
        drawn.focus,
      ),
    ).toBe(true);
    expect(Math.abs(center(drawn.ring).x - center(focus.rect).x)).toBeLessThan(1);
    expect(Math.abs(center(drawn.ring).y - center(focus.rect).y)).toBeLessThan(1);
  });

  it('with direction off, draws as 0.2.0 did: no canvas, no stops, the old transitions', async () => {
    const v = await directed(story, [], { off: true });
    expect(v.timeline.scenes.some((s) => s.stop || s.direction)).toBe(false);
    expect(v.scene('s2').transition!.kind).toBe('fade');
    const drawn = await v.state(v.frameAt('s2', 1));
    for (const d of drawn) expect(d.transform).toBeNull();
    const page = (await v.seek(
      v.frameAt('s2', 1),
      `return {
         canvas: document.querySelectorAll('.canvas-grid, .stop-view, [data-element]').length,
         origin: document.querySelector('[data-scene="s2"] > .layer').style.transformOrigin,
       };`,
    )) as { canvas: number; origin: string };
    expect(page.canvas).toBe(0);
    // The push-in scales about the media region's center, as it always has.
    const [ox, oy] = page.origin.split(' ').map((v) => Number.parseFloat(v));
    expect(ox).toBeCloseTo(pivot.x, 1);
    expect(oy).toBeCloseTo(pivot.y, 1);
  });
});

// A run with one hunk and one demo command, for shots that show them.
const hunk: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { kind: 'del', text: 'send(docs);', oldLine: 1 },
    { kind: 'add', text: 'send(ids);', newLine: 1 },
  ],
};
const files = [{ path: 'src/request.js', language: 'javascript', hunks: [hunk] }];
const demo = {
  commands: [
    {
      name: 'measure',
      command: 'node measure.js',
      before: { exitCode: 0, output: 'request bytes: 120000' },
      after: { exitCode: 0, output: 'request bytes: 9000' },
      changed: true,
    },
  ],
  shots: [],
  requests: [],
  skipped: [],
  findings: [],
} as unknown as Demonstration;
const run: SourcesInput = {
  files,
  demo,
  evidence: indexEvidence(buildEvidence({ diff: files, demo })),
};
const elements: DirectionInput['shots'][number]['elements'] = [
  { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:1', side: 'diff' },
  { id: 'note', kind: 'label', text: 'Much smaller', tone: 'success' },
  { id: 'out', kind: 'output', evidence: 'terminal:1' },
];
const elementState = (v: Awaited<ReturnType<typeof directed>>, frame: number, id: string) =>
  v.seek(
    frame,
    `const e = document.querySelector('[data-element="${id}"]');
     const r = e.querySelector('.code, .term, .dlabel, .node').getBoundingClientRect();
     return {
       opacity: Number.parseFloat(e.style.opacity || '1'),
       transform: e.style.transform,
       clip: e.style.clipPath,
       text: e.querySelector('.nlabel')?.textContent ?? null,
       box: { x: r.x, y: r.y, width: r.width, height: r.height },
     };`,
  ) as Promise<{
    opacity: number;
    transform: string;
    clip: string;
    text: string | null;
    box: { x: number; y: number; width: number; height: number };
  }>;

describe.skipIf(!available)('a shot’s elements', () => {
  it('draws code, a label, and output from the run in their slots', async () => {
    const v = await directed(story, [{ scene: 's3', layout: 'row', elements }], { sources: run });
    const s3 = v.scene('s3');
    expect(s3.direction!.whole).toBe(false);
    const frame = v.frameAt('s3', 1.2);
    for (const element of s3.direction!.elements) {
      const drawn = await elementState(v, frame, element.id);
      const center = drawn.box.x + drawn.box.width / 2;
      expect(center, element.id).toBeGreaterThan(element.rect.x);
      expect(center, element.id).toBeLessThan(element.rect.x + element.rect.width);
    }
    expect((await elementState(v, frame, 'note')).text).toBe('Much smaller');
    const shown = (await v.seek(
      frame,
      `return [document.querySelector('[data-element="req"] .ln.add .txt').textContent,
               document.querySelector('[data-element="out"] .out').textContent];`,
    )) as string[];
    expect(shown).toEqual(['send(ids);', 'request bytes: 9000']);
    expect(v.errors).toEqual([]);
  });

  it('reveals an element on its phrase: absent before, popping in, then in place', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [{ verb: 'reveal', element: 'note', style: 'pop', at: 'and nothing else' }],
        },
      ],
      { sources: run },
    );
    const reveal = v.scene('s3').direction!.beats.find((b) => b.verb === 'reveal')!;
    const texts = async (frame: number) =>
      (await v.report(frame)).items.filter((i) => i.role === 'text').length;
    const before = v.frameAt('s3', reveal.t - 0.1);
    expect((await elementState(v, before, 'note')).opacity).toBe(0);
    const during = await elementState(v, v.frameAt('s3', reveal.t + reveal.seconds / 4), 'note');
    expect(during.opacity).toBeGreaterThan(0);
    expect(during.transform).toMatch(/scale\(0\.\d+\)/);
    const after = v.frameAt('s3', reveal.t + reveal.seconds + 0.1);
    expect(await elementState(v, after, 'note')).toMatchObject({ opacity: 1, transform: '' });
    // Not on screen, not reported: the label's text joins the report once it is revealed.
    expect(await texts(after)).toBeGreaterThan(await texts(before));
  });

  it('wipes and types elements in', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [
            { verb: 'reveal', element: 'out', style: 'wipe', at: 'only the ids' },
            { verb: 'reveal', element: 'note', style: 'type', at: 'and nothing else' },
          ],
        },
      ],
      { sources: run },
    );
    const beats = v.scene('s3').direction!.beats;
    const wipe = beats.find((b) => b.verb === 'reveal' && b.element === 'out')!;
    const type = beats.find((b) => b.verb === 'reveal' && b.element === 'note')!;
    expect((await elementState(v, v.frameAt('s3', wipe.t + wipe.seconds / 2), 'out')).clip).toMatch(
      /^inset\(/,
    );
    expect((await elementState(v, v.frameAt('s3', wipe.t + wipe.seconds + 0.1), 'out')).clip).toBe(
      '',
    );
    const typing = (await elementState(v, v.frameAt('s3', type.t + type.seconds / 2), 'note'))
      .text!;
    expect(typing.length).toBeGreaterThan(0);
    expect(typing.length).toBeLessThan('Much smaller'.length);
    expect('Much smaller'.startsWith(typing)).toBe(true);
    expect((await elementState(v, v.frameAt('s3', type.t + type.seconds + 0.1), 'note')).text).toBe(
      'Much smaller',
    );
  });

  it('moves the camera onto an element: the label lands in the middle of the frame', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [{ verb: 'camera', move: 'zoom', to: 'note', at: 'and nothing else' }],
        },
      ],
      { sources: run },
    );
    const beat = v.scene('s3').direction!.beats[0]!;
    const frame = v.frameAt('s3', beat.t + beat.seconds + 0.1);
    const { box } = await elementState(v, frame, 'note');
    expect(Math.abs(box.x + box.width / 2 - pivot.x)).toBeLessThan(3);
    expect(Math.abs(box.y + box.height / 2 - pivot.y)).toBeLessThan(3);
    expect(camera(v.of(await v.state(frame), 's3').transform).scale).toBeGreaterThan(1.5);
  });

  it('plays a revealed element’s own choreography from its reveal, already in place', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [{ verb: 'reveal', element: 'out', at: 'and nothing else' }],
        },
      ],
      { sources: run },
    );
    const reveal = v.scene('s3').direction!.beats[0]!;
    // On the scene's clock the command would have been typed long before its reveal.
    expect(reveal.t).toBeGreaterThan(1);
    const window = (seconds: number) =>
      v.seek(
        v.frameAt('s3', seconds),
        `const w = document.querySelector('[data-element="out"] .term');
         return { opacity: w.style.opacity, typed: w.querySelector('.cmd').textContent };`,
      ) as Promise<{ opacity: string; typed: string }>;
    // The reveal brings the window in, so it does not rise a second time.
    expect(await window(reveal.t + 0.1)).toEqual({ opacity: '1', typed: '' });
    expect((await window(reveal.t + 1)).typed).toBe('node measure.js');
  });

  it('reports a label’s text at body size, and as clipped when it cannot fit its box', async () => {
    const texts = async (edit?: (timeline: Timeline) => void) => {
      const v = await directed(story, [{ scene: 's3', layout: 'row', elements }], {
        sources: run,
        ...(edit ? { edit } : {}),
      });
      // The scene has no heading and its code no caption: the label's is the only text.
      return (await v.report(v.frameAt('s3', 1.2))).items.filter((i) => i.role === 'text');
    };
    const fits = await texts();
    expect(fits).toHaveLength(1);
    expect(fits[0]!.overflow).toBe(false);
    expect(fits[0]!.text).toBe('body');
    expect(fits[0]!.font! / regions.unit).toBeGreaterThanOrEqual(28 - 0.1);
    const cramped = await texts((timeline) => {
      const shot = timeline.scenes.find((s) => s.id === 's3')!.direction!;
      const note = shot.elements.find((e) => e.id === 'note')!;
      // Too short for one line at the smallest size, padding included.
      note.rect = { ...note.rect, height: 12 };
    });
    expect(cramped).toHaveLength(1);
    expect(cramped[0]!.overflow).toBe(true);
  });

  it('reports a capture’s focus where the camera draws it, in a shot as in a whole scene', async () => {
    const page = {
      id: 's2',
      beat: 'fix',
      eyebrow: 'The page',
      narration: 'First look here, then at the save button.',
      visual: {
        kind: 'screenshot',
        image: { path: 'demo/a.png' },
        focus: { x: 540, y: 0, width: 100, height: 60 },
        device: 'desktop',
      },
    } satisfies StoryboardInput['scenes'][number];
    const v = await directed(
      [story[0]!, page, story[3]!],
      [
        {
          scene: 's2',
          layout: 'row',
          elements: [
            { id: 'visual', kind: 'visual' },
            { id: 'note', kind: 'label', text: 'Saved' },
          ],
          beats: [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: 2, at: 'First look here' }],
        },
      ],
      { capture: true },
    );
    const s2 = v.scene('s2');
    expect(s2.direction!.whole).toBe(false);
    const frame = v.frameAt('s2', 0.8 * (s2.end - s2.start));
    const ring = (await v.seek(
      frame,
      `const f = document.querySelector('[data-scene="s2"] .focus-ring');
       const r = f.getBoundingClientRect();
       return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(f.style.opacity) };`,
    )) as Rect & { opacity: number };
    expect(ring.opacity).toBeGreaterThan(0.5);
    const focus = (await v.report(frame)).items.find((i) => i.role === 'focus')!;
    const inside = (x: number, y: number) =>
      x >= ring.x - 1 &&
      x <= ring.x + ring.width + 1 &&
      y >= ring.y - 1 &&
      y <= ring.y + ring.height + 1;
    expect(inside(focus.rect.x, focus.rect.y)).toBe(true);
    expect(inside(focus.rect.x + focus.rect.width, focus.rect.y + focus.rect.height)).toBe(true);
    expect(v.errors).toEqual([]);
  });
});
