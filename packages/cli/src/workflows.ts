import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { demonstrate } from '@covi/capture';
import {
  analyzeWithModel,
  type BuiltReview,
  buildReview,
  type CodeChange,
  childEnv,
  type Demonstration,
  ExitCode,
  type Explanation,
  ExplanationSchema,
  execShell,
  explainHeuristically,
  type Finding,
  type FindingsFile,
  FindingsFileSchema,
  gateFailures,
  LANGUAGE_NAME,
  normalizeFinding,
  type ParsedConfigInput,
  ProviderError,
  parseConfigInput,
  parseOrThrow,
  type Review,
  type ReviewContext,
  ReviewFileSchema,
  renderBrief,
  renderComment,
  renderExplanation,
  renderReview,
  renderSummary,
  runRules,
  type SummaryFormat,
  type TestRunResult,
  TRUST_HINT,
  UsageError,
} from '@covi/core';
import type { PlatformContext } from '@covi/platforms';
import { decideVideo, type ProduceVideoResult, produceVideo, type VideoSpec } from '@covi/video';
import type { Session } from './session.ts';

/**
 * Defaults per workflow, between Covi's own defaults and the repository's configuration. Demos,
 * videos, and CI (whose videos default to vertical) also capture phone-sized pages.
 */
const BOTH_VIEWPORTS = parseConfigInput(
  { demo: { viewports: ['desktop', 'mobile'] } },
  'workflow defaults',
);
export const WORKFLOW_DEFAULTS: Partial<Record<string, ParsedConfigInput>> = {
  demo: BOTH_VIEWPORTS,
  video: BOTH_VIEWPORTS,
  ci: BOTH_VIEWPORTS,
};

export interface WorkflowResult {
  ok: boolean;
  command: string;
  exitCode: number;
  runId?: string;
  runDir?: string;
  change?: {
    base: string;
    head: string;
    files: number;
    additions: number;
    deletions: number;
    title?: string;
  };
  verdict?: Review['verdict'];
  findings?: { total: number; confirmed: number; likely: number; risk: number; question: number };
  gate?: { failOn: string; failures: number };
  artifacts: Record<string, string>;
  video?: { rendered: boolean; reason: string; path?: string; seconds?: number; qc?: string };
  warnings: string[];
  message?: string;
  data?: unknown;
}

export function baseResult(
  command: string,
  session?: Pick<Session, 'run' | 'context'>,
): WorkflowResult {
  const result: WorkflowResult = {
    ok: true,
    command,
    exitCode: ExitCode.ok,
    artifacts: {},
    warnings: [],
  };
  if (session) {
    result.runId = session.run.id;
    result.runDir = session.run.dir;
    const c = session.context.change;
    result.change = {
      base: c.base.sha,
      head: c.head.sha,
      files: c.stats.files,
      additions: c.stats.additions,
      deletions: c.stats.deletions,
      title: c.metadata.title,
    };
  }
  return result;
}

function findingCounts(findings: readonly Finding[]): NonNullable<WorkflowResult['findings']> {
  const count = (c: Finding['certainty']) => findings.filter((f) => f.certainty === c).length;
  return {
    total: findings.length,
    confirmed: count('confirmed'),
    likely: count('likely'),
    risk: count('risk'),
    question: count('question'),
  };
}

function artifact(
  session: Pick<Session, 'run'>,
  result: WorkflowResult,
  name: string,
  rel: string,
): void {
  result.artifacts[name] = session.run.path(rel);
}

/** Model analysis when a provider is configured; heuristics otherwise (or when the model fails). */
async function analysis(session: Session, ruleFindings: readonly Finding[], change: CodeChange) {
  if (!session.provider) return undefined;
  session.logger.step(
    `Analyzing with ${session.provider.id}${session.provider.model ? ` (${session.provider.model})` : ''}`,
  );
  try {
    return await session.run.stage('model-analysis', () =>
      analyzeWithModel(session.provider!, {
        change,
        context: session.context,
        ruleFindings,
        redactor: session.redactor,
        maxDiffChars: session.config.intelligence.maxDiffChars,
        runId: session.run.id,
      }),
    );
  } catch (error) {
    const reason = error instanceof ProviderError ? error.message : (error as Error).message;
    session.run.warn(`Model analysis failed; falling back to built-in heuristics (${reason}).`);
    session.logger.warn(`Model analysis failed: ${reason}`);
    return undefined;
  }
}

