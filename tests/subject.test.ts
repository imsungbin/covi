import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptySubject, mergeSubject, SUBJECT_PATHS, silentLogger } from '@covi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { startSession } from '../packages/cli/src/session.ts';
import { subjectFlowWarnings } from '../packages/cli/src/workflows.ts';
import { covi } from './helpers/cli.ts';
import { canUseBrowser } from './helpers/env.ts';
import { createChangeRepo } from './helpers/repo.ts';

const browser = await canUseBrowser();
const examples = await listExamples();
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const modelOf = (path: string) =>
  `${JSON.stringify(
    mergeSubject(
      emptySubject(),
      {
        revision: '000000000001',
        screens: [{ path, viewport: 'desktop', size: { width: 1280, height: 800 }, elements: [] }],
        flows: [],
        commands: [],
      },
      { expireAfter: 20 },
    ),
    null,
    2,
  )}\n`;

describe('the subject model in sessions', () => {
  it('reads the model from the base revision in CI, and from the worktree locally', async () => {
    const repo = createChangeRepo(
      { 'index.html': '<h1>a</h1>\n', [SUBJECT_PATHS.repo]: modelOf('/') },
      { 'index.html': '<h1>b</h1>\n', [SUBJECT_PATHS.repo]: modelOf('/steered') },
    );
    dirs.push(repo.root);
    const open = (trustedConfig: boolean) =>
      startSession({
        workflow: 'analyze',
        selection: { repo: repo.root, scope: 'auto', fetch: false },
        explicit: {},
        entryPoint: 'cli',
        interactive: false,
        logger: silentLogger,
        trustedConfig,
      });
    const ci = await open(true);
    expect(ci.subject!.model.screens.map((s) => s.path)).toEqual(['/']);
    // Read from base, never written: the checkout is thrown away, and the change must not steer it.
    expect(ci.subject!.source.to).toBeUndefined();
    expect(ci.subject!.writable).toBe(false);
    const local = await open(false);
    expect(local.subject!.model.screens.map((s) => s.path)).toEqual(['/steered']);
    expect(local.subject!.writable).toBe(true);
  });

  it('sets aside a runs-directory model the change committed in CI, and opens nothing when off', async () => {
    const runsModel = join('.covi/runs', SUBJECT_PATHS.runs);
    const repo = createChangeRepo(
      { 'index.html': '<h1>a</h1>\n' },
      { 'index.html': '<h1>b</h1>\n', [runsModel]: modelOf('/steered') },
    );
    dirs.push(repo.root);
    const open = (store: 'runs' | 'off') =>
      startSession({
        workflow: 'analyze',
        selection: { repo: repo.root, scope: 'auto', fetch: false },
        explicit: { subject: { store } },
        entryPoint: 'cli',
        interactive: false,
        logger: silentLogger,
        trustedConfig: true,
      });
    const ci = await open('runs');
    expect(ci.subject!.model.screens).toEqual([]);
    expect(ci.subject!.writable).toBe(false);
    expect(ci.run.manifest.warnings.join('\n')).toMatch(
      /subject\.json is committed to the repository, so the change could have written it/,
    );
    expect((await open('off')).subject).toBeUndefined();
  });

  it('in CI, takes subject settings from the base configuration, not the change', async () => {
    const repo = createChangeRepo(
      { 'index.html': '<h1>a</h1>\n' },
      { 'index.html': '<h1>b</h1>\n', '.covi/config.yml': 'subject:\n  store: off\n' },
    );
    dirs.push(repo.root);
    const open = (trustedConfig: boolean) =>
      startSession({
        workflow: 'analyze',
        selection: { repo: repo.root, scope: 'auto', fetch: false },
        explicit: {},
        entryPoint: 'cli',
        interactive: false,
        logger: silentLogger,
        trustedConfig,
      });
    expect((await open(true)).subject!.source.store).toBe('repo');
    expect((await open(false)).subject).toBeUndefined();
  });

  it('in CI, never follows a runs directory the change made a link: no run, no model', async () => {
    const repo = createChangeRepo({ 'index.html': '<h1>a</h1>\n' }, {});
    dirs.push(repo.root);
    const outside = mkdtempSync(join(tmpdir(), 'covi-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, SUBJECT_PATHS.runs), modelOf('/outside'));
    mkdirSync(join(repo.root, '.covi'), { recursive: true });
    symlinkSync(outside, join(repo.root, '.covi/runs'));
    repo.commit('Point the runs directory elsewhere', { 'index.html': '<h1>b</h1>\n' });
    const open = (out?: string) =>
      startSession({
        workflow: 'analyze',
        selection: { repo: repo.root, scope: 'auto', fetch: false },
        explicit: { subject: { store: 'runs' } },
        entryPoint: 'cli',
        interactive: false,
        logger: silentLogger,
        trustedConfig: true,
        out,
      });
    await expect(open()).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringContaining('.covi/runs is reached through a symbolic link'),
    });
    // With --out, as the integrations run it, the run is written there and the model is set aside.
    const ci = await open(join(outside, '..', `${outside.split('/').pop()}-run`));
    dirs.push(ci.run.dir);
    expect(ci.subject!.model.screens).toEqual([]);
    expect(ci.subject!.writable).toBe(false);
    expect(ci.run.manifest.warnings.join('\n')).toMatch(/symbolic link; Covi planned without it/);
    expect(readdirSync(outside)).toEqual([SUBJECT_PATHS.runs]);
    expect(readFileSync(join(outside, SUBJECT_PATHS.runs), 'utf8')).toBe(modelOf('/outside'));
  });

  it('says which observed flows the model did not keep, and why, with names only', () => {
    expect(
      subjectFlowWarnings({
        store: 'repo',
        proposed: [],
        focused: [],
        flows: [
          { name: 'Load items', outcome: 'kept' },
          { name: 'Sign in', outcome: 'secret' },
          { name: 'Checkout', outcome: 'failed' },
          { name: 'Wander off', outcome: 'invalid' },
          { outcome: 'failed' },
        ],
        saved: true,
      }),
    ).toEqual([
      'The subject model did not keep the flow "Sign in": it types into a secret field.',
      'The subject model did not keep the flow "Checkout": it did not pass at head.',
      'The subject model did not keep the flow "Wander off": it has a step Covi would not replay (too many steps, a long or multi-line value, or a goto off the app).',
      'The subject model did not keep a flow without a name: it did not pass at head.',
    ]);
    expect(subjectFlowWarnings(undefined)).toEqual([]);
  });
});

