import { relative } from 'node:path';
import { demonstrate } from '@covi/capture';
import {
  type CommentLinks,
  type CoviConfig,
  ExitCode,
  type Explanation,
  gateFailures,
  type Logger,
  type ParsedConfigInput,
  type Review,
  type ReviewContext,
  type Run,
  renderReview,
} from '@covi/core';
import {
  annotations,
  codeQualityReport,
  createPublisher,
  dotenvReport,
  type FetchLike,
  GitHubClient,
  type PlatformContext,
  type PublishOutcome,
  resolvePullRequest,
  toSarif,
  writeJobSummary,
  writeOutputs,
} from '@covi/platforms';
import { decideVideo, produceVideo, type VideoSpec } from '@covi/video';
import { startSession } from './session.ts';
import { coviVersion } from './version.ts';
import {
  applyVideoResult,
  baseResult,
  commentFromRun,
  reviewSession,
  WORKFLOW_DEFAULTS,
  type WorkflowResult,
} from './workflows.ts';

export interface CiOptions {
  platform: PlatformContext;
  repo: string;
  out?: string;
  explicit: ParsedConfigInput;
  configPath?: string;
  publish?: boolean;
  logger: Logger;
  spec: (config: CoviConfig) => VideoSpec;
  log: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

/**
 * The CI entry point: platform context → review (+ demonstration and video when worthwhile)
 * → native CI outputs → optional comment. Never interactive, never waits for input.
 */
export async function ciWorkflow(options: CiOptions): Promise<WorkflowResult> {
  const { platform, logger } = options;
  const session = await startSession({
    workflow: 'ci',
    selection: { repo: options.repo, scope: 'committed', fetch: true },
    out: options.out,
    explicit: options.explicit,
    workflowDefaults: WORKFLOW_DEFAULTS.ci,
    configPath: options.configPath,
    entryPoint:
      platform.platform === 'github'
        ? 'github-action'
        : platform.platform === 'gitlab'
          ? 'gitlab-ci'
          : 'cli',
    interactive: false,
    logger,
    platform,
    trustedConfig: platform.platform !== 'local',
  });
  const { run, context, config, change: resolvedChange } = session;
  const result = baseResult('ci', session);

  const spec = options.spec(config);
  const decision = decideVideo(context, { when: config.video.when });
  // Demonstrate whenever seeing the change helps the review, not only for a video: captured
  // pages, responses, and command output are evidence and can confirm regressions.
  const wantsDemo =
    (decision.render || context.demonstration.recommendation !== 'text-only') &&
    context.demonstration.runnable.available &&
    context.demonstration.kinds.some((k) => k !== 'architecture');
  // The execution policy (session.execution) keeps project commands from running where the event
  // forbids it; static pages can still be captured because serving files runs no project code.
  const demo = wantsDemo
    ? await run
        .stage('demonstrate', () =>
          demonstrate({
            run,
            change: resolvedChange,
            context,
            config,
            logger,
            execution: session.execution,
            // Vertical videos show phone-sized pages, so flows are captured there.
            prefer: spec.height > spec.width ? 'mobile' : 'desktop',
          }),
        )
        .catch((error: Error) => {
          run.warn(`Demonstration failed: ${error.message.split('\n')[0]}`);
          return undefined;
        })
    : undefined;
  const outcome = await reviewSession(session, resolvedChange, { demo });
  const failures = gateFailures(outcome.review.findings, config.review.failOn);
  result.verdict = outcome.review.verdict;
  result.findings = {
    total: outcome.review.findings.length,
    confirmed: outcome.review.findings.filter((f) => f.certainty === 'confirmed').length,
    likely: outcome.review.findings.filter((f) => f.certainty === 'likely').length,
    risk: outcome.review.findings.filter((f) => f.certainty === 'risk').length,
    question: outcome.review.findings.filter((f) => f.certainty === 'question').length,
  };
  result.gate = { failOn: config.review.failOn, failures: failures.length };
  for (const [name, rel] of Object.entries({
    review: 'review.md',
    reviewJson: 'review.json',
    explanation: 'explanation.md',
    summary: 'summary.md',
    comment: 'comment.md',
    manifest: 'run.json',
  }))
    result.artifacts[name] = run.path(rel);

  if (decision.render) {
    try {
      const produced = await run.stage('video', () =>
        produceVideo({
          run,
          change: resolvedChange,
          context,
          explanation: outcome.explanation,
          review: outcome.review,
          demo,
          spec,
          provider: session.provider,
          cacheDir: session.cacheDir,
          logger,
        }),
      );
      applyVideoResult(session, result, produced);
    } catch (error) {
      run.warn(`Video rendering failed: ${(error as Error).message.split('\n')[0]}`);
      result.video = {
        rendered: false,
        reason: `rendering failed: ${(error as Error).message.split('\n')[0]}`,
      };
    }
  } else {
    result.video = { rendered: false, reason: decision.reason };
    await run.skip('video', decision.reason);
  }

  await writeCiOutputs(run, platform, outcome.review, result, {
    ...options,
    annotations: config.publish.annotations,
  });

  if (options.publish ?? config.publish.comment) {
    const outcomePublish = await publishRun(run, platform, options.env, {
      videoMode: config.publish.video,
    });
    result.data = { publish: outcomePublish };
    if (outcomePublish.status === 'failed')
      run.warn(`Comment not posted: ${outcomePublish.reason}`);
  }

  if (failures.length) {
    result.ok = false;
    result.exitCode = ExitCode.gate;
    result.message = `${failures.length} finding(s) at or above "${config.review.failOn}" failed the review gate.`;
  }
  // Like every other command: the result carries the run's warnings, and only errors make a
  // run partial.
  for (const w of run.manifest.warnings) if (!result.warnings.includes(w)) result.warnings.push(w);
  await run.finish({
    status: failures.length ? 'gated' : run.manifest.errors.length ? 'partial' : 'success',
    exitCode: result.exitCode,
    verdict: outcome.review.verdict,
    findings: result.findings,
    gateFailures: failures.length,
    video: result.video
      ? {
          rendered: result.video.rendered,
          reason: result.video.reason,
          path: result.video.path ? relative(run.dir, result.video.path) : undefined,
          seconds: result.video.seconds,
        }
      : undefined,
  });
  return result;
}

async function writeCiOutputs(
  run: Run,
  platform: PlatformContext,
  review: Review,
  result: WorkflowResult,
  options: Pick<CiOptions, 'log' | 'env'> & { annotations: boolean },
): Promise<void> {
  const version = await coviVersion();
  await run.writeJson('reports/covi.sarif', toSarif(review.findings, version), 'report');
  result.artifacts.sarif = run.path('reports/covi.sarif');
  const values = {
    COVI_VERDICT: review.verdict,
    COVI_FINDINGS: review.findings.length,
    COVI_RUN_DIR: run.dir,
    COVI_VIDEO: result.video?.path,
  };
  if (platform.platform === 'github') {
    if (options.annotations) for (const line of annotations(review.findings)) options.log(line);
    if (options.env.GITHUB_STEP_SUMMARY) {
      const context = await run.readJson<ReviewContext>('context.json');
      const explanation = await run.readJson<Explanation>('explanation.json');
      await writeJobSummary(
        options.env.GITHUB_STEP_SUMMARY,
        renderReview(review, explanation, context),
      );
    }
    if (options.env.GITHUB_OUTPUT) {
      await writeOutputs(options.env.GITHUB_OUTPUT, {
        'run-dir': run.dir,
        verdict: review.verdict,
        'findings-count': review.findings.length,
        'video-path': result.video?.path,
        'summary-path': run.path('summary.md'),
        'review-path': run.path('review.md'),
        'sarif-path': run.path('reports/covi.sarif'),
        'gate-failures': result.gate?.failures,
      });
    }
  }
  if (platform.platform === 'gitlab') {
    // Code Quality is GitLab's inline annotation: --no-annotations leaves the report empty, so the
    // job's artifacts:reports entry still finds a valid file.
    await run.writeJson(
      'reports/gl-code-quality-report.json',
      options.annotations ? codeQualityReport(review.findings) : [],
      'report',
    );
    await run.writeText('reports/covi.env', dotenvReport(values), 'report');
    result.artifacts.codeQuality = run.path('reports/gl-code-quality-report.json');
  }
}

export interface PublishOptions {
  videoMode: 'link' | 'upload' | 'none';
  number?: number;
  artifactUrl?: string;
  videoUrl?: string;
  fetch?: FetchLike;
}

/** Posts (or updates) the summary comment for a finished run. */
export async function publishRun(
  run: Run,
  platform: PlatformContext,
  env: NodeJS.ProcessEnv,
  options: PublishOptions,
): Promise<PublishOutcome> {
  if (!platform.trusted && !options.number)
    return {
      status: 'skipped',
      reason:
        platform.platform === 'gitlab'
          ? 'merge request from a fork: its pipeline should not hold a token that can write to this project; see docs/gitlab-ci.md'
          : 'untrusted context (fork or pull_request_target); see docs/github-action.md for the workflow_run pattern',
    };
  let number = options.number;
  const token = env.COVI_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
  if (
    platform.platform === 'github' &&
    token &&
    env.GITHUB_REPOSITORY &&
    (platform.expectedHead || (!number && !platform.metadata.number))
  ) {
    const client = new GitHubClient({ token, apiUrl: env.GITHUB_API_URL, fetch: options.fetch });
    const target = await resolvePullRequest(client, env.GITHUB_REPOSITORY, platform, number);
    if (!target.number) return { status: 'skipped', reason: target.reason };
    number = target.number;
  }
  const { publisher, reason } = createPublisher(platform, env, { number, fetch: options.fetch });
  if (!publisher) return { status: 'skipped', reason };
  const links: CommentLinks = {
    run: platform.links.run ?? platform.links.job,
    artifacts: options.artifactUrl ?? platform.links.artifacts,
  };
  const video = run.manifest.artifacts.find((a) => a.kind === 'video');
  if (video && options.videoMode !== 'none') {
    const seconds = run.manifest.outcome?.video?.seconds;
    if (options.videoUrl) links.video = { url: options.videoUrl, seconds };
    else if (options.videoMode === 'upload' && publisher.uploadFile) {
      const uploaded = await publisher.uploadFile(run.path(video.path)).catch(() => undefined);
      if (uploaded) links.video = { url: uploaded.url, seconds, markdown: uploaded.markdown };
    }
    if (
      !links.video &&
      platform.platform === 'gitlab' &&
      platform.links.job &&
      env.CI_PROJECT_DIR &&
      run.dir.startsWith(env.CI_PROJECT_DIR)
    ) {
      links.video = {
        url: `${platform.links.job}/artifacts/file/${relative(env.CI_PROJECT_DIR, run.path(video.path))}`,
        seconds,
      };
    }
    if (!links.video && links.artifacts) links.video = { url: links.artifacts, seconds };
  }
  const { body } = await commentFromRun(run, links);
  return publisher.upsertComment(body);
}
