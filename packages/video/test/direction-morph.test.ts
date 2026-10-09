import { buildEvidence, DEFAULT_CONFIG, type Hunk, indexEvidence, Redactor } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { directionProblems } from '../src/direction/refs.ts';
import { BEAT_SECONDS, resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor } from '../src/timeline/build.ts';
import type { SceneStaging } from '../src/timeline/types.ts';

// A run with three hunks: a replaced line holding a secret (outside any string, so its tokens
// would split it), a new file, and more added lines than a morph shows.
const SECRET = 'hunter2-shh-secret';
const replaced: Hunk = {
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 3,
  lines: [
    { kind: 'context', text: 'function build(docs) {', oldLine: 10, newLine: 10 },
    { kind: 'del', text: `  return send(docs, ${SECRET});`, oldLine: 11 },
    { kind: 'add', text: '  return send(docs.map((d) => d.id));', newLine: 11 },
    { kind: 'context', text: '}', oldLine: 12, newLine: 12 },
  ],
};
const created: Hunk = {
  oldStart: 0,
  oldLines: 0,
  newStart: 1,
  newLines: 2,
  lines: [
    { kind: 'add', text: 'export const a = 1;', newLine: 1 },
    { kind: 'add', text: 'export const b = 2;', newLine: 2 },
  ],
};
const sprawling: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 14,
  lines: [
    { kind: 'context', text: 'start();', oldLine: 1, newLine: 1 },
    ...Array.from({ length: 13 }, (_, i) => ({
      kind: 'add' as const,
      text: `step${i}();`,
      newLine: i + 2,
    })),
  ],
};
const files = [
  { path: 'src/request.js', language: 'javascript', hunks: [replaced] },
  { path: 'src/new.js', language: 'javascript', hunks: [created] },
  { path: 'src/big.js', language: 'javascript', hunks: [sprawling] },
];
const evidence = indexEvidence(buildEvidence({ diff: files }));
const sources = directionSources({ files, evidence });
const scene = (id: string, narration: string): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual: { kind: 'callout', title: id } });
const scenes = [
  scene('s1', 'The request carried every document.'),
  scene('s2', 'Now it sends only the ids, and the reader fetches each one.'),
];
const morph = (extra: Record<string, unknown> = {}) => ({
  id: 'req',
  kind: 'morph' as const,
  evidence: 'diff-hunk:src/request.js:10',
  ...extra,
});
const problems = (shot: Record<string, unknown>) =>
  directionProblems(
    DirectionSchema.parse({ shots: [{ scene: 's2', ...shot }] }),
    scenes,
    evidence,
    sources,
  );

