import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { parseDiff, unquote } from '../src/git/diff-parser.ts';

describe('parseDiff', () => {
  it('parses a modification with multiple hunks and line numbers', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,4 @@ export function main() {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' console.log(a);',
      '@@ -10 +11 @@',
      '-old',
      '+new',
      '',
    ].join('\n');
    const [file] = parseDiff(diff);
    expect(file).toMatchObject({
      path: 'src/app.ts',
      status: 'modified',
      additions: 3,
      deletions: 2,
      binary: false,
    });
    expect(file!.hunks).toHaveLength(2);
    expect(file!.hunks[0]!.section).toBe('export function main() {');
    expect(file!.hunks[0]!.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['context', 3, 4],
    ]);
    // A hunk header without counts means a single line.
    expect(file!.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 11, newLines: 1 });
  });

  it('keeps "--- " content lines inside hunks instead of treating them as headers', () => {
    const diff = [
      'diff --git a/a.md b/a.md',
      '--- a/a.md',
      '+++ b/a.md',
      '@@ -1,2 +1,2 @@',
      '--- old rule',
      '+++ new rule',
      ' x',
      '',
    ].join('\n');
    const [file] = parseDiff(diff);
    expect(file!.hunks[0]!.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'del:-- old rule',
      'add:++ new rule',
      'context:x',
    ]);
  });

  it('marks lines without a trailing newline', () => {
    const diff = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const lines = parseDiff(diff)[0]!.hunks[0]!.lines;
    expect(lines.every((l) => l.noNewline)).toBe(true);
  });

  it('decodes C-quoted paths with octal UTF-8 escapes', () => {
    expect(unquote('"caf\\303\\251 \\"menu\\".txt"')).toBe('café "menu".txt');
    expect(unquote('plain.txt')).toBe('plain.txt');
  });

  it('parses header-only entries (pure rename, mode change, binary)', () => {
    const diff = [
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 100%',
      'rename from old name.ts',
      'rename to new name.ts',
      'diff --git a/run.sh b/run.sh',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/logo.png b/logo.png',
      'index 1..2 100644',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.oldPath, f.binary])).toEqual([
      ['new name.ts', 'renamed', 'old name.ts', false],
      ['run.sh', 'modified', undefined, false],
      ['logo.png', 'modified', undefined, true],
    ]);
    expect(files[0]!.similarity).toBe(100);
    expect(files[1]).toMatchObject({ oldMode: '100644', newMode: '100755' });
  });

  it('recovers paths containing spaces from the diff --git header', () => {
    const diff = [
      'diff --git a/docs/my file.md b/docs/my file.md',
      'new file mode 100644',
      'index 0000000..e69de29',
      '',
    ].join('\n');
    expect(parseDiff(diff)[0]).toMatchObject({ path: 'docs/my file.md', status: 'added' });
  });
});

describe('parseDiff against real git output', () => {
  let repo: TempRepo;
  afterEach(() => repo?.cleanup());

  it('handles adds, deletes, renames, unicode paths, CRLF, and binary files', () => {
    repo = createRepo({
      'keep.txt': 'one\ntwo\nthree\n',
      'gone.txt': 'bye\n',
      'src/rename-me.ts': `${'export const value = 1;\n'.repeat(20)}`,
      'crlf.txt': 'a\r\nb\r\n',
      'bin.dat': Buffer.from([0, 1, 2, 3]).toString('latin1'),
    });
    repo.git('mv', 'src/rename-me.ts', 'src/renamed.ts');
    repo.write({
      'keep.txt': 'one\nTWO\nthree\nfour\n',
      'gone.txt': null,
      'añadido café.md': '# hola\n',
      'crlf.txt': 'a\r\nB\r\n',
      'bin.dat': Buffer.from([0, 9, 9, 3, 0]).toString('latin1'),
      'src/renamed.ts': `${'export const value = 1;\n'.repeat(20)}export const extra = 2;\n`,
    });
    repo.git('add', '-A');
    const text = repo.git(
      '-c',
      'core.quotepath=false',
      'diff',
      '--cached',
      '--find-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
    );
    const byPath = new Map(parseDiff(`${text}\n`).map((f) => [f.path, f]));
    expect(byPath.get('keep.txt')).toMatchObject({
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(byPath.get('gone.txt')).toMatchObject({ status: 'deleted', deletions: 1 });
    expect(byPath.get('añadido café.md')).toMatchObject({ status: 'added', additions: 1 });
    expect(byPath.get('src/renamed.ts')).toMatchObject({
      status: 'renamed',
      oldPath: 'src/rename-me.ts',
      additions: 1,
    });
    expect(byPath.get('crlf.txt')!.hunks[0]!.lines.find((l) => l.kind === 'add')!.text).toBe('B');
    expect(byPath.get('bin.dat')).toMatchObject({ binary: true });
  });
});
