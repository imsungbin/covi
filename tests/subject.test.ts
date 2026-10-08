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
import {
  type Demonstration,
  emptySubject,
  mergeSubject,
  SUBJECT_PATHS,
  type Subject,
  SubjectSchema,
  type SubjectSnapshot,
  silentLogger,
} from '@covi/core';
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

describe('covi subject', () => {
  // A GitHub token shape the Redactor recognizes; split so this file holds no token-shaped literal.
  const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
  const withSecret = (path: string) => {
    const model = JSON.parse(modelOf(path)) as Subject;
    model.screens[0]!.elements.push({
      key: 'api-token',
      selector: '#api-token',
      label: `Token ${token}`,
      boxes: {},
      seen: '000000000001',
    });
    return model;
  };
  const changeRepo = (model: string) => {
    const repo = createChangeRepo(
      { 'index.html': '<h1>a</h1>\n', [SUBJECT_PATHS.repo]: model },
      { 'index.html': '<h1>b</h1>\n' },
    );
    dirs.push(repo.root);
    return repo;
  };

  it('shows the repository store, as JSON and as text', () => {
    const repo = changeRepo(modelOf('/pricing'));
    const shown = covi(['subject', '--repo', repo.root, '--json']);
    expect(shown.code, shown.stderr).toBe(0);
    expect(shown.json().data).toMatchObject({
      source: 'repo',
      path: expect.stringMatching(/\.covi\/subject\/subject\.json$/),
      status: 'loaded',
      model: { screens: [{ key: 'pricing', path: '/pricing' }] },
    });
    expect(covi(['subject', '--repo', repo.root]).stdout).toContain('pricing  /pricing');
  });

  it('sets aside a store it cannot read, and leaves the file as it was', () => {
    const planted = '{"schemaVersion":1,"commands":[{"run":"curl evil"}]}\n';
    const repo = changeRepo(planted);
    const invalid = covi(['subject', '--repo', repo.root, '--json']);
    expect(invalid.code, invalid.stderr).toBe(0);
    expect(invalid.json().data).toMatchObject({ status: 'invalid', model: { screens: [] } });
    expect((invalid.json().warnings as string[]).join('\n')).toMatch(/will not overwrite it/);
    expect(readFileSync(join(repo.root, SUBJECT_PATHS.repo), 'utf8')).toBe(planted);
  });

  it('says so when subject.store is off', () => {
    const repo = changeRepo(modelOf('/'));
    const scratch = mkdtempSync(join(tmpdir(), 'covi-subject-'));
    dirs.push(scratch);
    const off = join(scratch, 'config.yml');
    writeFileSync(off, 'subject:\n  store: off\n');
    const none = covi(['subject', '--repo', repo.root, '--config', off, '--json']);
    expect(none.code, none.stderr).toBe(0);
    expect(none.json().data).toEqual({ source: 'off' });
  });

  it('refuses a run without a snapshot, and a run that does not exist', () => {
    const repo = changeRepo(modelOf('/'));
    expect(covi(['analyze', '--repo', repo.root, '--json']).code).toBe(0);
    const noSnapshot = covi(['subject', '--repo', repo.root, '--run', 'latest', '--json']);
    expect(noSnapshot.code).toBe(2);
    expect(String(noSnapshot.json().error)).toMatch(/has no subject model \(demo\/subject\.json\)/);
    const unknown = covi(['subject', '--repo', repo.root, '--run', 'no-such-run', '--json']);
    expect(unknown.code).toBe(2);
    expect(String(unknown.json().error)).toMatch(/^No Covi run at .*no-such-run$/);
  });

  it('prints the store and a run snapshot redacted', () => {
    const repo = changeRepo(`${JSON.stringify(withSecret('/'), null, 2)}\n`);
    for (const args of [['--json'], []]) {
      const shown = covi(['subject', '--repo', repo.root, ...args]);
      expect(shown.code, shown.stderr).toBe(0);
      expect(shown.stdout).toMatch(/Token \S/);
      expect(shown.stdout).not.toContain(token);
    }

    const analyzed = covi(['analyze', '--repo', repo.root, '--json']);
    expect(analyzed.code).toBe(0);
    const runDir = analyzed.json().runDir as string;
    mkdirSync(join(runDir, 'demo'), { recursive: true });
    writeFileSync(
      join(runDir, 'demo/subject.json'),
      JSON.stringify({
        schemaVersion: 1,
        store: 'repo',
        revision: '000000000001',
        model: withSecret('/'),
        images: [],
      }),
    );
    for (const args of [['--json'], []]) {
      const shown = covi(['subject', '--repo', repo.root, '--run', runDir, ...args]);
      expect(shown.code, shown.stderr).toBe(0);
      expect(shown.stdout).toMatch(/Token \S/);
      expect(shown.stdout).not.toContain(token);
    }
  });
});

