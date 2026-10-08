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
import { afterEach, describe, expect, it } from 'vitest';
import { outcomeFile } from '../../../tests/helpers/outcomes.ts';
import { createRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { Git } from '../src/git/git.ts';
import { OUTCOME_LIMITS } from '../src/model/outcome.ts';
import { outcomesOfRepository, readOutcomes, writeOutcome } from '../src/outcomes/store.ts';
import { Redactor } from '../src/security/redact.ts';
import { ignoreReason } from '../src/understand/classify.ts';

let roots: string[] = [];
let repo: TempRepo | undefined;
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  repo?.cleanup();
  roots = [];
  repo = undefined;
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'covi-outcomes-'));
  roots.push(dir);
  return dir;
};

describe('outcome store', () => {
  it('writes one redacted file per change, named after its run, in a directory that ignores itself', async () => {
    const root = tempDir();
    const redactor = new Redactor({ literals: ['tok-secret-123'] });
    const first = outcomeFile({ number: 7, runId: '20261009-120001-ci-aaaaaaa' });
    first.change.url = 'https://github.com/acme/shop/pull/7?t=tok-secret-123';
    const path = await writeOutcome(root, first, redactor);
    expect(path).toBe(join(root, '.covi/outcomes/20261009-120001-ci-aaaaaaa.json'));
    expect(readFileSync(join(root, '.covi/outcomes/.gitignore'), 'utf8')).toContain('*');
    expect(readFileSync(path, 'utf8')).not.toContain('tok-secret-123');
    // The comment moved on to a later run: that run's outcome replaces the earlier one.
    await writeOutcome(
      root,
      { ...first, runId: '20261009-130000-ci-bbbbbbb', collectedAt: '2026-10-09T13:00:00.000Z' },
      redactor,
    );
    expect(readdirSync(join(root, '.covi/outcomes')).sort()).toEqual([
      '.gitignore',
      '20261009-130000-ci-bbbbbbb.json',
    ]);
    expect(ignoreReason('.covi/outcomes/20261009-130000-ci-bbbbbbb.json', [])).toBe('generated');
  });

  it('keeps one outcome per change, the newest, and skips files that are not outcomes', async () => {
    const root = tempDir();
    const dir = join(root, '.covi/outcomes');
    mkdirSync(dir, { recursive: true });
    const put = (name: string, value: unknown) =>
      writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
    const at = (runId: string, number: number, collectedAt = '2026-10-09T12:00:00.000Z') =>
      put(`${runId}.json`, outcomeFile({ number, runId, collectedAt }));
    at('20261009-120001-ci-aaaaaaa', 7);
    at('20261009-130001-ci-bbbbbbb', 7, '2026-10-09T13:00:00.000Z');
    at('20261009-120002-ci-ccccccc', 8);
    put('20261009-110001-ci-1111111.json', 'not json');
    put('20261009-110002-ci-2222222.json', { schemaVersion: 1 });
    put('20261009-110003-ci-3333333.json', `"${'x'.repeat(300 * 1024)}"`);
    // Not named after a run: not an outcome Covi wrote, so not even looked at.
    put('notes.json', outcomeFile({ number: 10 }));
    // A link is not a file Covi wrote, wherever it points.
    const elsewhere = join(tempDir(), 'outcome.json');
    writeFileSync(elsewhere, JSON.stringify(outcomeFile({ number: 9 })));
    symlinkSync(elsewhere, join(dir, '20261009-140000-ci-ddddddd.json'));
    const warnings: string[] = [];
    const outcomes = await readOutcomes(root, { warn: (m) => warnings.push(m) });
    expect(outcomes.map((o) => [o.change.number, o.runId])).toEqual([
      [7, '20261009-130001-ci-bbbbbbb'],
      [8, '20261009-120002-ci-ccccccc'],
    ]);
    expect(warnings).toHaveLength(3);
    expect(await readOutcomes(join(root, 'nowhere'))).toEqual([]);
  });

  it('ignores outcome files committed to the repository', async () => {
    repo = createRepo({ 'README.md': 'shop\n' });
    await writeOutcome(repo.root, outcomeFile({ number: 7 }), new Redactor());
    const warnings: string[] = [];
    const read = () =>
      readOutcomes(repo!.root, { git: new Git(repo!.root), warn: (m) => warnings.push(m) });
    // Collected here and ignored by git: read.
    expect(await read()).toHaveLength(1);
    // Committed (in CI, the checkout is the change's head): anyone could have written them.
    repo.git('add', '-f', '.covi/outcomes');
    repo.git('commit', '-qm', 'Commit outcomes');
    expect(await read()).toEqual([]);
    expect(warnings.join('\n')).toMatch(/committed to the repository/);
  });

  it('does not let stray files crowd real outcomes out of the files it reads', async () => {
    const root = tempDir();
    await writeOutcome(root, outcomeFile({ number: 7 }), new Redactor());
    // Names that sort after every run id, as many as Covi reads.
    for (let i = 0; i < OUTCOME_LIMITS.files; i++)
      writeFileSync(
        join(root, `.covi/outcomes/zz-${String(i).padStart(3, '0')}.json`),
        JSON.stringify(outcomeFile({ number: 100 + i })),
      );
    expect((await readOutcomes(root)).map((o) => o.change.number)).toEqual([7]);
  });

  it('keeps only as many outcome files as it reads, dropping the oldest when it writes', async () => {
    const root = tempDir();
    const dir = join(root, '.covi/outcomes');
    // As many as Covi reads, from older runs, and a stray file that is not an outcome.
    mkdirSync(dir, { recursive: true });
    const runId = (i: number) =>
      `20261001-${String(Math.floor(i / 60)).padStart(4, '0')}${String(i % 60).padStart(2, '0')}-ci-aaaaaaa`;
    for (let i = 0; i < OUTCOME_LIMITS.files; i++)
      writeFileSync(
        join(dir, `${runId(i)}.json`),
        JSON.stringify(outcomeFile({ number: 100 + i, runId: runId(i) })),
      );
    writeFileSync(join(dir, 'notes.json'), '{}');
    await writeOutcome(
      root,
      outcomeFile({ number: 7, runId: '20261009-120001-ci-aaaaaaa' }),
      new Redactor(),
    );
    const names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(names).toHaveLength(OUTCOME_LIMITS.files + 1);
    expect(names).toContain('20261009-120001-ci-aaaaaaa.json');
    expect(names).toContain('notes.json');
    expect(names).not.toContain(`${runId(0)}.json`);
    expect(names).toContain(`${runId(1)}.json`);
  });

  it('ignores committed outcomes whatever the case of their path', async () => {
    repo = createRepo({ 'README.md': 'shop\n' });
    // A case-insensitive file system (macOS, Windows) reads .COVI/outcomes as .covi/outcomes.
    repo.write({
      '.COVI/outcomes/20261009-120003-ci-aaaaaaa.json': JSON.stringify(
        outcomeFile({ number: 7, runId: '20261009-120003-ci-aaaaaaa' }),
      ),
    });
    repo.git('add', '-f', '.COVI');
    repo.git('commit', '-qm', 'Commit outcomes');
    const warnings: string[] = [];
    expect(
      await readOutcomes(repo.root, { git: new Git(repo.root), warn: (m) => warnings.push(m) }),
    ).toEqual([]);
    expect(warnings.join('\n')).toMatch(/committed to the repository/);
  });

  it('ignores outcomes that a submodule at .covi brings along', async () => {
    const sub = createRepo({
      'outcomes/20261009-120003-ci-aaaaaaa.json': JSON.stringify(
        outcomeFile({ number: 7, runId: '20261009-120003-ci-aaaaaaa' }),
      ),
    });
    roots.push(sub.root);
    repo = createRepo({ 'README.md': 'shop\n' });
    repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.root, '.covi');
    repo.git('commit', '-qm', 'Add .covi as a submodule');
    expect(readdirSync(join(repo.root, '.covi/outcomes'))).toHaveLength(1);
    const warnings: string[] = [];
    expect(
      await readOutcomes(repo.root, { git: new Git(repo.root), warn: (m) => warnings.push(m) }),
    ).toEqual([]);
    expect(warnings.join('\n')).toMatch(/committed to the repository/);
  });

  it('reads nothing when git cannot say whether the outcomes are committed', async () => {
    const root = tempDir();
    await writeOutcome(root, outcomeFile({ number: 7 }), new Redactor());
    const warnings: string[] = [];
    // Not a repository: `git ls-files` fails, and an unknown answer counts as committed.
    expect(await readOutcomes(root, { git: new Git(root), warn: (m) => warnings.push(m) })).toEqual(
      [],
    );
    expect(warnings.join('\n')).toMatch(/could not check/);
  });

  it('refuses a .covi or .covi/outcomes that is a symbolic link, to read or to write', async () => {
    const elsewhere = tempDir();
    await writeOutcome(elsewhere, outcomeFile({ number: 7 }), new Redactor());
    expect(await readOutcomes(elsewhere)).toHaveLength(1);

    for (const [link, target] of [
      ['.covi', join(elsewhere, '.covi')],
      ['.covi/outcomes', join(elsewhere, '.covi/outcomes')],
    ] as const) {
      const root = tempDir();
      mkdirSync(join(root, '.covi'), { recursive: true });
      if (link === '.covi') rmSync(join(root, '.covi'), { recursive: true });
      symlinkSync(target, join(root, link));
      const warnings: string[] = [];
      expect(await readOutcomes(root, { warn: (m) => warnings.push(m) })).toEqual([]);
      expect(warnings.join('\n')).toMatch(/symbolic link/);
      await expect(writeOutcome(root, outcomeFile({ number: 8 }), new Redactor())).rejects.toThrow(
        /symbolic link/,
      );
    }
    // Nothing was written through either link.
    expect(
      readdirSync(join(elsewhere, '.covi/outcomes')).filter((f) => f.endsWith('.json')),
    ).toHaveLength(1);
    expect(existsSync(join(elsewhere, '.covi/outcomes/.gitignore'))).toBe(true);
  });

  it("keeps only the current repository's outcomes", () => {
    const shop = outcomeFile({ number: 1, repository: 'acme/shop' });
    const other = outcomeFile({ number: 2, repository: 'acme/other' });
    const gitlab = outcomeFile({ number: 3, repository: 'acme/shop' });
    gitlab.change.platform = 'gitlab';
    const files = [shop, other, gitlab];
    // Repository names on both platforms ignore case.
    expect(outcomesOfRepository(files, { name: 'Acme/Shop', platform: 'github' })).toEqual([shop]);
    // Outside CI the platform is unknown: the name alone decides.
    expect(outcomesOfRepository(files, { name: 'acme/shop' })).toEqual([shop, gitlab]);
    expect(outcomesOfRepository(files, { name: 'shop' })).toEqual([]);
  });
});
