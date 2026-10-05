import { parseConfigInput, resolveConfig } from '../../packages/core/src/config/resolve.ts';
import type { ConfigInput } from '../../packages/core/src/config/schema.ts';
import { Git } from '../../packages/core/src/git/git.ts';
import { resolveChange } from '../../packages/core/src/git/resolve.ts';
import { runRules } from '../../packages/core/src/review/engine.ts';
import { understandChange } from '../../packages/core/src/understand/understand.ts';
import { createChangeRepo, type FileMap, type TempRepo } from './repo.ts';

export interface Analysis {
  repo: TempRepo;
  change: Awaited<ReturnType<typeof resolveChange>>;
  context: Awaited<ReturnType<typeof understandChange>>;
  findings: Awaited<ReturnType<typeof runRules>>['findings'];
  ruleIds: string[];
}

/** Builds a real repository for base → head and runs Understand plus the review rules. */
export async function analyze(
  base: FileMap,
  head: FileMap,
  options: { message?: string; branch?: string; config?: ConfigInput } = {},
): Promise<Analysis> {
  const repo = createChangeRepo(base, head, {
    message: options.message ?? 'Change',
    branch: options.branch,
  });
  const { config } = resolveConfig(
    options.config
      ? [{ name: 'repository', values: parseConfigInput(options.config, 'test') }]
      : [],
  );
  const git = new Git(repo.root);
  const change = await resolveChange({ repo: repo.root, ignore: config.ignore });
  const context = await understandChange(change, { git, config });
  const { findings } = await runRules(change, context, { git, config });
  return { repo, change, context, findings, ruleIds: findings.map((f) => f.source.id ?? '') };
}
