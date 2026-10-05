import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ParsedConfigInput } from '../config/schema.ts';
import { exists, writeFileAtomic } from '../util/fs.ts';

/**
 * Repository configuration can ask Covi to run commands (`app.install`, `app.start`,
 * `test.command`, `demo.commands`, `intelligence.command`), to open a URL (`app.url`), and to hand
 * environment variables to those commands (`app.env`, `app.passEnv`). A repository is untrusted
 * input, so locally these keys take effect only after the user trusts that exact set for that
 * repository (`covi trust`). In CI, configuration comes from the base revision instead, which the
 * repository's maintainers control.
 */
export interface RepositoryCommand {
  /** Config key, e.g. `app.start` or `demo.commands.build`. */
  key: string;
  /** The value as configured (commands verbatim; lists and maps as JSON). */
  value: string;
}

/** What Covi may execute in this run, and why not when it may not. */
export interface ExecutionPolicy {
  /** False where no project command may run at all (for example `pull_request_target`). */
  allowed: boolean;
  reason?: string;
  /** Repository commands that were not used because they are not trusted on this machine yet. */
  withheld: RepositoryCommand[];
}

export const TRUST_HINT = 'Run `covi trust` to review and allow them.';

export function repositoryCommands(values: ParsedConfigInput | undefined): RepositoryCommand[] {
  if (!values) return [];
  const out: RepositoryCommand[] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === '') return;
    out.push({ key, value: typeof value === 'string' ? value : JSON.stringify(value) });
  };
  add('app.install', values.app?.install);
  add('app.start', values.app?.start);
  add('app.url', values.app?.url);
  if (values.app?.env && Object.keys(values.app.env).length) add('app.env', values.app.env);
  if (values.app?.passEnv?.length) add('app.passEnv', values.app.passEnv);
  add('test.command', values.test?.command);
  for (const command of values.demo?.commands ?? [])
    add(`demo.commands.${command.name}`, command.run);
  add('intelligence.command', values.intelligence?.command);
  return out;
}

/** The same configuration without the keys that need trust. */
export function withoutRepositoryCommands(values: ParsedConfigInput): ParsedConfigInput {
  const omit = <T extends object>(section: T | undefined, keys: readonly string[]) =>
    section &&
    (Object.fromEntries(Object.entries(section).filter(([k]) => !keys.includes(k))) as T);
  return {
    ...values,
    app: omit(values.app, ['install', 'start', 'url', 'env', 'passEnv']),
    test: omit(values.test, ['command']),
    demo: omit(values.demo, ['commands']),
    intelligence: omit(values.intelligence, ['command']),
  };
}

/** One line per command, for prompts and warnings. */
export function describeCommands(commands: readonly RepositoryCommand[]): string[] {
  return commands.map((c) => `${c.key}: ${c.value}`);
}

function digest(commands: readonly RepositoryCommand[]): string {
  const canonical = [...commands]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((c) => [c.key, c.value]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** `$COVI_TRUST_FILE`, else `$XDG_DATA_HOME/covi/trust.json`, else `~/.local/share/covi/trust.json`. */
export function trustFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COVI_TRUST_FILE) return env.COVI_TRUST_FILE;
  const data = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(data, 'covi', 'trust.json');
}

interface TrustRecord {
  digest: string;
  commands: RepositoryCommand[];
  trustedAt: string;
}

interface TrustFileShape {
  version: 1;
  repositories: Record<string, TrustRecord>;
}

/**
 * Per-user record of which command sets the user trusts, keyed by repository path. Changing any
 * trusted key (a command, the URL, or the environment) makes the set untrusted again.
 */
export class TrustStore {
  readonly file: string;

  constructor(file: string = trustFile()) {
    this.file = file;
  }

  private async read(): Promise<TrustFileShape> {
    const text = await readFile(this.file, 'utf8').catch(() => undefined);
    if (!text) return { version: 1, repositories: {} };
    try {
      const parsed = JSON.parse(text) as Partial<TrustFileShape>;
      return { version: 1, repositories: parsed.repositories ?? {} };
    } catch {
      return { version: 1, repositories: {} };
    }
  }

  private async write(data: TrustFileShape): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`);
    await chmod(this.file, 0o600).catch(() => undefined);
  }

  async isTrusted(root: string, commands: readonly RepositoryCommand[]): Promise<boolean> {
    if (!commands.length) return true;
    const record = (await this.read()).repositories[await canonicalRoot(root)];
    return record?.digest === digest(commands);
  }

  async trust(root: string, commands: readonly RepositoryCommand[]): Promise<void> {
    const data = await this.read();
    // Forget repositories that no longer exist (temporary checkouts, deleted clones).
    for (const path of Object.keys(data.repositories))
      if (!(await exists(path))) delete data.repositories[path];
    data.repositories[await canonicalRoot(root)] = {
      digest: digest(commands),
      commands: [...commands],
      trustedAt: new Date().toISOString(),
    };
    await this.write(data);
  }

  /** Forgets the repository's trusted set. Returns whether there was one. */
  async revoke(root: string): Promise<boolean> {
    const data = await this.read();
    const key = await canonicalRoot(root);
    if (!data.repositories[key]) return false;
    delete data.repositories[key];
    await this.write(data);
    return true;
  }
}

async function canonicalRoot(root: string): Promise<string> {
  return realpath(root).catch(() => root);
}
