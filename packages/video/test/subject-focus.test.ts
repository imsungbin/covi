import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReview,
  DEFAULT_CONFIG,
  explainHeuristically,
  Redactor,
  Run,
  type SubjectSnapshot,
  silentLogger,
} from '@covi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze } from '../../../tests/helpers/analyze.ts';
import { produceVideo } from '../src/pipeline.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { StoryboardSchema } from '../src/storyboard/schema.ts';
import { rectOf, resolveFocusRefs, resolveSubjectFocus } from '../src/storyboard/subject.ts';

const REV = '000000000001';
const AFTER = 'demo/screenshots/home-desktop-after.png';
const BEFORE = 'demo/screenshots/home-desktop-before.png';
const FRAME = 'demo/screenshots/flow-load-items-01.png';
const DESKTOP = [{ name: 'desktop' as const, width: 1280, height: 800 }];
const SNAPSHOT: SubjectSnapshot = {
  schemaVersion: 1,
  store: 'repo',
  revision: REV,
  model: {
    schemaVersion: 1,
    revisions: [REV],
    screens: [
      {
        key: 'home',
        path: '/',
        viewports: DESKTOP,
        seen: REV,
        elements: [
          { key: 'footer', selector: '#footer', boxes: {}, seen: REV },
          { key: 'load', selector: '#load', role: 'button', label: 'Load', boxes: {}, seen: REV },
        ],
      },
      {
        key: 'pricing',
        path: '/pricing',
        viewports: DESKTOP,
        seen: REV,
        elements: [{ key: 'plans', selector: '#plans', boxes: {}, seen: REV }],
      },
    ],
    flows: [],
    commands: [],
  },
  images: [
    {
      path: AFTER,
      screen: 'home',
      viewport: 'desktop',
      elements: [{ key: 'load', x: 40, y: 120, width: 60, height: 30 }],
    },
    {
      path: FRAME,
      screen: 'home',
      viewport: 'desktop',
      elements: [{ key: 'load', x: 40, y: 20, width: 60, height: 30 }],
    },
  ],
};

const raw = (visual: unknown, id = 'see') => ({
  title: 'Load items',
  template: 'bug-fix',
  scenes: [
    { id, beat: 'context', narration: 'Click Load.', visual },
    { beat: 'fix', narration: 'Done.', visual: { kind: 'callout', title: 'Done' } },
  ],
});
const board = (visual: unknown, id = 'see') => StoryboardSchema.parse(raw(visual, id));

