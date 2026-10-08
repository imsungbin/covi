import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  buildOutcome,
  CoviError,
  EnvironmentError,
  ExitCode,
  errorMessage,
  Git,
  type Language,
  listRuns,
  loadRepositoryConfig,
  outcomeReport,
  outcomesDir,
  outcomesOfRepository,
  type PublishRecord,
  Redactor,
  readOutcomes,
  repoNameFromRemote,
  summarizeOutcomes,
  writeOutcome,
} from '@covi/core';
import {
  BudgetExhaustedError,
  createCollector,
  detectPlatform,
  type FetchLike,
  type OutcomeCollector,
  type PlatformContext,
  PlatformHttpError,
  platformContext,
  RateLimitedError,
  RequestBudget,
} from '@covi/platforms';
import { isInside } from './session.ts';
import { baseResult, type WorkflowResult } from './workflows.ts';

export interface CollectOptions {
  root: string;
  runsDir: string;
  platform: 'auto' | 'github' | 'gitlab';
  number?: number;
  recent?: number;
  repository?: string;
  apiUrl?: string;
  maxRequests: number;
  env: NodeJS.ProcessEnv;
  /** `--config`: where `publish.botLogin` and `publish.gitlabBotUser` may come from. */
  configPath?: string;
  fetch?: FetchLike;
  now?: () => Date;
}

interface Target {
  number: number;
  commentId?: string;
}

/** A GitLab run that could not name its project recorded the project's numeric id instead. */
const PROJECT_ID = /^\d+$/;

const stops = (error: unknown): error is RateLimitedError | BudgetExhaustedError =>
  error instanceof RateLimitedError || error instanceof BudgetExhaustedError;

/**
 * Whose comments count as Covi's besides the token's own user: `publish.botLogin` and
 * `publish.gitlabBotUser` from trusted configuration. In CI the checkout may be the change under
 * review, so that is the base revision's (or a `--config` outside the repository); locally, the
 * worktree's or `--config`'s.
 */
export async function collectorIdentity(
  root: string,
  o: { ci: boolean; base?: string; configPath?: string; warn?: (message: string) => void },
): Promise<{ botLogin?: string; gitlabBotUser?: string }> {
  const git = new Git(root);
  const top = await git.tryOut(['rev-parse', '--show-toplevel']);
  // Compare real paths: git reports the repository's real path (e.g. /private/var on macOS).
  const path = o.configPath
    ? await realpath(resolve(o.configPath)).catch(() => resolve(o.configPath!))
    : undefined;
  const inside = path && top && isInside(top, path) ? relative(top, path) : undefined;
  let loaded: Awaited<ReturnType<typeof loadRepositoryConfig>> = {};
  if (path && !(o.ci && inside)) loaded = await loadRepositoryConfig(root, { kind: 'file', path });
  else if (!o.ci) loaded = await loadRepositoryConfig(root, { kind: 'worktree' });
  else if (top && o.base && /^[0-9a-f]{7,64}$/i.test(o.base) && (await git.hasObject(o.base)))
    loaded = await loadRepositoryConfig(
      root,
      { kind: 'revision', revision: o.base, label: 'base', path: inside },
      git,
    );
  else if (inside)
    o.warn?.(
      `Did not read ${inside}: in CI, Covi reads configuration from the base revision, and this checkout does not have it.`,
    );
  const { botLogin, gitlabBotUser } = loaded.values?.publish ?? {};
  return { ...(botLogin ? { botLogin } : {}), ...(gitlabBotUser ? { gitlabBotUser } : {}) };
}

/**
 * `covi outcomes collect`: asks the platform what became of the changes Covi commented on, and
 * writes one outcome file per change. At a rate limit or the request budget it stops and keeps
 * what it has.
 */