export async function runTests(session: Session): Promise<TestRunResult | undefined> {
  const command = session.config.test.command;
  if (!command) return undefined;
  const c = session.context.change;
  if (
    c.head.ref !== 'HEAD' &&
    c.head.ref !== 'WORKTREE' &&
    c.repository.branch &&
    c.head.ref !== c.repository.branch &&
    !session.run.manifest.environment.ci
  ) {
    session.run.warn(
      'Tests run only against the checked-out revision; skipped because the head is a different ref.',
    );
    return undefined;
  }
  session.logger.step(`Running tests: ${command}`);
  const env = childEnv({ extra: session.config.app.env, passThrough: session.config.app.passEnv });
  const outcome = await execShell(command, {
    cwd: c.repository.root,
    env,
    timeoutMs: session.config.test.timeout * 1000,
  });
  session.run.recordCommand({
    command,
    cwd: '.',
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
    purpose: 'tests',
  });
  const tail = session.redactor.redact(
    `${outcome.stdout}\n${outcome.stderr}`.trim().split('\n').slice(-40).join('\n'),
  );
  return {
    command,
    exitCode: outcome.exitCode,
    passed: outcome.exitCode === 0 && !outcome.timedOut,
    timedOut: outcome.timedOut,
    durationMs: outcome.durationMs,
    outputTail: tail,
  };
}

export interface ReviewOutcome {
  review: Review;
  explanation: Explanation;
  built: BuiltReview;
  findingsFile: FindingsFile;
}

/** Understand → explain → (demonstrate) → inspect risks, writing every artifact. */
export async function reviewSession(
  session: Session,
  change: CodeChange,
  options: { runTests?: boolean; demo?: Demonstration } = {},
): Promise<ReviewOutcome> {
  const { run, context, config, logger } = session;
  logger.step('Reviewing');
  const rules = await run.stage('rules', () =>
    runRules(change, context, { git: session.git, config, logger }),
  );
  const demoFindings = (options.demo?.findings ?? []).map((f) =>
    normalizeFinding(f, { kind: 'demo' }),
  );
  const ruleFindings = [...demoFindings, ...rules.findings];
  await run.writeJson(
    'rule-findings.json',
    { schemaVersion: 1, findings: ruleFindings, checked: rules.checked, errors: rules.errors },
    'findings',
  );

  const model = await analysis(session, ruleFindings, change);
  const { execution } = session;
  const testWithheld = execution.withheld.some((c) => c.key === 'test.command');
  const wantTests = options.runTests || config.review.runTests;
  const testsNote = !execution.allowed
    ? `Tests were not run: ${execution.reason}`
    : testWithheld
      ? `Tests were not run: test.command is not trusted on this machine yet. ${TRUST_HINT}`
      : undefined;
  if (wantTests && testsNote) run.warn(testsNote);
  const tests =
    wantTests && !testsNote ? await run.stage('tests', () => runTests(session)) : undefined;
  const explanation = model?.explanation ?? explainHeuristically(context);
  const findingsFile: FindingsFile = model?.findings ?? {
    schemaVersion: 1,
    findings: [],
    dismissed: [],
    checked: [],
    notVerified: [],
  };
  const built = buildReview({
    ruleFindings,
    authored: model?.findings,
    authoredSource: 'model',
    checked: rules.checked,
    config,
    context,
    tests,
    testsNote,
    demonstrated: Boolean(
      options.demo &&
        (options.demo.shots.length || options.demo.commands.length || options.demo.requests.length),
    ),
    generatedBy: model
      ? { provider: session.provider!.id, model: session.provider!.model }
      : { provider: 'heuristic' },
  });
  await writeReviewArtifacts(
    session,
    built,
    explanation,
    model ? findingsFile : { ...findingsFile, findings: ruleFindings },
  );
  return { review: built.review, explanation, built, findingsFile };
}

