import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, seedFrom } from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  type LayoutReport,
  layoutChecks,
  layoutScenes,
  pacingFor,
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
 * `edit` changes the timeline before it is written.
 */
async function directed(
  scenes: StoryboardInput['scenes'],
  shots: DirectionInput['shots'] = [],
  options: { off?: boolean; sources?: SourcesInput; edit?: (timeline: Timeline) => void } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-canvas-'));
  dirs.push(dir);
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
    expect(insetTop(v.of(rest, 's2').clip)).toBeCloseTo(regions.media.y, 1);
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

  it('clips what the camera magnifies to the scene’s region, and reports it clipped', async () => {
    const v = await directed(story, moves);
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats[0]!;
    const zoomed = await v.report(v.frameAt('s3', beat.t + beat.seconds + 0.1));
    const m = regions.media;
    expect(zoomed.items.length).toBeGreaterThan(0);
    for (const item of zoomed.items.filter((i) => i.role !== 'text')) {
      expect(item.rect.x).toBeGreaterThanOrEqual(m.x - 1);
      expect(item.rect.y).toBeGreaterThanOrEqual(m.y - 1);
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(m.x + m.width + 1);
      expect(item.rect.y + item.rect.height).toBeLessThanOrEqual(m.y + m.height + 1);
    }
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
      expect(item.rect.x).toBeGreaterThanOrEqual(m.x + tx - 1);
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(m.x + m.width + tx + 1);
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
