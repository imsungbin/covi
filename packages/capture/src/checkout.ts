import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type CodeChange, EMPTY_TREE, Git, gitEnv } from '@covi/core';

export interface Checkout {
  revision: 'base' | 'head';
  dir: string;
  sha: string;
}

/**
 * Materializes a revision into a temporary directory with `git archive`. Nothing in the user's
 * repository changes: no worktrees, no stashes, no index updates. Uncommitted head states are
 * captured as dangling commits (`git stash create` / `git commit-tree`) plus untracked files.
 */
export async function checkoutRevision(
  change: CodeChange,
  revision: 'base' | 'head',
  parent: string,
): Promise<Checkout> {
  const git = new Git(change.repository.root);
  const dir = join(parent, revision);
  await mkdir(dir, { recursive: true });
  let sha = revision === 'base' ? change.base.sha : change.head.sha;
  const untracked: string[] = [];
  if (revision === 'head' && change.source.kind === 'staged') {
    const tree = await git.out(['write-tree']);
    sha = (
      await git.out([
        'commit-tree',
        tree.trim(),
        '-p',
        change.head.sha,
        '-m',
        'covi: staged changes',
      ])
    ).trim();
  } else if (revision === 'head' && change.includesUncommitted) {
    const stash = (await git.tryOut(['stash', 'create', 'covi: working tree'])) ?? '';
    if (stash) sha = stash;
    const listing = await git.out(['ls-files', '--others', '--exclude-standard', '-z']);
    untracked.push(...listing.split('\0').filter(Boolean));
  }
  if (sha !== EMPTY_TREE) await archive(change.repository.root, sha, dir);
  for (const path of untracked) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await copyFile(join(change.repository.root, path), join(dir, path)).catch(() => undefined);
  }
  return { revision, dir, sha };
}

function archive(repo: string, sha: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', ['archive', '--format=tar', sha], {
      cwd: repo,
      env: gitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tar = spawn('tar', ['-x', '-f', '-', '-C', dir], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = '';
    git.stderr.on('data', (d: Buffer) => {
      errors += d.toString();
    });
    tar.stderr.on('data', (d: Buffer) => {
      errors += d.toString();
    });
    git.stdout.pipe(tar.stdin);
    let pending = 2;
    const finish = (code: number | null) => {
      if (code !== 0) reject(new Error(`Could not extract ${sha.slice(0, 7)}: ${errors.trim()}`));
      else if (--pending === 0) resolve();
    };
    git.on('close', finish);
    tar.on('close', finish);
    git.on('error', reject);
    tar.on('error', reject);
  });
}

export async function tempWorkspace(
  prefix = 'covi-demo-',
): Promise<{ dir: string; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}