describe('a morph in the direction file', () => {
  it('takes a diff-hunk and a morph beat, and nothing else', () => {
    const parsed = DirectionSchema.safeParse({
      shots: [
        {
          scene: 's2',
          elements: [morph()],
          beats: [
            { verb: 'camera', move: 'follow', to: 'req' },
            { verb: 'morph', element: 'req', at: 'only the ids' },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    for (const extra of [{ side: 'head' }, { lines: [1, 2] }, { text: 'x' }, { style: 'pop' }])
      expect(
        DirectionSchema.safeParse({ shots: [{ scene: 's2', elements: [morph(extra)] }] }).success,
      ).toBe(false);
    expect(
      DirectionSchema.safeParse({
        shots: [
          {
            scene: 's2',
            elements: [morph()],
            beats: [{ verb: 'morph', element: 'req', style: 'pop' }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('is checked against the run: a hunk that can morph, and a beat on a morph', () => {
    expect(
      problems({
        elements: [morph()],
        beats: [{ verb: 'morph', element: 'req', at: 'only the ids' }],
      }),
    ).toEqual([]);
    expect(
      problems({
        elements: [
          { id: 'new', kind: 'morph', evidence: 'diff-hunk:src/new.js:1' },
          { id: 'big', kind: 'morph', evidence: 'diff-hunk:src/big.js:1' },
          { id: 'run', kind: 'morph', evidence: 'terminal:1' },
          { id: 'note', kind: 'label', text: 'Ids only' },
        ],
        beats: [
          { verb: 'morph', element: 'note' },
          { verb: 'morph', element: 'big' },
          { verb: 'morph', element: 'big' },
        ],
      }),
    ).toEqual([
      'shot 1 (scene s2), element new: the hunk has no lines before the change (a new file); show it as code',
      'shot 1 (scene s2), element big: the hunk changes 13 lines on its head side, and a morph shows at most 12; show it as code, with `lines`',
      'shot 1 (scene s2), element run: cites "terminal:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 1 (scene s2), beat 1 (morph): morph acts on a morph element, and "note" is a label',
      'shot 1 (scene s2), beat 3 (morph): "big" already morphs at an earlier beat; it morphs once',
    ]);
  });

  it('names a missing element once per beat, and only that', () => {
    expect(
      problems({
        elements: [morph()],
        beats: [
          { verb: 'morph', element: 'ghost' },
          { verb: 'morph', element: 'ghost' },
        ],
      }),
    ).toEqual([
      'shot 1 (scene s2), beat 1 (morph): the shot has no element "ghost" (it has: req)',
      'shot 1 (scene s2), beat 2 (morph): the shot has no element "ghost" (it has: req)',
    ]);
  });

  it('refuses a hunk the run no longer has, echoing its id escaped', () => {
    // A repository names its files: an escape in a path reaches the id, and must not reach the
    // terminal raw.
    const path = 'src/\u001b[31mred.js';
    const id = `diff-hunk:${path}:10`;
    const ran = indexEvidence(buildEvidence({ diff: [{ path, hunks: [replaced] }] }));
    const edited: Hunk = { ...replaced, lines: replaced.lines.slice(0, 3) };
    const [problem, ...rest] = directionProblems(
      DirectionSchema.parse({
        shots: [{ scene: 's2', elements: [{ id: 'req', kind: 'morph', evidence: id }] }],
      }),
      scenes,
      ran,
      directionSources({ files: [{ path, hunks: [edited] }], evidence: ran }),
    );
    expect(rest).toEqual([]);
    expect(problem).toBe(
      'shot 1 (scene s2), element req: Covi cannot find hunk "diff-hunk:src/\\u001b[31mred.js:10" in the run\'s diff',
    );
  });
});

describe('resolving a morph', () => {
  const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  const redactor = new Redactor({ literals: [SECRET] });
  const resolve = (shot: DirectionInput['shots'][number], language: 'en' | 'ko' = 'en') =>
    resolveDirection({
      plan: DirectionSchema.parse({ shots: [shot] }),
      scenes,
      layout,
      spec,
      language,
      sources,
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (value) => redactor.redactDeep(value),
    });
  const element = (staging: SceneStaging[]) => {
    const e = staging[1]!.direction.elements[0]!;
    if (e.kind !== 'morph') throw new Error(`expected a morph, got ${e.kind}`);
    return e;
  };

  it('draws the hunk before and after, with what stays between them', () => {
    const staging = resolve({ scene: 's2', elements: [morph()], beats: [] });
    const { morph: m } = element(staging);
    expect(m).toMatchObject({ path: 'src/request.js', language: 'javascript' });
    expect(m.base.map((r) => r.type)).toEqual(['context', 'del', 'context']);
    expect(m.head.map((r) => r.type)).toEqual(['context', 'add', 'context']);
    expect(m.rows).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    // `return send(docs` and the closing `);` stay and travel; the rest of the line is replaced.
    const stays = m.tokens.filter(([b]) => b === 1).map(([, i]) => m.base[1]!.tokens[i]!.text);
    expect(stays.join('')).toBe('returnsend(docs);');
  });

  it('redacts each line whole before splitting it, so a secret never survives in pieces', () => {
    const staging = resolve({ scene: 's2', elements: [morph()], beats: [] });
    const text = JSON.stringify(staging);
    for (const piece of ['hunter2', 'shh-secret', SECRET]) expect(text).not.toContain(piece);
    expect(
      element(staging)
        .morph.base[1]!.tokens.map((t) => t.text)
        .join(''),
    ).toBe('  return send(docs, [REDACTED]);');
  });

  it('morphs on its phrase, or where an implicit beat spreads it when no beat names it', () => {
    const pinned = resolve({
      scene: 's2',
      elements: [morph()],
      beats: [
        { verb: 'camera', move: 'follow', to: 'req' },
        { verb: 'morph', element: 'req', at: 'only the ids' },
      ],
    })[1]!.direction.beats;
    expect(pinned.map((b) => b.verb).sort()).toEqual(['camera', 'morph']);
    const beat = pinned.find((b) => b.verb === 'morph')!;
    expect(beat).toMatchObject({ element: 'req', seconds: BEAT_SECONDS.morph });
    const implicit = resolve({ scene: 's2', elements: [morph()], beats: [] })[1]!.direction.beats;
    expect(implicit).toEqual([
      expect.objectContaining({ verb: 'morph', element: 'req', seconds: BEAT_SECONDS.morph }),
    ]);
  });

  it('waits for its element to be in place before it morphs, as the camera does', () => {
    const beats = resolve({
      scene: 's2',
      elements: [morph()],
      beats: [
        { verb: 'morph', element: 'req', at: 'Now it sends' },
        { verb: 'reveal', element: 'req', at: 'the reader fetches' },
      ],
    })[1]!.direction.beats;
    const reveal = beats.find((b) => b.verb === 'reveal')!;
    const morphed = beats.find((b) => b.verb === 'morph')!;
    expect(morphed.t).toBeCloseTo(reveal.t + reveal.seconds, 3);
    expect(beats.map((b) => b.verb)).toEqual(['reveal', 'morph']);
  });

  it('keeps 14 rows a side on a wide frame and 18 on a tall one', () => {
    const tall: Hunk = {
      oldStart: 1,
      oldLines: 20,
      newStart: 1,
      newLines: 20,
      lines: [
        ...Array.from({ length: 10 }, (_, i) => ({
          kind: 'context' as const,
          text: `before${i}();`,
          oldLine: i + 1,
          newLine: i + 1,
        })),
        { kind: 'del' as const, text: 'old();', oldLine: 11 },
        { kind: 'add' as const, text: 'fresh();', newLine: 11 },
        ...Array.from({ length: 10 }, (_, i) => ({
          kind: 'context' as const,
          text: `after${i}();`,
          oldLine: i + 12,
          newLine: i + 12,
        })),
      ],
    };
    const tallFiles = [{ path: 'a.js', hunks: [tall] }];
    const tallEvidence = indexEvidence(buildEvidence({ diff: tallFiles }));
    const rows = (width: number, height: number) => {
      const frame = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'custom', width, height });
      const [, staged] = resolveDirection({
        plan: DirectionSchema.parse({
          shots: [
            { scene: 's2', elements: [{ id: 'm', kind: 'morph', evidence: 'diff-hunk:a.js:1' }] },
          ],
        }),
        scenes,
        layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(frame)),
        spec: frame,
        language: 'en',
        sources: directionSources({ files: tallFiles, evidence: tallEvidence }),
        image: () => ({ src: '', width: 1, height: 1 }),
        seed: 5,
        redact: (value) => value,
      });
      const e = staged!.direction.elements[0]!;
      if (e.kind !== 'morph') throw new Error(`expected a morph, got ${e.kind}`);
      return e.morph.head.length;
    };
    expect(rows(1920, 1080)).toBe(14);
    expect(rows(1080, 1920)).toBe(18);
  });

  it('says what an elided run hides in the video’s language', () => {
    const long: Hunk = {
      oldStart: 1,
      oldLines: 6,
      newStart: 1,
      newLines: 18,
      lines: [
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'add' as const,
          text: `a${i}();`,
          newLine: i + 1,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'context' as const,
          text: `m${i}`,
          oldLine: i + 1,
          newLine: i + 7,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'add' as const,
          text: `b${i}();`,
          newLine: i + 13,
        })),
      ],
    };
    const longFiles = [{ path: 'a.js', hunks: [long] }];
    const longEvidence = indexEvidence(buildEvidence({ diff: longFiles }));
    const at = (language: 'en' | 'ko') =>
      resolveDirection({
        plan: DirectionSchema.parse({
          shots: [
            { scene: 's2', elements: [{ id: 'm', kind: 'morph', evidence: 'diff-hunk:a.js:1' }] },
          ],
        }),
        scenes,
        layout,
        spec,
        language,
        sources: directionSources({ files: longFiles, evidence: longEvidence }),
        image: () => ({ src: '', width: 1, height: 1 }),
        seed: 5,
        redact: (value) => value,
      });
    const markers = (language: 'en' | 'ko') =>
      element(at(language)).morph.head.flatMap((r) =>
        r.type === 'elided' ? [r.tokens[0]!.text] : [],
      );
    expect(markers('en')).toEqual(['… 5 lines']);
    expect(markers('ko')).toEqual(['… 5줄']);
  });
});
