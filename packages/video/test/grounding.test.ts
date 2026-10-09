import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type EvidenceItem,
  type Explanation,
  indexEvidence,
  parseConfigInput,
  Redactor,
  resolveConfig,
} from '@covi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { writeComposition } from '../src/composition/build.ts';
import { DirectionSchema } from '../src/direction/schema.ts';
import {
  groundingCheck,
  sceneEvidence,
  unknownSceneEvidence,
  visualImages,
} from '../src/grounding.ts';
import { withCheck } from '../src/qc.ts';
import { framesKey } from '../src/render/renderer.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema, VisualSchema } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes } from '../src/timeline/build.ts';

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
const index = indexEvidence({
  items: [
    item('diff-hunk:src/cart.ts:10', 'diff-hunk', 'diff.patch', {
      revision: 'both',
      label: 'src/cart.ts:10-14',
      location: { path: 'src/cart.ts', line: 10, endLine: 14, side: 'head' },
    }),
    item(
      'screenshot:cart-desktop-before',
      'screenshot',
      'demo/screenshots/cart-desktop-before.png',
      { revision: 'base' },
    ),
    item('screenshot:cart-desktop-after', 'screenshot', 'demo/screenshots/cart-desktop-after.png'),
    item('http:1', 'http', 'demo/captures.json', { label: 'GET /api/cart' }),
    item('terminal:1', 'terminal', 'demo/captures.json', { label: 'node cli.js --help' }),
  ],
});
const visual = (v: unknown) => VisualSchema.parse(v);
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('scene evidence', () => {
  it('cites what a scene shows from the run', () => {
    expect(
      sceneEvidence(
        {
          visual: visual({
            kind: 'code',
            path: 'src/cart.ts',
            lines: [{ type: 'add', text: 'x', number: 12 }],
          }),
        },
        index,
      ),
    ).toEqual(['diff-hunk:src/cart.ts:10']);
    expect(
      sceneEvidence(
        {
          visual: visual({
            kind: 'before-after',
            before: { path: 'demo/screenshots/cart-desktop-before.png' },
            after: { path: 'demo/screenshots/cart-desktop-after.png' },
          }),
        },
        index,
      ),
    ).toEqual(['screenshot:cart-desktop-before', 'screenshot:cart-desktop-after']);
    expect(
      sceneEvidence(
        {
          visual: visual({
            kind: 'api',
            method: 'GET',
            path: '/api/cart',
            after: { status: 200, body: '{}' },
          }),
        },
        index,
      ),
    ).toEqual(['http:1']);
    expect(
      sceneEvidence(
        { visual: visual({ kind: 'terminal', command: 'node cli.js --help', output: 'x' }) },
        index,
      ),
    ).toEqual(['terminal:1']);
    expect(
      sceneEvidence(
        {
          visual: visual({
            kind: 'findings',
            findings: [{ title: 'Negative totals', certainty: 'likely', severity: 'high' }],
          }),
        },
        index,
        [{ title: 'Negative totals', evidenceIds: ['diff-hunk:src/cart.ts:10'] }],
      ),
    ).toEqual(['diff-hunk:src/cart.ts:10']);
    expect(
      sceneEvidence({ visual: visual({ kind: 'callout', title: 'Worth checking' }) }, index),
    ).toEqual([]);
    // What the author cites comes first, without repeats.
    expect(
      sceneEvidence(
        {
          evidenceIds: ['http:1', 'screenshot:cart-desktop-after'],
          visual: visual({
            kind: 'screenshot',
            image: { path: 'demo/screenshots/cart-desktop-after.png' },
          }),
        },
        index,
      ),
    ).toEqual(['http:1', 'screenshot:cart-desktop-after']);
  });

  it('counts what a shot shows: its elements’ evidence, and the visual only when the shot keeps it', () => {
    const scene = {
      visual: visual({
        kind: 'screenshot',
        image: { path: 'demo/screenshots/cart-desktop-after.png' },
      }),
    };
    const shot = (elements: unknown[]) =>
      DirectionSchema.parse({ shots: [{ scene: 's1', elements }] }).shots[0]!;
    expect(
      sceneEvidence(
        scene,
        index,
        [],
        shot([
          { id: 'v', kind: 'visual' },
          { id: 'c', kind: 'code', evidence: 'diff-hunk:src/cart.ts:10' },
        ]),
      ),
    ).toEqual(['screenshot:cart-desktop-after', 'diff-hunk:src/cart.ts:10']);
    // A shot without the visual replaces it: the capture is not on screen.
    expect(
      sceneEvidence(
        scene,
        index,
        [],
        shot([
          { id: 'o', kind: 'output', evidence: 'terminal:1' },
          { id: 'n', kind: 'node', label: 'Cart', evidence: ['http:1', 'not-in-the-run:1'] },
        ]),
      ),
    ).toEqual(['terminal:1', 'http:1']);
    // Citations always count.
    expect(
      sceneEvidence(
        { ...scene, evidenceIds: ['http:1'] },
        index,
        [],
        shot([{ id: 'l', kind: 'label', text: 'Cart' }]),
      ),
    ).toEqual(['http:1']);
  });

  it('cites only the ids a findings card has in the run, looked up after its redaction', () => {
    // Rule findings compute hunk ids from the raw change; the registry holds them redacted.
    const secret = 'hunter2-secret-path';
    const redactor = new Redactor({ literals: [secret] });
    const raw = `diff-hunk:src/${secret}.ts:1`;
    const registry = {
      items: [item(redactor.redact(raw), 'diff-hunk', 'diff.patch', { revision: 'both' })],
    };
    const card = {
      visual: visual({
        kind: 'findings',
        findings: [{ title: 'Leak', certainty: 'likely', severity: 'high' }],
      }),
    };
    const findings = [{ title: 'Leak', evidenceIds: [raw, 'trace:gone-head'] }];
    expect(
      sceneEvidence(
        card,
        indexEvidence(registry, (t) => redactor.redact(t)),
        findings,
      ),
    ).toEqual([raw]);
    // Without the run's redaction the raw id names nothing, so the card would cite nothing.
    expect(sceneEvidence(card, indexEvidence(registry), findings)).toEqual([]);
  });

  it('finds images wherever a visual keeps them, and never a code path', () => {
    expect(
      visualImages(
        visual({
          kind: 'interaction',
          steps: [{ image: { path: 'a.png' } }, { image: { path: 'b.png' } }],
        }),
      ),
    ).toEqual(['a.png', 'b.png']);
    expect(
      visualImages(
        visual({ kind: 'code', path: 'src/cart.ts', lines: [{ type: 'add', text: 'x' }] }),
      ),
    ).toEqual([]);
    expect(
      visualImages(
        visual({
          kind: 'api',
          method: 'GET',
          path: '/api/cart',
          after: { status: 200, body: '{}' },
        }),
      ),
    ).toEqual([]);
  });

  it('accepts evidenceIds on a scene', () => {
    expect(
      SceneSchema.safeParse({
        beat: 'fix',
        narration: 'x',
        visual: { kind: 'callout', title: 'C' },
        evidenceIds: ['diff-hunk:src/cart.ts:10'],
      }).success,
    ).toBe(true);
  });

  it('rejects storyboard citations the run does not have, naming the scene', () => {
    expect(
      unknownSceneEvidence(
        [{ id: 'hook', evidenceIds: ['trace:nope', 'http:1'] }, { evidenceIds: ['http:2'] }],
        index,
      ),
    ).toEqual(['scene hook: trace:nope', 'scene s2: http:2']);
  });
});

