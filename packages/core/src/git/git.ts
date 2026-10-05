import { spawn } from 'node:child_process';
import { type ExecResult, exec } from '../exec/exec.ts';
import { EnvironmentError } from '../util/errors.ts';

/** The empty tree object; diffing against it shows a repository's entire content as added. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const BASE_ARGS = [
  '-c',
  'core.quotepath=false',
  '-c',
  'color.ui=false',
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.mnemonicPrefix=false',
  '-c',
  'diff.external=',
  '-c',
  'core.pager=cat',
];

export class GitError extends Error {
  readonly args: readonly string[];
  readonly result: ExecResult;
  constructor(args: readonly string[], result: ExecResult) {
    const detail = result.stderr.trim().split('\n').slice(-3).join(' ').trim();
    super(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
    this.name = 'GitError';
    this.args = args;
    this.result = result;
  }
}

export interface GitRunOptions {
  input?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/** Thin, non-interactive git runner. Never uses a shell; never takes optional locks. */
export class Git {
  readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async run(args: readonly string[], options: GitRunOptions = {}): Promise<ExecResult> {
    try {
      return await exec('git', [...BASE_ARGS, ...args], {
        cwd: this.cwd,
        env: gitEnv(),
        input: options.input,
        timeoutMs: options.timeoutMs ?? 120_000,
        maxOutputBytes: options.maxOutputBytes ?? 256 * 1024 * 1024,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new EnvironmentError(
          'git is not installed or not on PATH.',
          'Install git 2.30 or newer.',
          error,
        );
      }
      throw error;
    }
  }

  /** Runs git and returns stdout; throws GitError on a non-zero exit. */
  async out(args: readonly string[], options: GitRunOptions = {}): Promise<string> {
    const result = await this.run(args, options);
    if (result.exitCode !== 0) throw new GitError(args, result);
    if (result.truncated) {
      throw new EnvironmentError(
        `git ${args[0]} produced more output than Covi can analyze.`,
        'Exclude generated or vendored paths with `ignore:` in .covi/config.yml.',
      );
    }
    return result.stdout;
  }

  async tryOut(args: readonly string[]): Promise<string | undefined> {
    const result = await this.run(args);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  async revParse(ref: string): Promise<string | undefined> {
    return this.tryOut(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  }

  async hasObject(sha: string): Promise<boolean> {
    return (await this.run(['cat-file', '-e', `${sha}^{commit}`])).exitCode === 0;
  }

  async mergeBase(a: string, b: string): Promise<string | undefined> {
    return this.tryOut(['merge-base', a, b]);
  }

  async isShallow(): Promise<boolean> {
    return (await this.tryOut(['rev-parse', '--is-shallow-repository'])) === 'true';
  }

  /** Reads many blobs at once via `git cat-file --batch`. Keys are `rev:path`. */
  async readBlobs(specs: readonly string[]): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    const valid = specs.filter((s) => !s.includes('\n'));
    if (valid.length === 0) return result;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn('git', [...BASE_ARGS, 'cat-file', '--batch'], {
        cwd: this.cwd,
        env: gitEnv(),
      });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('error', reject);
      child.on('close', () => resolve(Buffer.concat(chunks)));
      child.stdin.on('error', () => {});
      child.stdin.end(`${valid.join('\n')}\n`);
    });
    let offset = 0;
    for (const spec of valid) {
      const newline = buffer.indexOf(10, offset);
      if (newline === -1) break;
      const header = buffer.subarray(offset, newline).toString('utf8');
      offset = newline + 1;
      const match = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
      if (!match) {
        result.set(spec, undefined);
        continue;
      }
      const size = Number(match[2]);
      const body = buffer.subarray(offset, offset + size);
      offset += size + 1;
      result.set(spec, match[1] === 'blob' ? body.toString('utf8') : undefined);
    }
    return result;
  }
}

export function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  };
}

/** Removes credentials from remote URLs (`https://user:token@host/x` → `https://host/x`). */
export function sanitizeRemote(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1');
}

/** Derives `owner/repo` from common remote URL forms. */
export function repoNameFromRemote(url: string): string | undefined {
  const cleaned = sanitizeRemote(url).replace(/\.git$/, '');
  const match = /[:/]([^/:]+\/[^/:]+)$/.exec(cleaned);
  if (!match) return undefined;
  // GitLab subgroups: keep the full path after the host.
  const hostPath =
    /^[a-z]+:\/\/[^/]+\/(.+)$/i.exec(cleaned)?.[1] ?? /^[^@]+@[^:]+:(.+)$/.exec(cleaned)?.[1];
  return hostPath ?? match[1];
}