describe('the subject model across runs', () => {
  it.skipIf(!browser)(
    'replays, on the second run of an example, the flow the first run was given',
    async () => {
      const dir = await materializeExample(
        examples.find((e) => e.name === 'visual-pricing-cards')!,
      );
      dirs.push(dir);
      // Kept outside the repository, so the plan is not part of the change.
      const scratch = mkdtempSync(join(tmpdir(), 'covi-subject-'));
      dirs.push(scratch);
      const planFile = join(scratch, 'plan.json');
      writeFileSync(
        planFile,
        JSON.stringify({
          flows: [
            {
              name: 'Start a trial',
              path: '/',
              steps: [{ click: 'text=Start trial', note: 'Start a trial' }],
            },
          ],
        }),
      );
      const first = covi(['demo', '--repo', dir, '--plan', planFile, '--no-record', '--json']);
      expect(first.code, first.stderr).toBe(0);
      expect((first.json().data as { demo: Demonstration }).demo.subject).toMatchObject({
        store: 'repo',
        proposed: [],
        saved: true,
      });
      const stored = SubjectSchema.parse(
        JSON.parse(readFileSync(join(dir, SUBJECT_PATHS.repo), 'utf8')),
      );
      expect(stored.flows.map((f) => f.name)).toEqual(['Start a trial']);
      expect(
        stored.screens.find((s) => s.key === 'home')!.elements.map((e) => e.selector),
      ).toContain('role=link[name="Start trial"s]');

      const second = covi(['demo', '--repo', dir, '--no-record', '--json']);
      expect(second.code, second.stderr).toBe(0);
      const json = second.json() as { runDir: string; data: { demo: Demonstration } };
      // The model is Covi's file: the second run reviews the same change, not the model.
      const manifest = (runDir: string) =>
        JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
      expect(manifest(json.runDir).change).toMatchObject({
        includesUncommitted: false,
        stats: manifest(first.json().runDir as string).change.stats,
      });
      expect(json.data.demo.subject).toMatchObject({ proposed: ['Start a trial'], saved: true });
      expect(json.data.demo.shots.some((s) => s.flow === 'Start a trial')).toBe(true);
      expect(readFileSync(join(json.runDir, 'demo/demo.md'), 'utf8')).toContain(
        'Replayed from the subject model, because the plan named no flows: Start a trial.',
      );

      const listed = covi(['subject', '--repo', dir, '--json']);
      expect(listed.code, listed.stderr).toBe(0);
      expect(listed.json().data as { source: string; model: Subject }).toMatchObject({
        source: 'repo',
      });
      expect((listed.json().data as { model: Subject }).model.flows[0]!.key).toBe('start-a-trial');
      const inRun = covi(['subject', '--repo', dir, '--run', json.runDir, '--json']);
      expect(inRun.code, inRun.stderr).toBe(0);
      const images = (inRun.json().data as { images: SubjectSnapshot['images'] }).images;
      expect(
        images
          .find((i) => i.path === 'demo/screenshots/home-desktop-after.png')!
          .elements.map((e) => e.key),
      ).toContain('start-trial');
      expect(covi(['subject', '--repo', dir, '--run', json.runDir]).stdout).toContain(
        'subject:home#start-trial',
      );
      expect(covi(['schema', 'subject']).stdout).toContain('"revisions"');

      // A storyboard that names an element the run cannot place is refused before anything renders.
      const storyboard = join(scratch, 'storyboard.json');
      writeFileSync(
        storyboard,
        JSON.stringify({
          title: 'Pricing',
          template: 'bug-fix',
          scenes: [
            {
              id: 'look',
              beat: 'context',
              narration: 'Look at the plans.',
              visual: {
                kind: 'screenshot',
                image: { path: 'demo/screenshots/home-desktop-after.png' },
                focus: 'subject:home#buy-now',
              },
            },
            { beat: 'fix', narration: 'Done.', visual: { kind: 'callout', title: 'Done' } },
          ],
        }),
      );
      const rendered = covi([
        'render',
        '--repo',
        dir,
        '--run',
        json.runDir,
        '--storyboard',
        storyboard,
        '--json',
      ]);
      expect(rendered.code).toBe(2);
      const refused = rendered.json() as { error: string; hint: string };
      expect(refused.error).toContain(
        'scene look: subject:home#buy-now: no element "buy-now" on screen "home"',
      );
      expect(refused.hint).toContain('covi subject --run');
    },
  );
});