describe('grounding check', () => {
  // An intent that cites nothing is listed too (ungroundedStatements), so this one cites a hunk.
  const explanation = {
    intent: { evidenceIds: ['diff-hunk:src/cart.ts:10'] },
    changes: [{ area: 'Cart', description: 'd', files: [] }],
  } as unknown as Explanation;

  it('warns about claims with nothing behind them, never about framing', () => {
    const check = groundingCheck(
      [
        { id: 's1', narration: 'Totals went negative?', kind: 'title' },
        {
          id: 's2',
          narration: 'The fix clamps it.',
          kind: 'code',
          evidenceIds: ['diff-hunk:src/cart.ts:10'],
        },
        { id: 's3', narration: 'It might break checkout.', kind: 'callout' },
        { id: 's4', narration: '', kind: 'callout' },
        { id: 's5', narration: 'Ready to merge.', kind: 'summary' },
      ],
      explanation,
    );
    expect(check).toMatchObject({ id: 'grounding', status: 'warn' });
    expect(check.message).toContain('scene s3');
    expect(check.message).toContain('changes[0] (Cart)');
    expect(check.message).not.toMatch(/s1|s4|s5/);
  });

  it('lists an explanation intent that cites nothing', () => {
    const uncited = { intent: {}, changes: [] } as unknown as Explanation;
    expect(groundingCheck([], uncited).message).toContain('explanation intent');
  });

  it('passes when every claim cites evidence', () => {
    expect(
      groundingCheck([{ id: 's2', narration: 'x', kind: 'code', evidenceIds: ['a'] }]).status,
    ).toBe('pass');
  });

  it('keeps the report status in step with an added check', () => {
    const report = { status: 'pass' as const, checks: [], measured: {} };
    expect(withCheck(report, { id: 'grounding', status: 'warn', message: 'm' }).status).toBe(
      'warn',
    );
    const failing = {
      status: 'fail' as const,
      checks: [{ id: 'format', status: 'fail' as const, message: 'm' }],
      measured: {},
    };
    expect(withCheck(failing, { id: 'grounding', status: 'warn', message: 'm' })).toMatchObject({
      status: 'fail',
      checks: [{ id: 'format' }, { id: 'grounding' }],
    });
  });
});

