import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type FileMap = Record<string, string | null>;

export interface TempRepo {
  root: string;
  git(...args: string[]): string;
  write(files: FileMap): void;
  commit(message: string, files?: FileMap): string;
  cleanup(): void;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Covi Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Covi Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: tmpdir(),
};

/** Creates an isolated git repository (never touches the developer's global git config). */
export function createRepo(initial?: FileMap, message = 'Initial commit'): TempRepo {
  const root = mkdtempSync(join(tmpdir(), 'covi-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  const write = (files: FileMap) => {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      if (content === null) {
        if (existsSync(full)) unlinkSync(full);
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  };
  const commit = (msg: string, files?: FileMap) => {
    if (files) write(files);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  if (initial) commit(message, initial);
  return {
    root,
    git,
    write,
    commit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A repository with `base` committed on main and `head` committed on a feature branch. */
export function createChangeRepo(
  base: FileMap,
  head: FileMap,
  options: { message?: string; branch?: string; messages?: string[] } = {},
): TempRepo {
  const repo = createRepo(base);
  repo.git('checkout', '-q', '-b', options.branch ?? 'feature/change');
  if (options.messages?.length) {
    const entries = Object.entries(head);
    const per = Math.ceil(entries.length / options.messages.length);
    for (const [i, m] of options.messages.entries()) {
      repo.commit(m, Object.fromEntries(entries.slice(i * per, (i + 1) * per)));
    }
  } else {
    repo.commit(options.message ?? 'Change', head);
  }
  return repo;
}