describe('the run snapshot reaches the video', () => {
  it.skipIf(!browser)(
    'places storyboard references with the run snapshot in `covi render` and `covi video`',
    async () => {
      const dir = await materializeExample(
        examples.find((e) => e.name === 'visual-pricing-cards')!,
      );
      dirs.push(dir);
      const demo = covi(['demo', '--repo', dir, '--json']);
      expect(demo.code).toBe(0);
      const ran = demo.json() as { runId: string; artifacts: Record<string, string> };
      expect(ran.artifacts.subject).toMatch(/demo\/subject\.json$/);
      const board = join(dir, '..', `${dir.split('/').pop()}-storyboard.json`);
      dirs.push(board);
      // An element the snapshot does not have: the message lists what it does have, which it can
      // only do when the snapshot was passed (otherwise: "the run has no subject model").
      writeFileSync(
        board,
        JSON.stringify({
          title: 'Pricing',
          template: 'before-after',
          scenes: [
            {
              id: 'cards',
              beat: 'context',
              narration: 'The cards changed.',
              visual: {
                kind: 'screenshot',
                image: { path: './demo/screenshots/home-desktop-after.png' },
                focus: 'subject:home#no-such-element',
              },
            },
            { beat: 'fix', narration: 'Done.', visual: { kind: 'callout', title: 'Done' } },
          ],
        }),
      );
      const render = covi(['render', '--repo', dir, '--run', ran.runId, '--storyboard', board]);
      expect(render.code).toBe(2);
      expect(render.stderr).toMatch(/no element "no-such-element" on screen "home" \(elements: /);
      const video = covi(['video', '--repo', dir, '--storyboard', board, '--json']);
      expect(video.code).toBe(2);
      expect(video.stderr).toMatch(/no element "no-such-element" on screen "home" \(elements: /);
      // Locally, the repository's model is written for the next run.
      expect(existsSync(join(dir, SUBJECT_PATHS.repo))).toBe(true);
    },
  );
});
