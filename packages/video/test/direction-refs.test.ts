import { buildEvidence, type Demonstration, type Hunk, indexEvidence, parseDiff } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { type DirectedScene, directionProblems } from '../src/direction/refs.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { diffFiles, directionSources, hunkView } from '../src/direction/sources.ts';

const hunk: Hunk = {
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 3,
  lines: [
    { kind: 'context', text: 'function build(docs) {', oldLine: 10, newLine: 10 },
    { kind: 'del', text: '  return { docs };', oldLine: 11 },
    { kind: 'add', text: '  return { ids: docs.map((d) => d.id) };', newLine: 11 },
    { kind: 'context', text: '}', oldLine: 12, newLine: 12 },
  ],
};
const deleteOnly: Hunk = {
  oldStart: 40,
  oldLines: 1,
  newStart: 39,
  newLines: 0,
  lines: [{ kind: 'del', text: 'legacy();', oldLine: 40 }],
};
const files = [{ path: 'src/request.js', language: 'javascript', hunks: [hunk, deleteOnly] }];
const demo = {
  commands: [
    {
      name: 'measure',
      command: 'node scripts/measure.js',
      before: { exitCode: 0, output: 'request bytes: 120000' },
      after: { exitCode: 0, output: 'request bytes: 9000' },
      changed: true,
    },
    {
      name: 'version',
      command: 'node -v',
      after: { exitCode: 0, output: 'v22' },
      changed: false,
    },
  ],
  shots: [
    {
      id: 'home',
      kind: 'page',
      name: '/',
      viewport: 'mobile',
      after: { path: 'demo/screenshots/home-after.png' },
    },
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
const scenes: DirectedScene[] = [
  { id: 's1', narration: 'The request carried every document.', visual: { kind: 'callout' } },
  {
    id: 's2',
    narration: 'Now it sends [[only the ids]], and the ids are small.',
    visual: { kind: 'code' },
  },
];
const problems = (direction: DirectionInput) =>
  directionProblems(DirectionSchema.parse(direction), scenes, evidence, sources);

describe('evidence sources', () => {
  it('find a hunk, a command, and a capture by the ids the registry wrote', () => {
    expect(sources.hunk('diff-hunk:src/request.js:10')).toMatchObject({
      path: 'src/request.js',
      language: 'javascript',
    });
    expect(sources.command('terminal:1')).toEqual({
      name: 'measure',
      command: 'node scripts/measure.js',
      output: 'request bytes: 9000',
      before: 'request bytes: 120000',
    });
    expect(sources.command('terminal:2')).not.toHaveProperty('before');
    expect(sources.capture('screenshot:home-after')).toEqual({
      path: 'demo/screenshots/home-after.png',
      device: 'mobile',
    });
    // Wrong kinds find nothing.
    expect(sources.hunk('terminal:1')).toBeUndefined();
    expect(sources.command('diff-hunk:src/request.js:10')).toBeUndefined();
    expect(sources.capture('terminal:1')).toBeUndefined();
  });

  it('show a hunk from either side, or both', () => {
    expect(hunkView(hunk.lines, 'head').map((l) => l.kind)).toEqual(['context', 'add', 'context']);
    expect(hunkView(hunk.lines, 'base').map((l) => l.kind)).toEqual(['context', 'del', 'context']);
    expect(hunkView(hunk.lines, 'diff')).toHaveLength(4);
  });

  it('read the app start-up log for terminal:app-start ids', () => {
    const withLog = indexEvidence(
      buildEvidence({
        fileSha: (path) => (path === 'demo/app-head.log' ? '1'.repeat(64) : undefined),
      }),
    );
    const logged = directionSources({ evidence: withLog, appLogs: { head: 'EADDRINUSE :3000' } });
    expect(logged.command('terminal:app-start-head')).toEqual({
      name: 'app-start · head',
      command: '',
      output: 'EADDRINUSE :3000',
    });
  });

  it("show only the lines the evidence hashed: the run's diff, not a change read again", () => {
    // The run wrote its diff redacted; a change read again from git holds the secret.
    const raw: Hunk = {
      ...hunk,
      lines: hunk.lines.map((l) =>
        l.kind === 'add' ? { ...l, text: '  return { ids, token: "hunter2-shh" };' } : l,
      ),
    };
    const written: Hunk = {
      ...raw,
      lines: raw.lines.map((l) => ({ ...l, text: l.text.replace('hunter2-shh', '[REDACTED]') })),
    };
    const ran = indexEvidence(
      buildEvidence({ diff: [{ path: 'src/request.js', hunks: [written] }] }),
    );
    const id = 'diff-hunk:src/request.js:10';
    expect(
      directionSources({ files: [{ path: 'src/request.js', hunks: [raw] }], evidence: ran }).hunk(
        id,
      ),
    ).toBeUndefined();
    expect(
      directionSources({
        files: [{ path: 'src/request.js', hunks: [written] }],
        evidence: ran,
      }).hunk(id)?.lines,
    ).toEqual(written.lines);
    expect(
      directionProblems(
        DirectionSchema.parse({
          shots: [{ scene: 's1', elements: [{ id: 'c', kind: 'code', evidence: id }] }],
        }),
        scenes,
        ran,
        directionSources({ files: [{ path: 'src/request.js', hunks: [raw] }], evidence: ran }),
      ),
    ).toEqual([`shot 1 (scene s1), element c: Covi cannot find hunk "${id}" in the run's diff`]);
  });

  it("read the run's diff.patch, with each file's language from the change", () => {
    const patch = [
      'diff --git a/src/request.js b/src/request.js',
      '--- a/src/request.js',
      '+++ b/src/request.js',
      '@@ -10,3 +10,3 @@ function build(docs) {',
      ' function build(docs) {',
      '-  return { docs };',
      '+  return { ids: docs.map((d) => d.id) };',
      ' }',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-Old',
      '+New',
      '',
    ].join('\n');
    const read = diffFiles(patch, [{ path: 'src/request.js', language: 'javascript' }]);
    expect(read.map((f) => [f.path, f.language])).toEqual([
      ['src/request.js', 'javascript'],
      ['README.md', undefined],
    ]);
    expect(read[1]).not.toHaveProperty('language');
    const ran = indexEvidence(buildEvidence({ diff: parseDiff(patch) }));
    const found = directionSources({ files: read, evidence: ran }).hunk(
      'diff-hunk:src/request.js:10',
    );
    expect(found?.language).toBe('javascript');
    expect(hunkView(found!.lines, 'head').map((l) => l.text)).toEqual([
      'function build(docs) {',
      '  return { ids: docs.map((d) => d.id) };',
      '}',
    ]);
  });

  it('look ids up by value, never through an object prototype', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'terminal:0', 'terminal:constructor'])
      expect([sources.hunk(id), sources.command(id), sources.capture(id)], id).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
  });
});

