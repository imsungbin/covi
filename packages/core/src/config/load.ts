import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Git } from '../git/git.ts';
import { UsageError } from '../util/errors.ts';
import { parseConfigInput } from './resolve.ts';
import type { ParsedConfigInput } from './schema.ts';

export const CONFIG_FILES = ['.covi/config.yml', '.covi/config.yaml'] as const;

export interface LoadedConfig {
  values?: ParsedConfigInput;
  /** Human-readable origin, e.g. `.covi/config.yml` or `.covi/config.yml@1a2b3c4 (base)`. */
  source?: string;
}

export type ConfigOrigin =
  | { kind: 'worktree' }
  /**
   * Read from a commit. CI uses the base revision so a change cannot rewrite its own config.
   * `path` (relative to the repository root) reads that file instead of the default names.
   */
  | { kind: 'revision'; revision: string; label?: string; path?: string }
  | { kind: 'file'; path: string };

export async function loadRepositoryConfig(
  root: string,
  origin: ConfigOrigin,
  git?: Git,
): Promise<LoadedConfig> {
  if (origin.kind === 'file') {
    const text = await readFile(origin.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new UsageError(`Config file not found: ${origin.path}`);
      throw error;
    });
    return { values: parseYamlConfig(text, origin.path), source: origin.path };
  }
  if (origin.kind === 'revision' && origin.path) {
    const text = await git?.tryOut(['show', `${origin.revision}:${origin.path}`]);
    if (text === undefined)
      throw new UsageError(
        `Config file ${origin.path} does not exist at the ${origin.label ?? 'base'} revision (${origin.revision.slice(0, 7)}).`,
        'In CI, Covi reads configuration from the base revision so a change cannot rewrite its own review. Commit the file to the base branch first.',
      );
    const source = `${origin.path}@${origin.revision.slice(0, 7)}${origin.label ? ` (${origin.label})` : ''}`;
    return { values: parseYamlConfig(text, source), source };
  }
  for (const file of CONFIG_FILES) {
    let text: string | undefined;
    if (origin.kind === 'worktree') {
      text = await readFile(join(root, file), 'utf8').catch(() => undefined);
    } else if (git) {
      text = await git.tryOut(['show', `${origin.revision}:${file}`]);
    }
    if (text !== undefined) {
      const source =
        origin.kind === 'worktree'
          ? file
          : `${file}@${origin.revision.slice(0, 7)}${origin.label ? ` (${origin.label})` : ''}`;
      return { values: parseYamlConfig(text, source), source };
    }
  }
  return {};
}

export function parseYamlConfig(text: string, label: string): ParsedConfigInput {
  let raw: unknown;
  try {
    raw = parse(text, { uniqueKeys: true, prettyErrors: true }) ?? {};
  } catch (error) {
    throw new UsageError(`${label} is not valid YAML: ${(error as Error).message.split('\n')[0]}`);
  }
  return parseConfigInput(dropNulls(raw), label);
}

/** A section whose keys are all commented out parses as null; treat it as absent. */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNulls(v)]),
    );
  }
  return value;
}
