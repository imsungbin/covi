import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiffLine, resolveConfig } from '@covi/core';
import {
  buildTimeline,
  type DirectionBeat,
  type LayoutReport,
  layoutScenes,
  pacingFor,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { morphHunk } from '../../packages/video/src/direction/tokens.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
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
const { media } = computeRegions({ width: W, height: H, orientation: 'landscape' });
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
 * scene started), opened in Chromium.
 */
async function morphed(lines: DiffLine[], beats: DirectionBeat[] = [MORPH]) {
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
            rect: media,
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
  /** The morph's tokens at a frame: what each is, its place in the card, its fold, its opacity. */
  const pieces = (frame: number) =>
    seek(
      frame,
      `return [...document.querySelectorAll('[data-element="m"] .mlive [data-token]')].map((n) => {
         const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)(?: scaleY\\(([\\d.]+)\\))?/.exec(n.style.transform);
         return { token: n.dataset.token, text: n.textContent, x: Number(m[1]), y: Number(m[2]),
           fold: m[3] === undefined ? 1 : Number(m[3]), opacity: Number(n.style.opacity || '1') };
       });`,
    ) as Promise<
      Array<{ token: string; text: string; x: number; y: number; fold: number; opacity: number }>
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
  return { timeline, at, seek, pieces, camera, report, shot, errors };
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
    expect(card.font).toBeGreaterThan(0);
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
});
