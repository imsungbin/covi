import { afterEach, describe, expect, it } from 'vitest';
import { createChangeRepo, createRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { EMPTY_TREE } from '../src/git/git.ts';
import { NoChangesError, resolveChange } from '../src/git/resolve.ts';

let repo: TempRepo;
afterEach(() => repo?.cleanup());

describe('resolveChange', () => {
  it('reviews the current branch against the detected base branch by default', async () => {
    repo = createChangeRepo(
      { 'a.ts': 'export const a = 1;\n' },
      { 'a.ts': 'export const a = 2;\n', 'b.ts': 'export const b = 1;\n' },
      { message: 'feat: add b' },
    );
    const change = await resolveChange({ repo: repo.root });
    expect(change.base.ref).toBe('main');
    expect(change.source).toEqual({ kind: 'branch', base: 'main' });
    expect(change.files.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
    expect(change.commits.map((c) => c.subject)).toEqual(['feat: add b']);
    expect(change.metadata.title).toBe('feat: add b');
    expect(change.includesUncommitted).toBe(false);
    expect(change.stats).toMatchObject({ files: 2, additions: 2, deletions: 1 });
  });

  it('uses merge-base semantics so later commits on main are not shown as reverted', async () => {
    repo = createChangeRepo({ 'a.txt': 'a\n' }, { 'feature.txt': 'f\n' });
    repo.git('checkout', '-q', 'main');
    repo.commit('main moves on', { 'main-only.txt': 'm\n' });
    repo.git('checkout', '-q', 'feature/change');
    const change = await resolveChange({ repo: repo.root });
    expect(change.files.map((f) => f.path)).toEqual(['feature.txt']);
  });

  it('includes uncommitted and untracked work on top of the branch', async () => {
    repo = createChangeRepo({ 'a.ts': 'x\n' }, { 'a.ts': 'y\n' });
    repo.write({ 'a.ts': 'z\n', 'new-untracked.ts': 'export {};\n' });
    const change = await resolveChange({ repo: repo.root });
    expect(change.includesUncommitted).toBe(true);
    expect(change.head.ref).toBe('WORKTREE');
    expect(change.files.find((f) => f.path === 'new-untracked.ts')).toMatchObject({
      status: 'added',
      additions: 1,
    });
    const a = change.files.find((f) => f.path === 'a.ts')!;
    expect(a.hunks[0]!.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['z']);
  });

  it('falls back to uncommitted changes when on the base branch', async () => {
    repo = createRepo({ 'a.ts': 'x\n' });
    repo.write({ 'a.ts': 'y\n' });
    const change = await resolveChange({ repo: repo.root });
    expect(change.source).toEqual({ kind: 'uncommitted' });
    expect(change.base.ref).toBe('HEAD');
  });

  it('supports staged-only changes', async () => {
    repo = createRepo({ 'a.ts': 'x\n', 'b.ts': 'x\n' });
    repo.write({ 'a.ts': 'staged\n', 'b.ts': 'unstaged\n' });
    repo.git('add', 'a.ts');
    const change = await resolveChange({ repo: repo.root, scope: 'staged' });
    expect(change.files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('supports two-dot, three-dot, and single-commit ranges', async () => {
    repo = createRepo({ 'a.txt': '1\n' });
    const first = repo.git('rev-parse', 'HEAD');
    repo.commit('second', { 'a.txt': '2\n' });
    const second = repo.commit('third', { 'b.txt': '3\n' });
    const twoDot = await resolveChange({ repo: repo.root, range: `${first}..HEAD` });
    expect(twoDot.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(twoDot.commits).toHaveLength(2);
    const single = await resolveChange({ repo: repo.root, range: `${second}^!` });
    expect(single.files.map((f) => f.path)).toEqual(['b.txt']);
    const threeDot = await resolveChange({ repo: repo.root, range: `${first}...HEAD` });
    expect(threeDot.mergeBase).toBe(first);
  });

  it('treats the root commit as a diff against the empty tree', async () => {
    repo = createRepo({ 'a.txt': 'hello\n' });
    const change = await resolveChange({ repo: repo.root, range: 'HEAD^!' });
    expect(change.base.sha).toBe(EMPTY_TREE);
    expect(change.files[0]).toMatchObject({ path: 'a.txt', status: 'added' });
  });

  it('reports no changes clearly', async () => {
    repo = createRepo({ 'a.txt': 'x\n' });
    await expect(resolveChange({ repo: repo.root })).rejects.toBeInstanceOf(NoChangesError);
  });

  it('rejects unknown revisions and option-like refs', async () => {
    repo = createRepo({ 'a.txt': 'x\n' });
    await expect(resolveChange({ repo: repo.root, base: 'does-not-exist' })).rejects.toThrow(
      /Unknown revision/,
    );
    await expect(resolveChange({ repo: repo.root, base: '--upload-pack=evil' })).rejects.toThrow(
      /Invalid revision/,
    );
  });

  it('fails with an environment error outside a repository', async () => {
    await expect(resolveChange({ repo: '/' })).rejects.toThrow(/Not a git repository/);
  });

  it('classifies and ignores files', async () => {
    repo = createChangeRepo(
      { 'package.json': '{}\n' },
      {
        'src/components/Button.tsx': 'export function Button() { return null; }\n',
        'package-lock.json': '{}\n',
        'dist/bundle.js': 'x\n',
        'snapshots/x.snap': 'x\n',
        'docs/guide.md': '# Guide\n',
      },
    );
    const change = await resolveChange({ repo: repo.root, ignore: ['docs/**'] });
    const byPath = Object.fromEntries(change.files.map((f) => [f.path, f]));
    expect(byPath['src/components/Button.tsx']).toMatchObject({
      category: 'source',
      language: 'typescript',
      ignored: false,
    });
    expect(byPath['src/components/Button.tsx']!.surfaces).toContain('ui');
    expect(byPath['package-lock.json']).toMatchObject({ category: 'lockfile', ignored: false });
    expect(byPath['dist/bundle.js']).toMatchObject({ ignored: true, ignoreReason: 'generated' });
    expect(byPath['snapshots/x.snap']).toMatchObject({ ignored: true });
    expect(byPath['docs/guide.md']).toMatchObject({ ignored: true, ignoreReason: 'config' });
  });
});
