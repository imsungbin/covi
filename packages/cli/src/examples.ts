import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exists,
  loadRepositoryConfig,
  parseOrThrow,
  repositoryCommands,
  resourcePath,
  TrustStore,
  UsageError,
} from '@covi/core';
import { parse } from 'yaml';
import { z } from 'zod';

/** Fixture metadata: how to build the change, and what Covi is expected to conclude about it. */
export const ExampleSchema = z.strictObject({
  title: z.string(),
  description: z.string(),
  branch: z.string(),
  commits: z.array(z.strictObject({ message: z.string() })).min(1),
  delete: z.array(z.string()).default([]),
  expect: z.strictObject({
    intent: z.string(),
    demonstration: z.enum(['high', 'medium', 'low', 'none']),
    video: z.boolean(),
    template: z.string().optional(),
    rules: z.array(z.string()).default([]),
    demoFindings: z.array(z.string()).default([]),
    verdict: z.enum(['looks-good', 'needs-attention', 'needs-changes']).optional(),
  }),
});

export type Example = z.output<typeof ExampleSchema> & { name: string; dir: string };

export async function listExamples(): Promise<Example[]> {
  const root = resourcePath('examples');
  const out: Example[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name, 'change.yml');
    if (!entry.isDirectory() || !(await exists(file))) continue;
    out.push({
      ...parseOrThrow(
        ExampleSchema,
        parse(await readFile(file, 'utf8')),
        `examples/${entry.name}/change.yml`,
      ),
      name: entry.name,
      dir: join(root, entry.name),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getExample(name: string): Promise<Example> {
  const example = (await listExamples()).find((e) => e.name === name);
  if (!example) throw new UsageError(`Unknown example: ${name}`, 'List them with `covi examples`.');
  return example;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Covi Example',
  GIT_AUTHOR_EMAIL: 'examples@covi.invalid',
  GIT_COMMITTER_NAME: 'Covi Example',
  GIT_COMMITTER_EMAIL: 'examples@covi.invalid',
  GIT_AUTHOR_DATE: '2026-09-01T09:00:00Z',
  GIT_COMMITTER_DATE: '2026-09-01T09:00:00Z',
};

/**
 * Builds a real git repository for an example: base/ committed on main, then head/ (and deletions)
 * committed on the example's branch. Deterministic dates keep runs reproducible.
 */
export async function materializeExample(example: Example, into?: string): Promise<string> {
  const dir = into ?? (await mkdtemp(join(tmpdir(), `covi-example-${example.name}-`)));
  await mkdir(dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  await cp(join(example.dir, 'base'), dir, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial version');
  git('checkout', '-q', '-b', example.branch);
  if (await exists(join(example.dir, 'head')))
    await cp(join(example.dir, 'head'), dir, { recursive: true, force: true });
  for (const path of example.delete) await rm(join(dir, path), { force: true, recursive: true });
  git('add', '-A');
  const [first, ...rest] = example.commits;
  git('commit', '-q', '--allow-empty', '-m', first!.message);
  for (const c of rest) git('commit', '-q', '--allow-empty', '-m', c.message);
  // The example ships with Covi, so the commands in its configuration are Covi's own.
  const commands = repositoryCommands(
    (await loadRepositoryConfig(dir, { kind: 'worktree' })).values,
  );
  if (commands.length) await new TrustStore().trust(dir, commands);
  return dir;
}