describe('timeline evidence', () => {
  it('records the evidence each scene rests on', () => {
    const spec = resolveVideoSpec(
      resolveConfig([{ name: 'repository', values: parseConfigInput({}, 't') }]).config,
      { mode: 'short' },
    );
    const scenes = [
      { id: 's1', beat: 's1', narration: 'Hook.', visual: { kind: 'title', title: 'T', meta: [] } },
      {
        id: 's2',
        beat: 's2',
        narration: 'Fix.',
        visual: { kind: 'callout', tone: 'info', title: 'C' },
        evidenceIds: ['diff-hunk:src/cart.ts:10'],
      },
    ] as Scene[];
    const timeline = buildTimeline({
      title: 'x',
      scenes,
      layout: layoutScenes(scenes, new Map()),
      spec,
      image: () => ({ src: '', width: 1, height: 1 }),
    });
    expect(timeline.scenes.map((s) => s.evidenceIds)).toEqual([
      undefined,
      ['diff-hunk:src/cart.ts:10'],
    ]);
  });

  it('leaves the frames key alone: new citations alone do not render the video again', async () => {
    const spec = resolveVideoSpec(
      resolveConfig([{ name: 'repository', values: parseConfigInput({}, 't') }]).config,
      { mode: 'short' },
    );
    const keyFor = async (evidenceIds?: string[]) => {
      const scenes = [
        {
          id: 's1',
          beat: 's1',
          narration: 'Fix.',
          visual: { kind: 'callout', tone: 'info', title: 'C' },
          evidenceIds,
        },
      ] as Scene[];
      const timeline = buildTimeline({
        title: 'x',
        scenes,
        layout: layoutScenes(scenes, new Map()),
        spec,
        image: () => ({ src: '', width: 1, height: 1 }),
      });
      const dir = mkdtempSync(join(tmpdir(), 'covi-grounding-'));
      dirs.push(dir);
      await writeComposition(dir, timeline, new Map());
      return framesKey(dir);
    };
    const key = await keyFor(['diff-hunk:src/cart.ts:10']);
    expect(await keyFor(['http:1', 'screenshot:cart-desktop-after'])).toBe(key);
    expect(await keyFor()).toBe(key);
  });
});