export async function writeReviewArtifacts(
  session: Pick<Session, 'run' | 'context'>,
  built: BuiltReview,
  explanation: Explanation,
  findingsFile: FindingsFile,
): Promise<void> {
  const { run, context } = session;
  await run.writeJson('explanation.json', explanation, 'explanation');
  await run.writeText('explanation.md', renderExplanation(explanation, context), 'explanation');
  await run.writeJson('findings.json', findingsFile, 'findings');
  await run.writeJson('review.json', { ...built.review, omitted: built.omitted }, 'review');
  await run.writeText('review.md', renderReview(built.review, explanation, context), 'review');
  await run.writeText('summary.md', renderSummary(explanation, built.review, context), 'summary');
  await run.writeText('comment.md', renderComment(built.review, explanation, context), 'comment');
}

function finishReview(
  session: Session,
  result: WorkflowResult,
  outcome: Pick<ReviewOutcome, 'review'>,
  gate = true,
): void {
  const failures = gate ? gateFailures(outcome.review.findings, session.config.review.failOn) : [];
  result.verdict = outcome.review.verdict;
  result.findings = findingCounts(outcome.review.findings);
  result.gate = { failOn: session.config.review.failOn, failures: failures.length };
  if (failures.length) {
    result.exitCode = ExitCode.gate;
    result.ok = false;
    result.message = `${failures.length} finding(s) at or above "${session.config.review.failOn}" failed the review gate.`;
  }
  for (const [name, rel] of Object.entries({
    review: 'review.md',
    explanation: 'explanation.md',
    findings: 'findings.json',
    reviewJson: 'review.json',
    summary: 'summary.md',
    context: 'context.json',
    manifest: 'run.json',
  }))
    artifact(session, result, name, rel);
}

// ---------------------------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------------------------

export async function analyzeWorkflow(
  session: Session,
  change: CodeChange,
): Promise<WorkflowResult> {
  const { run, context, config, logger } = session;
  const result = baseResult('analyze', session);
  const rules = await run.stage('rules', () =>
    runRules(change, context, { git: session.git, config, logger }),
  );
  await run.writeJson(
    'rule-findings.json',
    { schemaVersion: 1, findings: rules.findings, checked: rules.checked, errors: rules.errors },
    'findings',
  );
  await run.writeJson('explanation.draft.json', explainHeuristically(context), 'explanation');
  const brief = renderBrief(change, context, rules.findings, {
    runDir: relative(change.repository.root, run.dir) || run.dir,
    runId: run.id,
    redactor: session.redactor,
    maxDiffChars: config.intelligence.maxDiffChars,
  });
  await run.writeText('brief.md', brief, 'brief');
  result.findings = findingCounts(rules.findings);
  result.data = {
    intent: context.intent,
    size: context.size,
    demonstration: {
      value: context.demonstration.value,
      kinds: context.demonstration.kinds,
      recommendation: context.demonstration.recommendation,
    },
    ruleFindings: rules.findings.map((f) => ({
      id: f.id,
      title: f.title,
      certainty: f.certainty,
      severity: f.severity,
      location: f.location,
    })),
  };
  for (const [name, rel] of Object.entries({
    brief: 'brief.md',
    context: 'context.json',
    ruleFindings: 'rule-findings.json',
    explanationDraft: 'explanation.draft.json',
    diff: 'diff.patch',
    manifest: 'run.json',
  }))
    artifact(session, result, name, rel);
  return result;
}

export async function explainWorkflow(
  session: Session,
  change: CodeChange,
): Promise<WorkflowResult> {
  const result = baseResult('explain', session);
  const rules = await session.run.stage('rules', () =>
    runRules(change, session.context, {
      git: session.git,
      config: session.config,
      logger: session.logger,
    }),
  );
  const model = await analysis(session, rules.findings, change);
  const explanation = model?.explanation ?? explainHeuristically(session.context);
  await session.run.writeJson('explanation.json', explanation, 'explanation');
  await session.run.writeText(
    'explanation.md',
    renderExplanation(explanation, session.context),
    'explanation',
  );
  artifact(session, result, 'explanation', 'explanation.md');
  artifact(session, result, 'explanationJson', 'explanation.json');
  artifact(session, result, 'context', 'context.json');
  result.data = { explanation };
  return result;
}

export async function reviewWorkflow(
  session: Session,
  change: CodeChange,
  options: { runTests?: boolean; demo?: boolean; demoPlan?: unknown } = {},
): Promise<WorkflowResult> {
  const result = baseResult('review', session);
  const demo = options.demo ? await demoStage(session, change, options.demoPlan) : undefined;
  const outcome = await reviewSession(session, change, { runTests: options.runTests, demo });
  finishReview(session, result, outcome);
  if (demo) {
    artifact(session, result, 'captures', 'demo/captures.json');
    artifact(session, result, 'demo', 'demo/demo.md');
  }
  result.data = { review: outcome.review };
  return result;
}

