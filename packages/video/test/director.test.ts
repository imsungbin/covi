import { type EvidenceItem, indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { TRANSITION_MIN, TRANSITION_SHARE } from '../src/density.ts';
import {
  CODE_ZOOM,
  defaultDirection,
  entrances,
  mergeDirection,
} from '../src/direction/director.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const item = (
  id: string,
  kind: EvidenceItem['kind'],
  path: string,
  extra: Partial<EvidenceItem> = {},
): EvidenceItem => ({
  id,
  kind,
  path,
  revision: 'head',
  sha256: '0'.repeat(64),
  label: id,
  ...extra,
});
const evidence = indexEvidence({
  items: [
    item('diff-hunk:src/cart.ts:10', 'diff-hunk', 'diff.patch', {
      revision: 'both',
      location: { path: 'src/cart.ts', line: 10, endLine: 14, side: 'head' },
    }),
    item('screenshot:cart-after', 'screenshot', 'demo/screenshots/cart-after.png'),
    item('screenshot:cart-before', 'screenshot', 'demo/screenshots/cart-before.png', {
      revision: 'base',
    }),
    item('diff-hunk:src/total.ts:3', 'diff-hunk', 'diff.patch', {
      revision: 'both',
      location: { path: 'src/total.ts', line: 3, endLine: 6, side: 'head' },
    }),
    item('terminal:1', 'terminal', 'demo/demo.md', { label: 'npm test' }),
  ],
});
const scene = (id: string, visual: unknown, extra: Record<string, unknown> = {}): Scene =>
  SceneSchema.parse({ id, beat: id, narration: `Scene ${id} says one thing.`, visual, ...extra });
const callout = { kind: 'callout', title: 'C' };
const capture = { kind: 'screenshot', image: { path: 'demo/screenshots/cart-after.png' } };
const compare = {
  kind: 'before-after',
  before: { path: 'demo/screenshots/cart-before.png' },
  after: { path: 'demo/screenshots/cart-after.png' },
};
const code = {
  kind: 'code',
  path: 'src/cart.ts',
  lines: [
    { type: 'del', text: 'qty = qty - 1;', number: 10 },
    { type: 'add', text: 'qty = Math.max(0, qty - 1);', number: 10 },
  ],
  highlight: [1],
};
const kinds = (scenes: Scene[], seed = 0) =>
  defaultDirection({ scenes, evidence, seed }).shots.map((s) => s.enter);
/** How many moves the most frequent kind takes. */
const most = (moves: readonly string[]) =>
  Math.max(...[...new Set(moves)].map((kind) => moves.filter((k) => k === kind).length));