describe('direction references', () => {
  it('accept a direction that names real scenes, elements, evidence, and phrases', () => {
    expect(
      problems({
        shots: [
          {
            scene: 's2',
            elements: [
              { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:10', lines: [1, 3] },
              { id: 'out', kind: 'output', evidence: 'terminal:1', side: 'base' },
              { id: 'page', kind: 'capture', evidence: 'screenshot:home-after' },
              { id: 'n', kind: 'node', label: 'Reader', evidence: ['terminal:2'] },
            ],
            beats: [
              { verb: 'reveal', element: 'out', at: 'only the ids' },
              { verb: 'camera', move: 'zoom', to: 'req' },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('name the shot, element, and beat of every problem, all at once', () => {
    const found = problems({
      shots: [
        { scene: 's9', elements: [{ id: 'v', kind: 'visual' }] },
        {
          scene: 's1',
          layout: 'single',
          elements: [
            { id: 'a', kind: 'visual' },
            { id: 'a', kind: 'label', text: 'Twice' },
          ],
        },
        { scene: 's1', elements: [{ id: 'v', kind: 'visual' }] },
        {
          scene: 's2',
          elements: [
            { id: 'c', kind: 'code', evidence: 'diff-hunk:nope.js:1' },
            { id: 'd', kind: 'code', evidence: 'terminal:1' },
            { id: 'e', kind: 'code', evidence: 'diff-hunk:src/request.js:39' },
            { id: 'f', kind: 'code', evidence: 'diff-hunk:src/request.js:10', lines: [2, 4] },
            { id: 'g', kind: 'output', evidence: 'terminal:2', side: 'base' },
            { id: 'h', kind: 'capture', evidence: 'diff-hunk:src/request.js:10' },
            { id: 'i', kind: 'node', label: 'Reader', evidence: ['made-up:1'] },
          ],
          beats: [
            { verb: 'reveal', element: 'zz' },
            { verb: 'camera', move: 'pan', to: 'c', at: 'not in the line' },
            { verb: 'reveal', element: 'c', at: 'the ids' },
          ],
        },
      ],
    });
    expect(found).toEqual([
      'shot 1 (scene s9): the storyboard has no scene "s9" (it has: s1, s2)',
      'shot 2 (scene s1): layout "single" shows one element, and the shot has 2',
      'shot 2 (scene s1): element id "a" is used twice',
      'shot 3 (scene s1): scene s1 already has a shot; give each scene at most one',
      'shot 4 (scene s2), element c: cites "diff-hunk:nope.js:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 4 (scene s2), element d: a code element shows a diff-hunk: item, and "terminal:1" is a terminal',
      'shot 4 (scene s2), element e: the hunk has no head lines; show side "base" or "diff"',
      'shot 4 (scene s2), element f: lines [2, 4] run past the 3 lines of its head side',
      'shot 4 (scene s2), element g: side "base": "terminal:2" ran only after the change',
      'shot 4 (scene s2), element h: a capture element shows a screenshot: item, and "diff-hunk:src/request.js:10" is a diff-hunk',
      'shot 4 (scene s2), element i: cites "made-up:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 4 (scene s2), beat 1 (reveal): the shot has no element "zz" (it has: c, d, e, f, g, h, i)',
      'shot 4 (scene s2), beat 2 (camera) quotes "not in the line", which is not in the scene\'s narration',
      'shot 4 (scene s2), beat 3 (reveal) quotes "the ids", which appears 2 times in the scene\'s narration; quote enough words to make it unique',
    ]);
  });

  it('cannot check evidence the run does not have', () => {
    expect(
      directionProblems(
        DirectionSchema.parse({
          shots: [
            { scene: 's1', elements: [{ id: 'p', kind: 'capture', evidence: 'screenshot:x' }] },
          ],
        }),
        scenes,
        undefined,
        directionSources({}),
      ),
    ).toEqual([
      'shot 1 (scene s1), element p: cites "screenshot:x", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
    ]);
  });

  it('check a shot for no scene through, and list all its problems with that one', () => {
    expect(
      problems({
        shots: [
          {
            scene: 's9',
            layout: 'single',
            elements: [
              { id: 'a', kind: 'code', evidence: 'diff-hunk:nope.js:1' },
              { id: 'a', kind: 'capture', evidence: 'screenshot:x' },
            ],
            beats: [{ verb: 'reveal', element: 'zz', at: 'not checked without a narration' }],
          },
        ],
      }),
    ).toEqual([
      'shot 1 (scene s9): the storyboard has no scene "s9" (it has: s1, s2)',
      'shot 1 (scene s9): layout "single" shows one element, and the shot has 2',
      'shot 1 (scene s9), element a: cites "diff-hunk:nope.js:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 1 (scene s9): element id "a" is used twice',
      'shot 1 (scene s9), element a: cites "screenshot:x", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 1 (scene s9), beat 1 (reveal): the shot has no element "zz" (it has: a)',
    ]);
  });

  it('show a title or summary card only alone, as it draws its own header and fox', () => {
    const cards: DirectedScene[] = [
      { id: 'open', narration: 'Send only the ids.', visual: { kind: 'title' } },
      { id: 'end', narration: 'Ready to merge.', visual: { kind: 'summary' } },
      { id: 'fix', narration: 'Now it sends the ids.', visual: { kind: 'code' } },
    ];
    const visual = { id: 'visual', kind: 'visual' as const };
    const note = { id: 'note', kind: 'label' as const, text: 'Ids only' };
    const check = (shot: DirectionInput['shots'][number]) =>
      directionProblems(DirectionSchema.parse({ shots: [shot] }), cards, evidence, sources);
    // Alone and in place, a card is drawn whole; it may still be left out for other elements.
    expect(check({ scene: 'open', elements: [visual] })).toEqual([]);
    expect(
      check({
        scene: 'end',
        elements: [visual],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual' }],
      }),
    ).toEqual([]);
    expect(check({ scene: 'end', elements: [note] })).toEqual([]);
    // Beside another element or revealed, it would be drawn in a slot under the scene's header.
    const alone = (scene: string, kind: string) =>
      `shot 1 (scene ${scene}), element visual: a ${kind} card draws its own header and fox, so it is shown only alone; make it the shot's one element, without a reveal, or leave it out`;
    expect(check({ scene: 'open', layout: 'row', elements: [visual, note] })).toEqual([
      alone('open', 'title'),
    ]);
    expect(
      check({ scene: 'end', elements: [visual], beats: [{ verb: 'reveal', element: 'visual' }] }),
    ).toEqual([alone('end', 'summary')]);
    // Other visuals keep their slot beside other elements, and their reveals.
    expect(
      check({
        scene: 'fix',
        layout: 'row',
        elements: [visual, note],
        beats: [{ verb: 'reveal', element: 'visual' }],
      }),
    ).toEqual([]);
  });

  it('measure lines within the side a code element shows', () => {
    const code = (side: 'head' | 'base' | 'diff', lines: [number, number]) => ({
      id: 'c',
      kind: 'code' as const,
      evidence: 'diff-hunk:src/request.js:10',
      side,
      lines,
    });
    const check = (element: ReturnType<typeof code>) =>
      problems({ shots: [{ scene: 's1', elements: [element] }] });
    expect(check(code('diff', [1, 4]))).toEqual([]);
    expect(check(code('base', [1, 3]))).toEqual([]);
    expect(check(code('base', [2, 4]))).toEqual([
      'shot 1 (scene s1), element c: lines [2, 4] run past the 3 lines of its base side',
    ]);
    expect(check(code('diff', [2, 5]))).toEqual([
      'shot 1 (scene s1), element c: lines [2, 5] run past the 4 lines of its diff side',
    ]);
  });

  it("show the app's start-up log on the default side, at either revision", () => {
    const logs = indexEvidence(buildEvidence({ fileSha: () => '1'.repeat(64) }));
    const started = directionSources({
      evidence: logs,
      appLogs: { base: 'Error: Cannot find module', head: 'listening on :3000' },
    });
    expect(started.command('terminal:app-start-base')).toEqual({
      name: 'app-start · base',
      command: '',
      output: 'Error: Cannot find module',
    });
    const output = (id: string, evidence: string, side?: 'head' | 'base') => ({
      id,
      kind: 'output' as const,
      evidence,
      ...(side ? { side } : {}),
    });
    expect(
      directionProblems(
        DirectionSchema.parse({
          shots: [
            {
              scene: 's1',
              elements: [
                output('b', 'terminal:app-start-base'),
                output('h', 'terminal:app-start-head', 'head'),
                output('x', 'terminal:app-start-base', 'base'),
              ],
            },
          ],
        }),
        scenes,
        logs,
        started,
      ),
    ).toEqual([
      'shot 1 (scene s1), element x: side "base": "terminal:app-start-base" is the app\'s start-up log at base, its only output; leave side out',
    ]);
  });

  it('echo at most a bounded, printable string, escapes included', () => {
    const echoed = (line: string) => /"(.*)", which the run's evidence/.exec(line)![1]!;
    const cite = (evidence: string) =>
      problems({ shots: [{ scene: 's1', elements: [{ id: 'c', kind: 'code', evidence }] }] })[0]!;
    // Control characters only: each prints as six characters.
    const controls = echoed(cite(`diff-hunk:${'\u0001'.repeat(390)}`));
    expect(controls.length).toBeLessThanOrEqual(120);
    expect(controls).toMatch(/^diff-hunk:(\\u0001)+…$/);
    // Astral format characters print as nine; a cut never falls inside one.
    const tags = echoed(cite(`diff-hunk:${'\u{E0001}'.repeat(150)}`));
    expect(tags.length).toBeLessThanOrEqual(120);
    expect(tags).toMatch(/^diff-hunk:(\\u\{e0001\})+…$/);
    // Printable astral characters stay whole: no lone surrogate is left at the cut.
    const faces = echoed(cite(`diff-hunk:${'\u{1F600}'.repeat(150)}`));
    expect(faces.length).toBeLessThanOrEqual(120);
    expect(faces).not.toMatch(/\p{Cs}/u);
    expect(faces.endsWith('\u{1F600}…')).toBe(true);
    for (const text of [controls, tags, faces]) expect(text).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });
});