async function demoStage(
  session: Session,
  change: CodeChange,
  plan?: unknown,
  prefer?: 'desktop' | 'mobile',
): Promise<Demonstration | undefined> {
  session.logger.step('Demonstrating the change');
  // Keep the plan the agent or user supplied next to what it produced.
  if (plan !== undefined) await session.run.writeJson('demo/plan.json', plan, 'capture');
  try {
    const demo = await session.run.stage('demonstrate', () =>
      demonstrate({
        run: session.run,
        change,
        context: session.context,
        config: session.config,
        logger: session.logger,
        plan,
        execution: session.execution,
        prefer,
      }),
    );
    await session.run.writeText('demo/demo.md', renderDemo(demo), 'capture');
    return demo;
  } catch (error) {
    session.run.warn(`Demonstration failed: ${(error as Error).message.split('\n')[0]}`);
    session.logger.warn(`Demonstration failed: ${(error as Error).message.split('\n')[0]}`);
    return undefined;
  }
}

export async function demoWorkflow(
  session: Session,
  change: CodeChange,
  options: { plan?: unknown },
): Promise<WorkflowResult> {
  const result = baseResult('demo', session);
  const demo = await demoStage(session, change, options.plan);
  if (!demo) {
    result.ok = false;
    result.exitCode = ExitCode.environment;
    result.message = 'The demonstration could not run; see warnings in run.json.';
    return result;
  }
  artifact(session, result, 'captures', 'demo/captures.json');
  artifact(session, result, 'demo', 'demo/demo.md');
  result.data = { demo };
  if (demo.shots.length + demo.commands.length + demo.requests.length === 0) {
    result.message =
      demo.skipped.map((s) => `${s.what}: ${s.reason}`).join('\n') || 'Nothing to demonstrate.';
  }
  return result;
}

export function renderDemo(demo: Demonstration): string {
  const out = ['# Demonstration', ''];
  for (const shot of demo.shots) {
    out.push(
      `## ${shot.kind === 'page' ? `Page ${shot.name}` : `${shot.flow} · step ${shot.step}: ${shot.label ?? ''}`} (${shot.viewport})`,
      '',
    );
    if (shot.before) out.push(`Before: ![before](../${shot.before.path})`, '');
    if (shot.after) out.push(`After: ![after](../${shot.after.path})`, '');
    if (shot.diff)
      out.push(
        `Changed pixels: ${(shot.diff.changedRatio * 100).toFixed(2)}%${shot.diff.path ? ` ([diff](../${shot.diff.path}))` : ''}`,
        '',
      );
  }
  for (const r of demo.requests) {
    out.push(
      `## ${r.method} ${r.path}`,
      '',
      `Before: ${r.before ? `HTTP ${r.before.status}` : 'n/a'} · After: HTTP ${r.after.status}${r.changed ? ' · changed' : ''}`,
      '',
    );
    if (r.shapeChange) out.push(`Shape change: ${r.shapeChange}.`, '');
  }
  for (const c of demo.commands) {
    out.push(`## \`${c.command}\``, '');
    if (c.before) out.push('Before:', '', '```', c.before.output, '```', '');
    out.push('After:', '', '```', c.after.output, '```', '');
  }
  if (demo.skipped.length) {
    out.push('## Not demonstrated', '');
    for (const s of demo.skipped) out.push(`- ${s.what}: ${s.reason}`);
    out.push('');
  }
  return out.join('\n');
}

export interface VideoOptions {
  spec: VideoSpec;
  force?: boolean;
  draft?: boolean;
  template?: string;
  storyboard?: unknown;
  workers?: number;
}

