import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeChange } from '../model/change.ts';
import { EMPTY_TREE, type Git } from './git.ts';

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  at: 'base' | 'head';
  fixed?: boolean;
  word?: boolean;
  ignoreCase?: boolean;
  pathspecs?: readonly string[];
  maxHits?: number;
}

/** Reads file contents and searches the repository at the change's base or head. */
export class RevisionReader {
  private readonly git: Git;
  private readonly change: CodeChange;
  private readonly cache = new Map<string, string | undefined>();

  constructor(git: Git, change: CodeChange) {
    this.git = git;
    this.change = change;
  }

  private get headMode(): 'worktree' | 'index' | 'commit' {
    if (this.change.source.kind === 'staged') return 'index';
    return this.change.includesUncommitted ? 'worktree' : 'commit';
  }

  async read(
    at: 'base' | 'head',
    paths: readonly string[],
  ): Promise<Map<string, string | undefined>> {
    const out = new Map<string, string | undefined>();
    const pending: string[] = [];
    for (const path of paths) {
      const key = `${at}:${path}`;
      if (this.cache.has(key)) out.set(path, this.cache.get(key));
      else pending.push(path);
    }
    if (pending.length === 0) return out;

    if (at === 'head' && this.headMode === 'worktree') {
      await Promise.all(
        pending.map(async (path) => {
          const text = await readFile(join(this.change.repository.root, path), 'utf8').catch(
            () => undefined,
          );
          this.cache.set(`head:${path}`, text);
          out.set(path, text);
        }),
      );
      return out;
    }
    const rev = at === 'base' ? this.change.base.sha : this.change.head.sha;
    if (at === 'base' && rev === EMPTY_TREE) {
      for (const path of pending) out.set(path, undefined);
      return out;
    }
    const specs = pending.map((p) =>
      at === 'head' && this.headMode === 'index' ? `:${p}` : `${rev}:${p}`,
    );
    const blobs = await this.git.readBlobs(specs);
    pending.forEach((path, i) => {
      const text = blobs.get(specs[i]!);
      this.cache.set(`${at}:${path}`, text);
      out.set(path, text);
    });
    return out;
  }

  async readOne(at: 'base' | 'head', path: string): Promise<string | undefined> {
    return (await this.read(at, [path])).get(path);
  }

  async grep(pattern: string, options: GrepOptions): Promise<GrepHit[]> {
    const args = ['grep', '-n', '-I', '--no-color', '--full-name'];
    if (options.fixed) args.push('-F');
    if (options.word) args.push('-w');
    if (options.ignoreCase) args.push('-i');
    args.push('-e', pattern);
    let prefix = '';
    if (options.at === 'base') {
      if (this.change.base.sha === EMPTY_TREE) return [];
      args.push(this.change.base.sha);
      prefix = `${this.change.base.sha}:`;
    } else if (this.headMode === 'worktree') {
      args.push('--untracked');
    } else if (this.headMode === 'index') {
      args.push('--cached');
    } else {
      args.push(this.change.head.sha);
      prefix = `${this.change.head.sha}:`;
    }
    args.push('--', ...(options.pathspecs ?? []));
    const result = await this.git.run(args, { maxOutputBytes: 4 * 1024 * 1024 });
    if (result.exitCode !== 0) return [];
    const hits: GrepHit[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const rest = prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
      const m = /^(.*?):(\d+):(.*)$/.exec(rest);
      if (!m) continue;
      hits.push({ path: m[1]!, line: Number(m[2]), text: m[3]! });
      if (options.maxHits && hits.length >= options.maxHits) break;
    }
    return hits;
  }
}
