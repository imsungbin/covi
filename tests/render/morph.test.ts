import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiffLine, resolveConfig } from '@covi/core';
import {
  buildTimeline,
  type DirectionBeat,
  type LayoutReport,
  layoutScenes,
  type MorphRow,
  pacingFor,
  type Rect,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { morphHunk } from '../../packages/video/src/direction/tokens.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import { codeCard, TEXT_FLOOR } from '../../packages/video/src/runtime/sizing.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * The token morph, drawn in Chromium from a timeline built by hand (a morph element and its
 * beats, as the resolver writes them): kept tokens travel, removed lines fold away, new lines
 * slide in, the camera follows the changed lines, and the same timeline draws the same bytes.
 * Files under tests/ are typechecked without DOM types, so the page reads its own elements.
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
const { media, unit } = computeRegions({ width: W, height: H, orientation: 'landscape' });
const context = (text: string, oldLine: number, newLine = oldLine): DiffLine => ({
  kind: 'context',
  text,
  oldLine,
  newLine,
});
const del = (text: string, n: number): DiffLine => ({ kind: 'del', text, oldLine: n });
const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, newLine: n });

// The benchmark's change, cut to its second block, with a blank line and a comment it drops.
const refs: DiffLine[] = [
  context('export function buildReviewRequest(store, ids) {', 43, 46),
  context('  return chunk(', 44, 47),
  context('', 45, 48),
  del('    // every document, in full', 46),
  del("    'documents',", 47),
  del('    ids.map((id) => store.get(id)),', 48),
  add("    'refs',", 49),
  add('    ids.map((id) => {', 50),
  add('      const { title, body } = store.get(id);', 51),
  add('      return { id, title, bytes: Buffer.byteLength(body) };', 52),
  add('    }),', 53),
  context('  );', 49, 54),
  context('}', 50, 55),
];
const MORPH: DirectionBeat = { verb: 'morph', element: 'm', t: 2, seconds: 1.6 };

/**
 * A two-scene 640×360 composition whose second scene morphs `lines` on `beats` (seconds since that
 * scene started) in a card laid out in `rect`, opened in Chromium.
 */
async function morphed(lines: DiffLine[], beats: DirectionBeat[] = [MORPH], rect: Rect = media) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-morph-'));
  dirs.push(dir);
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width: W, height: H });
  const scenes = StoryboardSchema.parse({
    title: 'Send only the ids',
    template: 'bug-fix',
    scenes: [
      {
        id: 's1',
        beat: 'problem',
        narration: 'The request carried every document.',
        visual: { kind: 'callout', title: 'Before' },
      },
      {
        id: 's2',
        beat: 'fix',
        narration: 'Now it sends only the ids, and the reader fetches each document itself.',
        minSeconds: 7,
        visual: { kind: 'callout', title: 'After' },
      },
    ],
  }).scenes;
  const model = morphHunk(lines, {
    max: 14,
    language: 'javascript',
    elided: (count) => `… ${count} lines`,
  })!;
  const staging: SceneStaging[] = [
    {
      stop: { x: 0, y: 0 },
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect: media }],
        beats: [],
      },
    },
    {
      stop: { x: 800, y: 0 },
      direction: {
        whole: false,
        elements: [
          {
            id: 'm',
            kind: 'morph',
            rect,
            morph: { path: 'src/request.js', language: 'javascript', ...model },
          },
        ],
        beats,
      },
    },
  ];
  const timeline = buildTimeline({
    title: 'Send only the ids',
    scenes,
    layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
    spec,
    image: () => ({ src: '', width: 1, height: 1 }),
    staging,
  });
  const composition = join(dir, 'composition');
  await writeComposition(composition, timeline, new Map());
  const page = await browser!.newPage({ viewport: { width: W, height: H } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(composition, 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const s2 = timeline.scenes.find((s) => s.id === 's2')!;
  /** The frame `seconds` into the morphing scene. */
  const at = (seconds: number) => Math.round((s2.start + seconds) * timeline.fps);
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  /**
   * The morph's tokens at a frame (or other pieces of the card, by selector): what each is, its
   * place in the card, its width, how much of its end is hidden, its fold, and its opacity.
   */
  const pieces = (frame: number, selector = '[data-token]') =>
    seek(
      frame,
      `return [...document.querySelectorAll('[data-element="m"] .mlive ${selector}')].map((n) => {
         const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)(?: scaleY\\(([\\d.]+)\\))?/.exec(n.style.transform);
         const clip = /inset\\(\\S+ ([\\d.]+)px/.exec(n.style.clipPath);
         return { token: n.dataset.token, text: n.textContent, x: Number(m[1]), y: Number(m[2]),
           width: Number.parseFloat(getComputedStyle(n).width), clip: clip ? Number(clip[1]) : 0,
           fold: m[3] === undefined ? 1 : Number(m[3]), opacity: Number(n.style.opacity || '1') };
       });`,
    ) as Promise<
      Array<{
        token: string;
        text: string;
        x: number;
        y: number;
        width: number;
        clip: number;
        fold: number;
        opacity: number;
      }>
    >;
  /** The canvas camera on the morphing scene: its layer's offset and scale. */
  const camera = async (frame: number) => {
    const transform = (await seek(
      frame,
      `return document.querySelector('[data-scene="s2"] > .stop-view > .layer').style.transform;`,
    )) as string;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(transform)!;
    return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) };
  };
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, model, at, seek, pieces, camera, report, shot, errors };
}