export async function videoWorkflow(
  session: Session,
  change: CodeChange,
  options: VideoOptions,
): Promise<WorkflowResult> {
  const result = baseResult('video', session);
  const decision = decideVideo(session.context, {
    when: session.config.video.when,
    force: options.force || Boolean(options.storyboard),
  });
  await session.run.writeJson(
    'video/decision.json',
    { ...decision, spec: options.spec, demonstration: session.context.demonstration },
    'storyboard',
  );
  const kinds = session.context.demonstration.kinds;
  const wantsDemo =
    decision.render &&
    kinds.some((k) => k !== 'architecture') &&
    session.context.demonstration.runnable.available;
  // Vertical videos show phone-sized pages, so flows are captured there.
  const prefer = options.spec.height > options.spec.width ? 'mobile' : 'desktop';
  const demo = wantsDemo ? await demoStage(session, change, undefined, prefer) : undefined;
  const outcome = await reviewSession(session, change, { demo });
  // Gates belong to review and CI; producing a video never fails on findings.
  finishReview(session, result, outcome, false);
  if (!decision.render) {
    result.video = { rendered: false, reason: decision.reason };
    await session.run.skip('video', decision.reason);
    return result;
  }
  const produced = await session.run.stage('video', () =>
    produceVideo({
      run: session.run,
      change,
      context: session.context,
      explanation: outcome.explanation,
      review: outcome.review,
      demo,
      spec: options.spec,
      storyboard: options.storyboard,
      template: options.template,
      provider: session.provider,
      cacheDir: session.cacheDir,
      logger: session.logger,
      draftOnly: options.draft,
      workers: options.workers,
      language: session.languageSettings,
      pronunciations: session.config.video.narration.pronunciations,
    }),
  );
  applyVideoResult(session, result, produced, options.draft);
  return result;
}

export function applyVideoResult(
  session: Pick<Session, 'run'>,
  result: WorkflowResult,
  produced: ProduceVideoResult,
  draft?: boolean,
): void {
  artifact(session, result, 'storyboard', 'video/storyboard.json');
  if (draft) {
    result.video = {
      rendered: false,
      reason: 'Storyboard drafted; edit video/storyboard.json, then run `covi render`.',
    };
    return;
  }
  result.video = {
    rendered: Boolean(produced.video),
    reason: produced.narration.enabled
      ? `narrated${produced.narration.language ? ` in ${LANGUAGE_NAME[produced.narration.language]}` : ''} with ${produced.narration.provider} (${produced.narration.voice})`
      : `captions only: ${produced.narration.reason}`,
    path: produced.video,
    seconds: produced.duration,
    qc: produced.qc?.status,
  };
  for (const [name, rel] of Object.entries({
    video: 'video/covi-review.mp4',
    poster: 'video/poster.png',
    contactSheet: 'video/contact-sheet.jpg',
    captions: 'video/captions.vtt',
    qc: 'video/qc.json',
    speech: 'video/speech.json',
    composition: 'video/composition/index.html',
  }))
    artifact(session, result, name, rel);
  if (produced.qc?.status === 'fail') result.warnings.push('Video QC failed; see video/qc.json.');
}

export async function renderWorkflow(
  session: Session,
  change: CodeChange,
  options: { spec: VideoSpec; storyboardPath?: string; workers?: number },
): Promise<WorkflowResult> {
  const result = baseResult('render', session);
  const { run } = session;
  const storyboardFile = options.storyboardPath ?? run.path('video/storyboard.json');
  const storyboard = JSON.parse(
    await readFile(storyboardFile, 'utf8').catch(() => {
      throw new UsageError(
        `No storyboard at ${storyboardFile}`,
        'Create one with `covi video --draft`, or pass --storyboard <file>.',
      );
    }),
  ) as unknown;
  const review = (await run.has('review.json'))
    ? (parseOrThrow(ReviewFileSchema, await run.readJson('review.json'), 'review.json') as Review)
    : undefined;
  const explanation = (await run.has('explanation.json'))
    ? (parseOrThrow(
        ExplanationSchema,
        await run.readJson('explanation.json'),
        'explanation.json',
      ) as Explanation)
    : explainHeuristically(session.context);
  const demo = (await run.has('demo/captures.json'))
    ? await run.readJson<Demonstration>('demo/captures.json')
    : undefined;
  const produced = await run.stage('video', () =>
    produceVideo({
      run,
      change,
      context: session.context,
      explanation,
      review: review ?? {
        schemaVersion: 1,
        verdict: 'looks-good',
        summary: '',
        findings: [],
        dismissed: [],
        checked: [],
        notVerified: [],
        generatedBy: { provider: 'agent' },
      },
      demo,
      spec: options.spec,
      storyboard,
      cacheDir: session.cacheDir,
      logger: session.logger,
      workers: options.workers,
      language: session.languageSettings,
      pronunciations: session.config.video.narration.pronunciations,
    }),
  );
  applyVideoResult(session, result, produced);
  return result;
}