describe('subject references in focus', () => {
  it('resolves an element to its box in the head capture it focuses', () => {
    const shot = board({ kind: 'screenshot', image: { path: AFTER }, focus: 'subject:home#load' });
    const placed = resolveSubjectFocus(shot, SNAPSHOT);
    expect(placed.problems).toEqual([]);
    expect(placed.storyboard.scenes[0]!.visual).toMatchObject({
      focus: { x: 40, y: 120, width: 60, height: 30 },
    });
    // The storyboard as written keeps the reference.
    expect(shot.scenes[0]!.visual).toMatchObject({ focus: 'subject:home#load' });
    const compare = board({
      kind: 'before-after',
      before: { path: BEFORE },
      after: { path: AFTER },
      focus: 'subject:home#load',
    });
    expect(resolveSubjectFocus(compare, SNAPSHOT).storyboard.scenes[0]!.visual).toMatchObject({
      focus: { x: 40, y: 120 },
    });
    const steps = board({
      kind: 'interaction',
      steps: [{ image: { path: FRAME }, focus: 'subject:home#load' }],
    });
    expect(resolveSubjectFocus(steps, SNAPSHOT).storyboard.scenes[0]!.visual).toMatchObject({
      steps: [{ focus: { x: 40, y: 20, width: 60, height: 30 } }],
    });
    expect(rectOf({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(() => rectOf('subject:home#load')).toThrow(/was not placed/);
  });

  it('resolves marks on a screenshot and on interaction steps, each in its own image', () => {
    const shot = board({
      kind: 'screenshot',
      image: { path: AFTER },
      marks: [
        { focus: 'subject:home#load', label: 'Load' },
        { focus: { x: 1, y: 1, width: 1, height: 1 } },
      ],
    });
    const placed = resolveSubjectFocus(shot, SNAPSHOT);
    expect(placed.problems).toEqual([]);
    expect(placed.storyboard.scenes[0]!.visual).toMatchObject({
      marks: [
        { focus: { x: 40, y: 120, width: 60, height: 30 }, label: 'Load' },
        { focus: { x: 1, y: 1, width: 1, height: 1 } },
      ],
    });
    const steps = board({
      kind: 'interaction',
      steps: [
        { image: { path: AFTER }, marks: [{ focus: 'subject:home#load' }] },
        { image: { path: FRAME }, marks: [{ focus: 'subject:home#load' }] },
      ],
    });
    expect(resolveSubjectFocus(steps, SNAPSHOT).storyboard.scenes[0]!.visual).toMatchObject({
      steps: [{ marks: [{ focus: { x: 40, y: 120 } }] }, { marks: [{ focus: { x: 40, y: 20 } }] }],
    });
    const onBase = board({
      kind: 'interaction',
      steps: [{ image: { path: BEFORE }, marks: [{ focus: 'subject:home#load' }] }],
    });
    expect(resolveSubjectFocus(onBase, SNAPSHOT).problems).toEqual([
      expect.stringMatching(
        /^scene see: subject:home#load: demo\/screenshots\/home-desktop-before\.png is not a head capture/,
      ),
    ]);
  });

  it('finds references at any depth of a visual, as marks nest them', () => {
    const asked: Array<[string, string | undefined]> = [];
    const out = resolveFocusRefs(
      {
        kind: 'screenshot',
        image: { path: 'a.png' },
        marks: [
          { focus: 'subject:home#load', label: 'Load' },
          { focus: { x: 1, y: 1, width: 1, height: 1 } },
        ],
      },
      (ref, image) => {
        asked.push([ref, image]);
        return { x: 9, y: 9, width: 9, height: 9 };
      },
    );
    expect(asked).toEqual([['subject:home#load', 'a.png']]);
    expect(out).toMatchObject({ marks: [{ focus: { x: 9 }, label: 'Load' }, { focus: { x: 1 } }] });
  });

  it('refuses references it cannot place, naming the scene and what exists', () => {
    const at = (image: string, ref: string) =>
      resolveSubjectFocus(
        board({ kind: 'screenshot', image: { path: image }, focus: ref }),
        SNAPSHOT,
      ).problems;
    expect(at(AFTER, 'subject:checkout#pay')).toEqual([
      'scene see: subject:checkout#pay: no screen "checkout" in the subject model (screens: home, pricing)',
    ]);
    expect(at(AFTER, 'subject:home#post')).toEqual([
      'scene see: subject:home#post: no element "post" on screen "home" (elements: footer, load)',
    ]);
    expect(at(BEFORE, 'subject:home#load')[0]).toMatch(
      /home-desktop-before\.png is not a head capture this run indexed/,
    );
    expect(at(AFTER, 'subject:pricing#plans')[0]).toMatch(
      /home-desktop-after\.png shows screen "home", not "pricing"/,
    );
    expect(at(AFTER, 'subject:home#footer')[0]).toMatch(
      /"footer" is not in demo\/screenshots\/home-desktop-after\.png/,
    );
    // An image path written another way still names the same capture.
    expect(at(`./${AFTER}`, 'subject:home#load')).toEqual([]);
    expect(
      at('demo/screenshots/../screenshots/home-desktop-after.png', 'subject:home#load'),
    ).toEqual([]);
    // What exists is listed: the images indexed, and the elements an image shows.
    expect(at(BEFORE, 'subject:home#load')[0]).toMatch(
      /\(indexed: demo\/screenshots\/home-desktop-after\.png, demo\/screenshots\/flow-load-items-01\.png\)$/,
    );
    expect(at(AFTER, 'subject:home#footer')[0]).toMatch(/\(it shows: load\)$/);
    const crowded: SubjectSnapshot = {
      ...SNAPSHOT,
      model: {
        ...SNAPSHOT.model,
        screens: Array.from({ length: 30 }, (_, i) => ({
          ...SNAPSHOT.model.screens[0]!,
          key: `screen-${i}`,
        })),
      },
    };
    const many = resolveSubjectFocus(
      board({ kind: 'screenshot', image: { path: AFTER }, focus: 'subject:checkout#pay' }),
      crowded,
    ).problems[0]!;
    expect(many).toMatch(/screen-0, .*screen-19, and 10 more\)$/);
    expect(many).not.toMatch(/screen-20/);
    const none = resolveSubjectFocus(
      board({ kind: 'screenshot', image: { path: AFTER }, focus: 'subject:home#load' }),
      undefined,
    );
    expect(none.problems).toEqual([
      expect.stringMatching(
        /^scene see: subject:home#load: the run has no subject model \(demo\/subject\.json\)/,
      ),
    ]);
    // A malformed reference is a schema error before any of this, in focus and in a mark.
    expect(
      StoryboardSchema.safeParse(
        raw({ kind: 'screenshot', image: { path: AFTER }, focus: 'home#load' }),
      ).success,
    ).toBe(false);
    expect(
      StoryboardSchema.safeParse(
        raw({
          kind: 'screenshot',
          image: { path: AFTER },
          marks: [{ focus: 'subject:Home#load' }],
        }),
      ).success,
    ).toBe(false);
  });
});

const cleanup: Array<() => void> = [];
afterAll(() => {
  for (const c of cleanup) c();
});

describe('placing references in the pipeline', () => {
  it('checks references before writing the storyboard, and keeps them as written', async () => {
    const a = await analyze(
      { 'index.html': '<button id="load">Load</button>\n' },
      { 'index.html': '<button id="load">Load items</button>\n' },
    );
    cleanup.push(() => a.repo.cleanup());
    const root = mkdtempSync(join(tmpdir(), 'covi-subject-video-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const run = await Run.create({
      root,
      workflow: 'video',
      entryPoint: 'cli',
      interactive: false,
      coviVersion: '0.0.0-test',
      redactor: new Redactor(),
    });
    const { review } = buildReview({
      ruleFindings: a.findings,
      checked: [],
      config: DEFAULT_CONFIG,
      context: a.context,
      generatedBy: { provider: 'heuristic' },
    });
    const input = {
      run,
      change: a.change,
      context: a.context,
      explanation: explainHeuristically(a.context),
      review,
      spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
      cacheDir: join(root, 'cache'),
      logger: silentLogger,
      draftOnly: true,
      subject: SNAPSHOT,
    };
    const shot = (focus: string) => raw({ kind: 'screenshot', image: { path: AFTER }, focus });
    await expect(
      produceVideo({ ...input, storyboard: shot('subject:home#post') }),
    ).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('scene see: subject:home#post'),
    });
    // A mark on a base image is refused the same way.
    await expect(
      produceVideo({
        ...input,
        storyboard: raw({
          kind: 'screenshot',
          image: { path: BEFORE },
          marks: [{ focus: 'subject:home#load' }],
        }),
      }),
    ).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('scene see: subject:home#load'),
    });
    expect(await run.has('video/storyboard.json')).toBe(false);
    await produceVideo({ ...input, storyboard: shot('subject:home#load') });
    const written = await run.readJson<{ scenes: Array<{ visual: { focus?: unknown } }> }>(
      'video/storyboard.json',
    );
    expect(written.scenes[0]!.visual.focus).toBe('subject:home#load');
    // The snapshot is read only for a storyboard that names an element: a damaged one never stops
    // a storyboard that gives its regions as rects.
    let reads = 0;
    const damaged = async () => {
      reads++;
      throw new Error('demo/subject.json is invalid');
    };
    await produceVideo({
      ...input,
      subject: damaged,
      storyboard: raw({
        kind: 'screenshot',
        image: { path: AFTER },
        focus: { x: 1, y: 1, width: 10, height: 10 },
      }),
    });
    expect(reads).toBe(0);
    await expect(
      produceVideo({ ...input, subject: damaged, storyboard: shot('subject:home#load') }),
    ).rejects.toThrow(/demo\/subject\.json is invalid/);
    expect(reads).toBe(1);
    await produceVideo({
      ...input,
      subject: async () => SNAPSHOT,
      storyboard: shot('subject:home#load'),
    });
  });
});