type Pieces = Awaited<ReturnType<Awaited<ReturnType<typeof morphed>>['pieces']>>;
const find = (all: Pieces, token: string, text: string) =>
  all.find((p) => p.token === token && p.text === text)!;

describe.skipIf(!available)('the token morph', () => {
  it('turns the code before into the code after: kept tokens travel, removed lines fold, new ones arrive', async () => {
    const v = await morphed(refs);
    const k = (share: number) => v.pieces(v.at(MORPH.t + MORPH.seconds * share));
    const [before, mid, after] = [await k(-0.2), await k(0.5), await k(1.1)];
    // `map` stays, moving up a row as the dropped comment folds away above it.
    const map = [before, mid, after].map((all) => find(all, 'kept', 'map'));
    expect(map[0]!.y).toBeGreaterThan(map[2]!.y + 1);
    expect(map[1]!.y).toBeLessThan(map[0]!.y - 0.5);
    expect(map[1]!.y).toBeGreaterThan(map[2]!.y + 0.5);
    // The comment shares nothing with what replaced it: it fades and folds where it was.
    const every = [before, mid, after].map((all) => find(all, 'removed', 'every'));
    expect(every[0]).toMatchObject({ opacity: 1, fold: 1 });
    expect(every[1]!.opacity).toBeGreaterThan(0.05);
    expect(every[1]!.opacity).toBeLessThan(0.95);
    expect(every[1]!.fold).toBeLessThan(0.9);
    expect(every[2]!.opacity).toBe(0);
    // A new line slides in, partly there at the middle of the morph.
    const added = [before, mid, after].map((all) => find(all, 'added', 'byteLength'));
    expect(added[0]!.opacity).toBe(0);
    expect(added[1]!.opacity).toBeGreaterThan(0.05);
    expect(added[1]!.opacity).toBeLessThan(0.95);
    expect(added[1]!.x).toBeLessThan(added[2]!.x);
    expect(added[2]!.opacity).toBe(1);
    expect(v.errors).toEqual([]);
  });

  it('settles on the code after the change, reported as code for QC', async () => {
    const v = await morphed(refs);
    const frame = v.at(MORPH.t + MORPH.seconds + 0.6);
    const card = (await v.report(frame)).items.find((i) => i.text === 'code')!;
    // Its text is the size a code card holding both sides gets, above the floor where it fits.
    const text = (row: MorphRow) => row.tokens.map((t) => t.text).join('');
    const { base, head } = v.model;
    const sized = codeCard(
      [...base, ...head].map(text),
      Math.max(base.length, head.length),
      media,
      'landscape',
      unit,
    );
    expect(card.font).toBeCloseTo(sized.font, 1);
    expect(sized.font).toBeGreaterThanOrEqual(TEXT_FLOOR.code * unit);
    const shown = (await v.pieces(frame)).filter((p) => p.opacity > 0).map((p) => p.text);
    expect(shown).toEqual(expect.arrayContaining(['refs', 'byteLength', 'buildReviewRequest']));
    expect(shown).not.toContain('documents');
  });

  it('is deterministic: the same timeline renders the same mid-morph bytes', async () => {
    const [a, b] = [await morphed(refs), await morphed(refs)];
    const frame = a.at(MORPH.t + MORPH.seconds / 2);
    expect((await a.shot(frame)).equals(await b.shot(frame))).toBe(true);
  });

  it('marks the lines it leaves out of a long hunk', async () => {
    const long: DiffLine[] = [
      ...Array.from({ length: 6 }, (_, i) => add(`first${i}();`, i + 1)),
      ...Array.from({ length: 6 }, (_, i) => context(`keep${i}();`, i + 1, i + 7)),
      ...Array.from({ length: 6 }, (_, i) => add(`then${i}();`, i + 13)),
    ];
    const v = await morphed(long);
    const shown = await v.pieces(v.at(MORPH.t + MORPH.seconds + 0.6));
    expect(shown.filter((p) => p.text.startsWith('…') && p.opacity > 0).map((p) => p.text)).toEqual(
      ['… 5 lines'],
    );
  });

  it('opens room for lines added between others, and moves the code below down', async () => {
    const insertion: DiffLine[] = [
      context('function take(qty) {', 10),
      add('  if (qty <= 0) return 0;', 11),
      context('  return qty - 1;', 11, 12),
      context('}', 12, 13),
    ];
    const v = await morphed(insertion);
    const [before, after] = [
      await v.pieces(v.at(1)),
      await v.pieces(v.at(MORPH.t + MORPH.seconds + 0.1)),
    ];
    expect(find(after, 'kept', 'qty').y).toBeGreaterThanOrEqual(find(before, 'kept', 'qty').y);
    const below = (all: Pieces) => all.filter((p) => p.token === 'kept' && p.text === '1').at(-1)!;
    expect(below(after).y).toBeGreaterThan(below(before).y + 1);
    expect(find(after, 'added', 'if').opacity).toBe(1);
    expect(v.errors).toEqual([]);
  });

  it('ends a line too long for the card in an ellipsis, as a code card does', async () => {
    const long = `  return '${'x'.repeat(80)}';`;
    const v = await morphed([
      context('function take() {', 10),
      del('  return 1;', 11),
      add(long, 11),
      context('}', 12),
    ]);
    const shown = (all: Pieces) => all.filter((p) => p.opacity > 0);
    // The old line fits; the new one runs past the card and gets its ellipsis as it arrives.
    expect(shown(await v.pieces(v.at(1), '.mcut'))).toEqual([]);
    const settled = v.at(MORPH.t + MORPH.seconds + 0.6);
    const [more, ...others] = shown(await v.pieces(settled, '.mcut'));
    expect(others).toEqual([]);
    expect(more).toMatchObject({ text: '…', opacity: 1 });
    // Its tokens run on past the ellipsis, hidden from where it starts.
    const line = shown(await v.pieces(settled)).filter((p) => p.y === more!.y);
    expect(Math.max(...line.map((p) => p.x + p.width))).toBeGreaterThan(more!.x + more!.width);
    for (const p of line) expect(p.x + p.width - p.clip).toBeLessThanOrEqual(more!.x + 0.5);
    // The ellipsis sits inside the text column, which ends 1em short of the card's edge.
    const column = (await v.seek(
      settled,
      `const live = document.querySelector('[data-element="m"] .mlive');
       return live.offsetWidth - Number.parseFloat(getComputedStyle(live).fontSize);`,
    )) as number;
    expect(more!.x + more!.width).toBeLessThanOrEqual(column + 0.5);
    expect(v.errors).toEqual([]);
  });

  it('plays on its own clock when it is revealed later', async () => {
    const v = await morphed(refs, [
      { verb: 'reveal', element: 'm', style: 'rise', t: 1, seconds: 0.5 },
      MORPH,
    ]);
    const mid = await v.pieces(v.at(MORPH.t + MORPH.seconds / 2));
    const added = find(mid, 'added', 'byteLength');
    expect(added.opacity).toBeGreaterThan(0.05);
    expect(added.opacity).toBeLessThan(0.95);
  });

  it('follows the changed lines with the camera as they move, keeping them in the region', async () => {
    const follow: DirectionBeat = {
      verb: 'camera',
      move: 'follow',
      to: 'm',
      zoom: 1.25,
      t: 1,
      seconds: 0.8,
    };
    const v = await morphed(refs, [follow, MORPH]);
    expect((await v.camera(v.at(0.9))).scale).toBeLessThan(1.05);
    const cameras: Array<{ tx: number; ty: number; scale: number }> = [];
    for (const share of [0.3, 0.6, 0.9]) {
      const frame = v.at(MORPH.t + MORPH.seconds * share);
      cameras.push(await v.camera(frame));
      const bars = (await v.seek(
        frame,
        `return [...document.querySelectorAll('[data-element="m"] .mbar')]
           .filter((b) => Number(b.style.opacity) > 0.5)
           .map((b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });`,
      )) as Array<{ top: number; bottom: number }>;
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) {
        expect(bar.top).toBeGreaterThanOrEqual(media.y - 1);
        expect(bar.bottom).toBeLessThanOrEqual(media.y + media.height + 1);
      }
    }
    // Zoomed in, and moving with the lines: no two of these frames share a camera.
    for (const c of cameras) expect(c.scale).toBeCloseTo(1.25, 2);
    expect(new Set(cameras.map((c) => c.ty.toFixed(1))).size).toBe(3);
  });

  it('follows a long changed line only as far as the text column, where it ends', async () => {
    // A card narrow enough that, zoomed in, the camera can frame the line as it shows.
    const long = `  return '${'x'.repeat(80)}';`;
    const center = media.x + media.width / 2;
    const narrow = { x: center - 100, y: media.y, width: 200, height: media.height };
    const follow: DirectionBeat = {
      verb: 'camera',
      move: 'follow',
      to: 'm',
      zoom: 2.5,
      t: 1,
      seconds: 0.8,
    };
    const v = await morphed(
      [context('function take() {', 10), del('  return 1;', 11), add(long, 11), context('}', 12)],
      [follow, MORPH],
      narrow,
    );
    // Settled, before the camera lingers: from the line's start to the end of the text column.
    const { start, end } = (await v.seek(
      v.at(MORPH.t + MORPH.seconds + 0.2),
      `const live = document.querySelector('[data-element="m"] .mlive');
       const r = live.getBoundingClientRect();
       const font = Number.parseFloat(getComputedStyle(live).fontSize);
       const bar = document.querySelector('[data-element="m"] .mbar.add').getBoundingClientRect();
       return { start: bar.left, end: r.left + (live.offsetWidth - font) * (r.width / live.offsetWidth) };`,
    )) as { start: number; end: number };
    // The box it follows ends with the column, not with the tokens hidden past the ellipsis:
    // narrower than the view, it is centered, all of it in the region.
    expect((start + end) / 2).toBeCloseTo(center, 0);
    expect(start).toBeGreaterThan(media.x + 1);
    expect(end).toBeLessThan(media.x + media.width - 1);
    expect(v.errors).toEqual([]);
  });
});