export async function collectOutcomes(o: CollectOptions): Promise<WorkflowResult> {
  const result = baseResult('outcomes collect');
  const redactor = Redactor.fromProcess();
  const warn = (message: string) => result.warnings.push(redactor.redact(message));
  const detected = detectPlatform(o.env);
  const context = detected !== 'local' ? await platformContext(detected, o.env) : undefined;
  const published = (await listRuns(o.root, o.runsDir)).flatMap((r) =>
    r.publish ? [r.publish] : [],
  );
  const platform =
    o.platform !== 'auto'
      ? o.platform
      : detected !== 'local'
        ? detected
        : (published[0]?.platform ?? 'github');
  const records = published.filter((p) => p.platform === platform);
  const made = createCollector(platform, o.env, {
    // Outside CI the runs published from here name the repository. The API URL never comes from them.
    repository:
      o.repository ||
      (detected === 'local'
        ? records.find((r) => !PROJECT_ID.test(r.repository))?.repository
        : undefined),
    apiUrl: o.apiUrl,
    budget: new RequestBudget(o.maxRequests),
    fetch: o.fetch,
    ...(await collectorIdentity(o.root, {
      ci: detected !== 'local',
      base: context?.base,
      configPath: o.configPath,
      warn,
    })),
  });
  const name = platform === 'github' ? 'GitHub' : 'GitLab';
  const label = (number: number) =>
    platform === 'github' ? `Pull request #${number}` : `Merge request !${number}`;
  if (!made.collector)
    throw new CoviError(
      `Cannot collect outcomes: ${made.reason}.`,
      made.missing === 'repository'
        ? {
            exitCode: ExitCode.usage,
            hint: `Pass --repository ${platform === 'github' ? 'owner/name' : 'group/project'}, or run it in CI or where Covi published a comment.`,
          }
        : {
            exitCode: ExitCode.environment,
            hint:
              platform === 'github'
                ? 'Set GITHUB_TOKEN (or COVI_GITHUB_TOKEN) to a token that can read pull requests.'
                : 'Set COVI_GITLAB_TOKEN to a token with the read_api scope.',
          },
    );
  const collector = made.collector;
  const collected: Array<{
    number: number;
    runId: string;
    state: string;
    findings: number;
    path: string;
  }> = [];
  const skipped: Array<{ number: number; reason: string }> = [];
  const skip = (number: number, reason: string) =>
    skipped.push({ number, reason: redactor.redact(reason) });
  let incomplete: { reason: string; resetAt?: string } | undefined;
  const now = o.now ?? (() => new Date());
  try {
    const targets = await targetsOf(o, collector, records, context, (number, reason) => {
      skip(number, reason);
      warn(`${label(number)}: skipped: ${reason}. Pass --number ${number} to collect it.`);
    });
    if (!targets.length && !skipped.length)
      warn('Nothing to collect: no run here published a comment. Pass --number or --recent.');
    for (const target of targets) {
      try {
        const signals = await collector.collect(target.number, { commentId: target.commentId });
        const built = buildOutcome(signals, now().toISOString());
        // What the collector could not read: the outcome may be missing a revert or some votes.
        for (const note of built.notes ?? []) warn(`${label(target.number)}: ${note}.`);
        if (!built.outcome) {
          skip(target.number, built.skipped);
          continue;
        }
        collected.push({
          number: target.number,
          runId: built.outcome.runId,
          state: built.outcome.change.state,
          findings: built.outcome.findings.length,
          path: await writeOutcome(o.root, built.outcome, redactor),
        });
      } catch (error) {
        if (stops(error) || (error instanceof PlatformHttpError && error.status === 401))
          throw error;
        skip(target.number, errorMessage(error));
      }
    }
  } catch (error) {
    if (error instanceof PlatformHttpError && error.status === 401)
      throw new EnvironmentError(
        `${name} refused the token (HTTP 401).`,
        'Check that the token is valid and can read pull or merge requests.',
      );
    if (!stops(error)) throw error;
    if (!collected.length)
      throw new EnvironmentError(
        `No outcomes collected: ${error.message}.`,
        'Try again after the reset, or ask for fewer with --recent.',
      );
    incomplete = {
      reason: error.message,
      ...(error instanceof RateLimitedError && error.resetAt ? { resetAt: error.resetAt } : {}),
    };
    warn(
      `Stopped early: ${error.message}. Kept ${collected.length} outcome(s); run it again later for the rest.`,
    );
  }
  result.artifacts.outcomes = outcomesDir(o.root);
  result.data = { platform, repository: collector.repository, collected, skipped, incomplete };
  result.message = `Collected ${collected.length} outcome(s)${skipped.length ? `, skipped ${skipped.length}` : ''}.`;
  return result;
}

/** Which changes to ask about: named ones, recent ones, the CI event's, or those published here. */
async function targetsOf(
  o: CollectOptions,
  collector: OutcomeCollector,
  records: readonly PublishRecord[],
  context: PlatformContext | undefined,
  skip: (number: number, reason: string) => void,
): Promise<Target[]> {
  if (o.number) return [{ number: o.number }];
  if (o.recent) return (await collector.recent(o.recent)).map((number) => ({ number }));
  if (context?.metadata.number) return [{ number: context.metadata.number }];
  // Every change a run here commented on, once, by its newest run (listRuns is newest first).
  const seen = new Set<string>();
  const out: Target[] = [];
  const repository = collector.repository.toLowerCase();
  for (const record of records) {
    const key = `${record.repository.toLowerCase()}\u0000${record.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (PROJECT_ID.test(record.repository))
      skip(
        record.number,
        `its run recorded GitLab project id ${record.repository}, not the project's path, so Covi cannot tell whether it is ${collector.repository}`,
      );
    else if (record.repository.toLowerCase() === repository)
      out.push({ number: record.number, commentId: record.comment.id });
  }
  return out;
}

/**
 * `covi outcomes report`: precision by certainty from `.covi/outcomes/`, and a short summary.
 * Only this repository's outcomes (`repository`, else the one its origin remote names), as in
 * the brief's calibration.
 */
export async function reportOutcomes(
  root: string,
  language: Language,
  options: { repository?: string } = {},
): Promise<{ result: WorkflowResult; summary: string }> {
  const result = baseResult('outcomes report');
  const git = new Git(root);
  const files = await readOutcomes(root, {
    git,
    warn: (message) => result.warnings.push(message),
  });
  const remote = await git.tryOut(['config', '--get', 'remote.origin.url']);
  const repository = options.repository || (remote ? repoNameFromRemote(remote) : undefined);
  if (!repository && files.length)
    result.warnings.push(
      'Covi cannot tell which repository this is: it has no origin remote. Pass --repository to report on one.',
    );
  const report = outcomeReport(repository ? outcomesOfRepository(files, { name: repository }) : []);
  const summary = summarizeOutcomes(report, language);
  result.artifacts.outcomes = outcomesDir(root);
  result.data = { ...report, summary };
  return { result, summary };
}