describe('the default director', () => {
  it('keeps every scene’s visual, and alternates pan and push from where the seed says', () => {
    const four = ['s1', 's2', 's3', 's4'].map((id) => scene(id, callout));
    const plan = defaultDirection({ scenes: four, evidence, seed: 0 });
    expect(plan).toMatchObject({ schemaVersion: 1, draft: true });
    for (const shot of plan.shots)
      expect(shot.elements).toEqual([{ id: 'visual', kind: 'visual' }]);
    expect(kinds(four, 0)).toEqual([undefined, 'pan', 'push', 'pan']);
    expect(kinds(four, 1)).toEqual([undefined, 'push', 'pan', 'push']);
  });

  it('zooms into the hero, wipes a before/after, and cuts to a scene showing the same capture', () => {
    const scenes = [
      scene('s1', callout),
      scene('s2', capture),
      scene('s3', capture),
      scene('s4', compare),
      scene('s5', callout, { hero: true }),
      scene('s6', callout),
    ];
    expect(kinds(scenes, 0)).toEqual([undefined, 'pan', 'cut', 'wipe', 'zoom', 'push']);
  });

  it('leaves a transition the storyboard chose, and lets an agent’s shot choose its own', () => {
    const scenes = [
      scene('s1', callout),
      scene('s2', callout, { transition: 'fade' }),
      scene('s3', callout),
    ];
    const drafted = defaultDirection({ scenes, evidence, seed: 0 });
    expect(drafted.shots[1]).not.toHaveProperty('enter');
    expect([...entrances(drafted, scenes, evidence, 0)]).toEqual([
      ['s2', 'fade'],
      ['s3', 'pan'],
    ]);
    const authored = DirectionSchema.parse({
      shots: [{ scene: 's3', enter: 'zoom', elements: [{ id: 'visual', kind: 'visual' }] }],
    });
    const merged = mergeDirection(authored, drafted);
    expect(merged.draft).toBe(false);
    expect(merged.shots.map((s) => s.scene).sort()).toEqual(['s1', 's2', 's3']);
    expect(entrances(merged, scenes, evidence, 0).get('s3')).toBe('zoom');
    // A draft the agent never rewrote is Covi's own: it is derived again.
    expect(mergeDirection({ ...authored, draft: true }, drafted)).toBe(drafted);
    expect(mergeDirection(undefined, drafted)).toBe(drafted);
  });

  it('zooms toward the lines a code scene highlights, as they light', () => {
    const pinned = scene('s2', code, {
      narration: 'The fix clamps the quantity at zero.',
      sync: { highlight1: 'clamps the quantity' },
    });
    const [, shot] = defaultDirection({
      scenes: [scene('s1', callout), pinned],
      evidence,
      seed: 0,
    }).shots;
    expect(shot!.beats).toEqual([
      { verb: 'camera', move: 'zoom', to: 'visual', zoom: CODE_ZOOM, at: 'clamps the quantity' },
    ]);
    const unpinned = defaultDirection({ scenes: [scene('s1', code)], evidence, seed: 0 }).shots[0]!;
    expect(unpinned.beats).toEqual([
      { verb: 'camera', move: 'zoom', to: 'visual', zoom: CODE_ZOOM },
    ]);
    // Captures already move their own camera inside their frame.
    expect(
      defaultDirection({ scenes: [scene('s1', capture)], evidence, seed: 0 }).shots[0]!.beats,
    ).toEqual([]);
  });

  it('reads what scenes show, never what they cite, so editing citations never moves a frame', () => {
    const scenes = [scene('s1', callout), scene('s2', callout), scene('s3', code)];
    const cited = scenes.map((s) => ({ ...s, evidenceIds: ['diff-hunk:src/cart.ts:10'] }));
    expect(defaultDirection({ scenes: cited, evidence, seed: 7 })).toEqual(
      defaultDirection({ scenes, evidence, seed: 7 }),
    );
  });

  it('is deterministic, and passes Covi’s own checks', () => {
    const scenes = [scene('s1', callout), scene('s2', code), scene('s3', capture, { hero: true })];
    const plan = defaultDirection({ scenes, evidence, seed: 3 });
    expect(defaultDirection({ scenes, evidence, seed: 3 })).toEqual(plan);
    expect(DirectionSchema.parse(plan)).toEqual(plan);
    expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
  });

  it('writes only what the direction schema reads back unchanged', () => {
    // A storyboard scene id has no length limit; a shot names one of at most `sceneIdChars`.
    const long = 'a'.repeat(DIRECTION_LIMITS.sceneIdChars + 1);
    const pinned = scene('s3', code, {
      narration: 'The fix clamps the quantity at zero.',
      sync: { highlight1: '  clamps the quantity ' },
    });
    const scenes = [scene('s1', callout), scene(long, callout), pinned];
    const plan = defaultDirection({ scenes, evidence, seed: 0 });
    expect(plan.shots.map((s) => [s.scene, s.enter])).toEqual([
      ['s1', undefined],
      ['s3', 'push'],
    ]);
    expect(plan.shots[1]!.beats).toMatchObject([{ at: 'clamps the quantity' }]);
    expect(DirectionSchema.parse(plan)).toEqual(plan);
    // The scene without a shot still enters by the rotation, which runs on through it.
    expect([...entrances(plan, scenes, evidence, 0)]).toEqual([
      [long, 'pan'],
      ['s3', 'push'],
    ]);
    expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
  });

  it('keeps a long, mixed story varied', () => {
    const scenes = [
      scene('s1', { kind: 'title', title: 'Cart quantity' }),
      scene('s2', { kind: 'screenshot', image: { path: 'demo/screenshots/cart-before.png' } }),
      scene('s3', code),
      scene('s4', {
        kind: 'code',
        path: 'src/cart.ts',
        lines: [{ type: 'context', text: 'return qty;', number: 12 }],
      }),
      scene('s5', { kind: 'terminal', command: 'npm test', output: '12 passed' }),
      scene('s6', capture, { hero: true }),
      scene('s7', { ...capture, label: 'After the fix' }),
      scene('s8', compare),
      scene('s9', {
        kind: 'code',
        path: 'src/total.ts',
        lines: [{ type: 'add', text: 'return Math.max(0, sum);', number: 4 }],
        highlight: [0],
      }),
      scene('s10', {
        kind: 'terminal',
        command: 'npm test',
        output: '12 passed',
        before: '1 failed',
      }),
      scene('s11', {
        kind: 'findings',
        findings: [{ title: 'Totals can still go negative', certainty: 'risk', severity: 'low' }],
      }),
      scene('s12', { kind: 'summary', verdict: 'looks-good', headline: 'Quantities stop at zero' }),
    ];
    // The same hunk and the same capture cut; the hero zooms and the compare wipes between them.
    expect(kinds(scenes, 0)).toEqual([
      undefined,
      'pan',
      'push',
      'cut',
      'pan',
      'zoom',
      'cut',
      'wipe',
      'push',
      'pan',
      'push',
      'pan',
    ]);
    for (const seed of [0, 1, 2, 3]) {
      const plan = defaultDirection({ scenes, evidence, seed });
      expect(DirectionSchema.parse(plan)).toEqual(plan);
      expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
      const moves = [...entrances(plan, scenes, evidence, seed).values()];
      expect(moves.length).toBeGreaterThanOrEqual(TRANSITION_MIN);
      expect(most(moves) / moves.length).toBeLessThanOrEqual(TRANSITION_SHARE);
    }
  });

  it('gives pan and push half of a plain story each, the odd move to the one that starts', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => scene(`s${i + 1}`, callout));
    for (const seed of [0, 1]) {
      const moves = [
        ...entrances(
          defaultDirection({ scenes: twelve, evidence, seed }),
          twelve,
          evidence,
          seed,
        ).values(),
      ];
      expect(moves).toHaveLength(11);
      expect(new Set(moves)).toEqual(new Set(['pan', 'push']));
      expect(most(moves)).toBe(Math.ceil(moves.length / 2));
      expect(moves.filter((k) => k === (seed % 2 === 0 ? 'pan' : 'push'))).toHaveLength(6);
      expect(most(moves) / moves.length).toBeLessThanOrEqual(TRANSITION_SHARE);
    }
  });
});