/** Validates agent-authored explanation.json and findings.json and renders the reports. */
export async function reportWorkflow(session: Session): Promise<WorkflowResult> {
  const { run, context, config } = session;
  const result = baseResult('report', session);
  const explanation = (await run.has('explanation.json'))
    ? ({
        ...parseOrThrow(
          ExplanationSchema,
          await run.readJson('explanation.json'),
          'explanation.json',
          'Run `covi schema explanation` for the expected shape.',
        ),
        generatedBy: { provider: 'agent' },
      } as Explanation)
    : (() => {
        run.warn('No explanation.json found; using the structural explanation.');
        return explainHeuristically(context);
      })();
  const authored = (await run.has('findings.json'))
    ? parseOrThrow(
        FindingsFileSchema,
        await run.readJson('findings.json'),
        'findings.json',
        'Run `covi schema findings` for the expected shape.',
      )
    : undefined;
  if (!authored) run.warn('No findings.json found; the review contains rule findings only.');
  const rules = (await run.has('rule-findings.json'))
    ? ((await run.readJson<{ findings: Finding[]; checked?: string[] }>('rule-findings.json')) ?? {
        findings: [],
      })
    : { findings: [] as Finding[] };
  const ruleIds = new Set(rules.findings.map((f) => f.id));
  const unknown = (authored?.dismissed ?? []).filter((d) => !ruleIds.has(d.id));
  if (unknown.length)
    throw new UsageError(
      `findings.json dismisses unknown rule finding id(s): ${unknown.map((d) => d.id).join(', ')}`,
      'Use ids from rule-findings.json.',
    );
  const demo = (await run.has('demo/captures.json'))
    ? await run.readJson<Demonstration>('demo/captures.json')
    : undefined;
  const built = buildReview({
    ruleFindings: rules.findings,
    authored,
    authoredSource: 'agent',
    checked: rules.checked ?? [],
    config,
    context,
    demonstrated: Boolean(
      demo && demo.shots.length + demo.requests.length + demo.commands.length > 0,
    ),
    generatedBy: { provider: 'agent' },
  });
  await run.stage('report', () =>
    writeReviewArtifacts(
      session,
      built,
      explanation,
      authored ?? { schemaVersion: 1, findings: [], dismissed: [], checked: [], notVerified: [] },
    ),
  );
  finishReview(session, result, { review: built.review });
  result.data = { review: built.review };
  return result;
}

export async function summarizeWorkflow(
  session: Session,
  change: CodeChange,
  format: SummaryFormat | 'json',
): Promise<WorkflowResult> {
  const result = baseResult('summarize', session);
  const outcome = await reviewSession(session, change);
  const text =
    format === 'json'
      ? JSON.stringify(
          {
            headline: outcome.explanation.headline,
            summary: outcome.explanation.summary,
            changes: outcome.explanation.changes,
            verdict: outcome.review.verdict,
          },
          null,
          2,
        )
      : renderSummary(outcome.explanation, outcome.review, session.context, format);
  result.data = { summary: text };
  result.verdict = outcome.review.verdict;
  artifact(session, result, 'summary', 'summary.md');
  return result;
}

/** Re-renders the PR/MR comment from validated artifacts, never from free-form Markdown in the run. */
export async function commentFromRun(
  run: Session['run'],
  links: Parameters<typeof renderComment>[3],
): Promise<{ body: string; review: Review; context: ReviewContext }> {
  const review = parseOrThrow(
    ReviewFileSchema,
    await run.readJson('review.json'),
    'review.json',
  ) as Review;
  const explanation = parseOrThrow(
    ExplanationSchema,
    await run.readJson('explanation.json'),
    'explanation.json',
  ) as Explanation;
  const context = await run.readJson<ReviewContext>('context.json');
  return { body: renderComment(review, explanation, context, links), review, context };
}

export function platformSummaryTitle(platform: PlatformContext | undefined): string {
  return platform?.platform === 'gitlab' ? 'merge request' : 'pull request';
}
