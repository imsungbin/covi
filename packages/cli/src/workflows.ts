import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { demonstrate, RecordingUnavailableError } from '@covi/capture';
import {
  analyzeWithModel,
  type BehaviorDiff,
  type BuiltReview,
  buildReview,
  type CodeChange,
  childEnv,
  citationProblems,
  citeChanges,
  code,
  DEMO_PATHS,
  type Demonstration,
  EvidenceFileSchema,
  type EvidenceIndex,
  ExitCode,
  type Explanation,
  ExplanationSchema,
  escapeMarkdown,
  execShell,
  explainHeuristically,
  type Finding,
  type FindingsFile,
  FindingsFileSchema,
  gateFailures,
  groundFinding,
  groundingNote,
  groundModelExplanation,
  groundModelFindings,
  indexEvidence,
  isBlockingCandidate,
  LANGUAGE_NAME,
  type Language,
  loadEvidence,
  normalizeFinding,
  type ParsedConfigInput,
  ProviderError,
  parseConfigInput,
  parseOrThrow,
  type Review,
  type ReviewContext,
  ReviewFileSchema,
  RUN_PATHS,
  renderBrief,
  renderComment,
  renderExplanation,
  renderReview,
  renderSummary,
  reportLanguage,
  runRules,
  type SummaryFormat,
  type TestRunResult,
  TRUST_HINT,
  t,
  truncate,
  UsageError,
  ungroundedStatements,
  writeEvidence,
} from '@covi/core';
import type { PlatformContext } from '@covi/platforms';
import {
  decideVideo,
  Media,
  type ProduceVideoResult,
  produceVideo,
  type VideoSpec,
} from '@covi/video';
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

/**
 * Whether flows are recorded, and whether failing to record is an error: only when someone asked
 * for it (a flag, COVI_DEMO_RECORD, or the repository's configuration), never by default.
 */
export function recordingOf(session: Pick<Session, 'config' | 'resolved'>): {
  enabled: boolean;
  required: boolean;
} {
  const enabled = session.config.demo.record;
  const source = session.resolved.provenance['demo.record'] ?? '';
  return { enabled, required: enabled && /^(repository|explicit)/.test(source) };
}

/** ffmpeg as video rendering finds it (COVI_FFMPEG, else PATH); recordings stay WebM without it. */
export function locateFfmpeg(): Promise<string | undefined> {
  return Media.locate().then(
    (media) => media.ffmpegPath,
    () => undefined,
  );
}

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
  video?: {
    rendered: boolean;
    reason: string;
    path?: string;
    seconds?: number;
    qc?: string;
    /** What music plays and where it came from; `hint` says how to change a default. */
    music?: { use: string; source: string; hint?: string };
    /** Only the sound changed, so the rendered frames were kept. */
    framesReused?: boolean;
  };
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

/**
 * The run's evidence as it stands: the registry Covi wrote, or one rebuilt for an older run. Ids a
 * claim computed from the raw change are redacted as the registry's were before they are looked up.
 */
async function evidenceOf(run: Session['run']): Promise<EvidenceIndex> {
  return indexEvidence((await loadEvidence(run)).evidence, (text) => run.redactor.redact(text));
}

/**
 * Covi's explanation of the change, citing only what the run has: a model's unknown ids are
 * dropped with a run warning, then each change cites its files' hunks.
 */
function citedExplanation(
  run: Session['run'],
  explanation: Explanation,
  known: EvidenceIndex,
  fromModel: boolean,
): Explanation {
  if (!fromModel) return citeChanges(explanation, known);
  const grounded = groundModelExplanation(explanation, known);
  for (const note of grounded.notes) run.warn(note);
  return citeChanges(grounded.explanation, known);
}

/** Model analysis when a provider is configured; heuristics otherwise (or when the model fails). */
async function analysis(
  session: Session,
  ruleFindings: readonly Finding[],
  change: CodeChange,
  evidence: EvidenceIndex,
) {
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
        language: session.language.language,
        evidence: evidence.items,
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
  evidence: EvidenceIndex;
}

/** Understand → explain → (demonstrate) → inspect risks, writing every artifact. */
export async function reviewSession(
  session: Session,
  change: CodeChange,
  options: { runTests?: boolean; demo?: Demonstration } = {},
): Promise<ReviewOutcome> {
  const { run, context, config, logger } = session;
  const language = session.language.language;
  logger.step('Reviewing');
  const rules = await run.stage('rules', () =>
    runRules(change, context, { git: session.git, config, logger, language }),
  );
  // What every finding may cite: the diff's hunks and what the demonstration captured.
  const known = await evidenceOf(run);
  // Demo findings cite what they observed; grounding them keeps findings.json one that
  // `covi report` accepts even if a capture they name was not kept.
  const demoFindings = (options.demo?.findings ?? []).map((f) => {
    const finding = normalizeFinding(f, { kind: 'demo' });
    const grounded = groundFinding(finding, known);
    const note = groundingNote('Demo finding', finding, grounded);
    if (note) run.warn(note);
    return grounded.finding;
  });
  const ruleFindings = [...demoFindings, ...rules.findings];
  await run.writeJson(
    'rule-findings.json',
    { schemaVersion: 1, findings: ruleFindings, checked: rules.checked, errors: rules.errors },
    'findings',
  );

  const model = await analysis(session, ruleFindings, change, known);
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
  // The output behind `test-run:tests`.
  if (tests)
    await run.writeText(RUN_PATHS.testsLog, `$ ${tests.command}\n${tests.outputTail}\n`, 'log');
  const explanation = citedExplanation(
    run,
    model?.explanation ?? explainHeuristically(context, language),
    known,
    Boolean(model),
  );
  // A model's findings are grounded like Covi's own; what grounding changed is a run warning, and
  // findings.json gets the grounded file, so `covi report` accepts the run again.
  let findingsFile: FindingsFile = {
    schemaVersion: 2,
    findings: [],
    dismissed: [],
    checked: [],
    notVerified: [],
  };
  if (model) {
    const grounded = groundModelFindings(model.findings, known);
    for (const note of grounded.notes) run.warn(note);
    findingsFile = grounded.findings;
  }
  const built = buildReview({
    ruleFindings,
    authored: model ? findingsFile : undefined,
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
    language,
  });
  const evidence = await writeReviewArtifacts(
    session,
    built,
    explanation,
    model ? findingsFile : { ...findingsFile, findings: ruleFindings },
  );
  return { review: built.review, explanation, built, findingsFile, evidence };
}

export async function writeReviewArtifacts(
  session: Pick<Session, 'run' | 'context' | 'language'>,
  built: BuiltReview,
  explanation: Explanation,
  findingsFile: FindingsFile,
): Promise<EvidenceIndex> {
  const { run, context } = session;
  // Rebuilt last, so it lists the test output too; the reports show what each finding cites.
  const evidence = indexEvidence(await writeEvidence(run), (text) => run.redactor.redact(text));
  // Headings follow what the authored files say they are written in, else the run's language.
  const language = reportLanguage(session.language.language, explanation, findingsFile);
  await run.writeJson('explanation.json', explanation, 'explanation');
  await run.writeText(
    'explanation.md',
    renderExplanation(explanation, context, language),
    'explanation',
  );
  await run.writeJson('findings.json', findingsFile, 'findings');
  await run.writeJson('review.json', { ...built.review, omitted: built.omitted }, 'review');
  await run.writeText(
    'review.md',
    renderReview(built.review, explanation, context, language, evidence),
    'review',
  );
  await run.writeText(
    'summary.md',
    renderSummary(explanation, built.review, context, 'markdown', language),
    'summary',
  );
  await run.writeText(
    'comment.md',
    renderComment(built.review, explanation, context, {}, language, evidence),
    'comment',
  );
  return evidence;
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
    evidence: RUN_PATHS.evidence,
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
  const language = session.language.language;
  const rules = await run.stage('rules', () =>
    runRules(change, context, { git: session.git, config, logger, language }),
  );
  await run.writeJson(
    'rule-findings.json',
    { schemaVersion: 1, findings: rules.findings, checked: rules.checked, errors: rules.errors },
    'findings',
  );
  // A draft that cites the hunks of each change, so an agent copying it starts grounded.
  await run.writeJson(
    'explanation.draft.json',
    citeChanges(explainHeuristically(context, language), await evidenceOf(run)),
    'explanation',
  );
  const brief = renderBrief(change, context, rules.findings, {
    runDir: relative(change.repository.root, run.dir) || run.dir,
    runId: run.id,
    redactor: session.redactor,
    maxDiffChars: config.intelligence.maxDiffChars,
    language,
  });
  await run.writeText('brief.md', brief, 'brief');
  result.findings = findingCounts(rules.findings);
  result.data = {
    language: session.language,
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
    diff: RUN_PATHS.diff,
    evidence: RUN_PATHS.evidence,
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
  const language = session.language.language;
  const rules = await session.run.stage('rules', () =>
    runRules(change, session.context, {
      git: session.git,
      config: session.config,
      logger: session.logger,
      language,
    }),
  );
  const known = await evidenceOf(session.run);
  const model = await analysis(session, rules.findings, change, known);
  const explanation = citedExplanation(
    session.run,
    model?.explanation ?? explainHeuristically(session.context, language),
    known,
    Boolean(model),
  );
  await session.run.writeJson('explanation.json', explanation, 'explanation');
  await session.run.writeText(
    'explanation.md',
    renderExplanation(explanation, session.context, reportLanguage(language, explanation)),
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
    artifact(session, result, 'captures', DEMO_PATHS.captures);
    artifact(session, result, 'demo', DEMO_PATHS.notes);
    if (demo.behavior) artifact(session, result, 'behaviorDiff', DEMO_PATHS.behaviorDiff);
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
  if (plan !== undefined) await session.run.writeJson(DEMO_PATHS.plan, plan, 'capture');
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
        language: session.language.language,
        recording: recordingOf(session),
        locateFfmpeg,
      }),
    );
    const behavior = demo.behavior
      ? await session.run.readJson<BehaviorDiff>(demo.behavior.path)
      : undefined;
    await session.run.writeText(
      DEMO_PATHS.notes,
      renderDemo(demo, session.language.language, behavior),
      'capture',
    );
    return demo;
  } catch (error) {
    // An explicit request to record that cannot be honored is the user's to see (exit 3).
    if (error instanceof RecordingUnavailableError) throw error;
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
  artifact(session, result, 'captures', DEMO_PATHS.captures);
  artifact(session, result, 'demo', DEMO_PATHS.notes);
  if (demo.behavior) artifact(session, result, 'behaviorDiff', DEMO_PATHS.behaviorDiff);
  result.data = { demo };
  if (demo.shots.length + demo.commands.length + demo.requests.length === 0) {
    result.message =
      demo.skipped.map((s) => `${s.what}: ${s.reason}`).join('\n') || 'Nothing to demonstrate.';
  }
  return result;
}

export function renderDemo(
  demo: Demonstration,
  language: Language = 'en',
  behavior?: BehaviorDiff,
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `demo.${key}`, params);
  const out = [`# ${say('title')}`, ''];
  for (const shot of demo.shots) {
    out.push(
      `## ${shot.kind === 'page' ? say('page', { name: shot.name }) : say('flowStep', { flow: shot.flow ?? '', step: shot.step ?? '', label: shot.label ?? '' })} (${shot.viewport})`,
      '',
    );
    if (shot.before) out.push(`${say('before')} ![before](../${shot.before.path})`, '');
    if (shot.after) out.push(`${say('after')} ![after](../${shot.after.path})`, '');
    if (shot.diff)
      out.push(
        say('changedPixels', {
          percent: (shot.diff.changedRatio * 100).toFixed(2),
          diff: shot.diff.path ? say('diffLink', { path: `../${shot.diff.path}` }) : '',
        }),
        '',
      );
  }
  for (const r of demo.requests) {
    out.push(
      `## ${r.method} ${r.path}`,
      '',
      say('request', {
        before: r.before ? `HTTP ${r.before.status}` : say('notApplicable'),
        after: String(r.after.status),
        changed: r.changed ? say('changed') : '',
      }),
      '',
    );
    if (r.shapeChange) out.push(say('shapeChange', { shape: r.shapeChange }), '');
  }
  for (const c of demo.commands) {
    out.push(`## \`${c.command}\``, '');
    if (c.before) out.push(say('before'), '', '```', c.before.output, '```', '');
    out.push(say('after'), '', '```', c.after.output, '```', '');
  }
  out.push(...renderRecordings(demo, say));
  if (behavior) out.push(...renderBehavior(behavior, say));
  if (demo.skipped.length) {
    out.push(`## ${say('notDemonstrated')}`, '');
    for (const s of demo.skipped) out.push(`- ${s.what}: ${s.reason}`);
    out.push('');
  }
  return out.join('\n');
}

type Say = (key: string, params?: Record<string, string | number>) => string;

/** One line of text that came from the page (a URL, a console message, an error), as inline code. */
function inline(text: string): string {
  return code(truncate(text.replace(/\s+/g, ' ').trim(), 160));
}

function recordingNote(status: Demonstration['recording'], say: Say): string | undefined {
  if (status?.status !== 'webm' && status?.status !== 'unavailable') return undefined;
  const cause = say(
    `recording.cause.${status.cause ?? (status.status === 'webm' ? 'convert-failed' : 'no-recorder')}`,
  );
  return status.detail
    ? say('recording.withDetail', { cause, detail: inline(status.detail) })
    : say('recording.plain', { cause });
}

function renderRecordings(demo: Demonstration, say: Say): string[] {
  const recordings = demo.recordings ?? [];
  const note = recordingNote(demo.recording, say);
  if (!recordings.length && !note) return [];
  const out = [`## ${say('recordings')}`, ''];
  for (const r of recordings)
    out.push(
      `- ${say('recording.item', {
        name: escapeMarkdown(r.flow),
        revision: say(`revision.${r.revision}`),
        file: escapeMarkdown(r.path.split('/').at(-1)!),
        path: `../${r.path}`,
      })}`,
    );
  if (recordings.length) out.push('');
  if (note) out.push(note, '');
  return out;
}

/** A step counts from a few dozen pixels, so a share too small for two decimals is still not 0. */
function percentOf(ratio: number): string {
  const percent = (ratio * 100).toFixed(2);
  return ratio > 0 && percent === '0.00' ? '<0.01' : percent;
}

function whereOf(step: string, say: Say): string {
  const n = /^s(\d+)$/.exec(step)?.[1];
  if (n) return say('behavior.where.step', { n: Number(n) });
  return say(`behavior.where.${step === 'open' || step === 'load' ? step : 'end'}`);
}

function statusOf(ref: { status?: number; failure?: string }, say: Say): string {
  if (ref.status !== undefined) return `HTTP ${ref.status}`;
  return ref.failure ? inline(ref.failure) : say('behavior.noResponse');
}

/** One block per scenario that changed or could not be compared, then a count of the rest. */
function renderBehavior(behavior: BehaviorDiff, say: Say): string[] {
  if (!behavior.scenarios.length) return [];
  const out = [`## ${say('behavior.title')}`, ''];
  for (const s of behavior.scenarios.filter((x) => x.status !== 'unchanged')) {
    out.push(
      `### ${say('behavior.scenario', { name: escapeMarkdown(s.name), viewport: s.viewport })}`,
      '',
    );
    const lines: string[] = [];
    if (s.missing)
      lines.push(
        say('behavior.incomplete', {
          revision: say(`revision.${s.missing === 'base' ? 'head' : 'base'}`),
        }),
      );
    for (const revision of ['base', 'head'] as const) {
      const error = s.failure?.[revision];
      if (error)
        lines.push(
          say('behavior.failed', { revision: say(`revision.${revision}`), error: inline(error) }),
        );
    }
    for (const step of s.steps) {
      const where = whereOf(step.id, say);
      const label = step.label ? say('behavior.label', { label: escapeMarkdown(step.label) }) : '';
      if (step.base !== step.head)
        lines.push(
          say('behavior.stepState', {
            where,
            label,
            base: say(`behavior.state.${step.base}`),
            head: say(`behavior.state.${step.head}`),
          }),
        );
      if (step.changedRatio !== undefined)
        lines.push(
          say('behavior.step', {
            where,
            label,
            percent: percentOf(step.changedRatio),
            diff: step.diff ? say('diffLink', { path: `../${step.diff}` }) : '',
          }),
        );
    }
    for (const r of s.network.changed)
      lines.push(
        say('behavior.requestChanged', {
          request: inline(`${r.method} ${r.url}`),
          base: statusOf(r.base, say),
          head: statusOf(r.head, say),
        }),
      );
    for (const r of s.network.added)
      lines.push(
        say('behavior.requestAdded', {
          request: inline(`${r.method} ${r.url}`),
          status: statusOf(r, say),
        }),
      );
    for (const r of s.network.removed)
      lines.push(
        say('behavior.requestRemoved', {
          request: inline(`${r.method} ${r.url}`),
          status: statusOf(r, say),
        }),
      );
    for (const m of s.console.added)
      lines.push(say('behavior.consoleAdded', { text: inline(m.text) }));
    for (const m of s.console.removed)
      lines.push(say('behavior.consoleRemoved', { text: inline(m.text) }));
    for (const d of s.timing.steps)
      lines.push(
        say('behavior.timing', { where: whereOf(d.step, say), base: d.baseMs, head: d.headMs }),
      );
    out.push(...lines.map((line) => `- ${line}`), '');
  }
  const same = behavior.scenarios.filter((x) => x.status === 'unchanged').length;
  if (same) out.push(say('behavior.same', { count: same }), '');
  return out;
}

export interface VideoOptions {
  spec: VideoSpec;
  force?: boolean;
  draft?: boolean;
  template?: string;
  storyboard?: unknown;
  workers?: number;
  /** Nobody chose the music (request, flags, configuration, or an answer): the default applies. */
  musicDefault?: boolean;
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
    {
      ...decision,
      spec: options.spec,
      // `covi render` keeps the drafted music, and whether it was a default (for the hint).
      ...(options.musicDefault ? { musicDefault: true } : {}),
      demonstration: session.context.demonstration,
    },
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
      language: session.language.language,
      languageSettings: session.languageSettings,
      pronunciations: session.config.video.narration.pronunciations,
      evidence: outcome.evidence,
    }),
  );
  await applyVideoResult(session, result, produced, {
    draft: options.draft,
    musicDefault: options.musicDefault,
  });
  return result;
}

export async function applyVideoResult(
  session: Pick<Session, 'run' | 'language'>,
  result: WorkflowResult,
  produced: ProduceVideoResult,
  options: { draft?: boolean; musicDefault?: boolean } = {},
): Promise<void> {
  const { draft } = options;
  artifact(session, result, 'storyboard', 'video/storyboard.json');
  if (await session.run.has('video/score.json'))
    artifact(session, result, 'score', 'video/score.json');
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
  const music = produced.audio?.music;
  if (music) {
    result.video.music = { use: music.use, source: music.source };
    // Nobody chose the music, and the theme plays: say once how to change it.
    if (options.musicDefault && music.source === 'theme')
      result.video.music.hint = t(session.language.language, 'video.musicHint', {
        run: session.run.id,
      });
  }
  if (produced.framesReused) {
    result.video.framesReused = true;
    result.message = 'Reused the rendered frames; only the audio changed.';
  }
  for (const [name, rel] of Object.entries({
    video: 'video/covi-review.mp4',
    poster: 'video/poster.png',
    contactSheet: 'video/contact-sheet.jpg',
    captions: 'video/captions.vtt',
    qc: 'video/qc.json',
    speech: 'video/speech.json',
    audio: 'video/audio.json',
    music: 'video/music.wav',
    score: 'video/score.json',
    frames: 'video/frames.json',
    composition: 'video/composition/index.html',
  }))
    if (name === 'video' || (await session.run.has(rel))) artifact(session, result, name, rel);
  if (produced.qc?.status === 'fail') result.warnings.push('Video QC failed; see video/qc.json.');
}

export async function renderWorkflow(
  session: Session,
  change: CodeChange,
  options: {
    spec: VideoSpec;
    storyboardPath?: string;
    workers?: number;
    /** Nobody chose the music, at draft time or now: the result says how to change it. */
    musicDefault?: boolean;
  },
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
    : explainHeuristically(session.context, session.language.language);
  const demo = (await run.has(DEMO_PATHS.captures))
    ? await run.readJson<Demonstration>(DEMO_PATHS.captures)
    : undefined;
  const evidence = await evidenceOf(run);
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
      // Writes composed music when no score is in the run; an authored storyboard is not refined.
      provider: session.provider,
      cacheDir: session.cacheDir,
      logger: session.logger,
      workers: options.workers,
      language: session.language.language,
      languageSettings: session.languageSettings,
      pronunciations: session.config.video.narration.pronunciations,
      evidence,
    }),
  );
  await applyVideoResult(session, result, produced, { musicDefault: options.musicDefault });
  return result;
}

/** Validates agent-authored explanation.json and findings.json and renders the reports. */
export async function reportWorkflow(session: Session): Promise<WorkflowResult> {
  const { run, context, config } = session;
  const result = baseResult('report', session);
  // --language rewrites the reports in another language; the run records it.
  if (session.languageSettings.flag) run.setLanguage(session.language);
  const known = await evidenceOf(run);
  const agentExplanation = (await run.has('explanation.json'))
    ? ({
        ...parseOrThrow(
          ExplanationSchema,
          await run.readJson('explanation.json'),
          'explanation.json',
          'Run `covi schema explanation` for the expected shape.',
        ),
        generatedBy: { provider: 'agent' },
      } as Explanation)
    : undefined;
  if (!agentExplanation) run.warn('No explanation.json found; using the structural explanation.');
  const explanation =
    agentExplanation ??
    citeChanges(explainHeuristically(context, session.language.language), known);
  const authored = (await run.has('findings.json'))
    ? parseOrThrow(
        FindingsFileSchema,
        await run.readJson('findings.json'),
        'findings.json',
        'Run `covi schema findings` for the expected shape.',
      )
    : undefined;
  if (!authored) run.warn('No findings.json found; the review contains rule findings only.');
  const problems = citationProblems(known, {
    explanation: agentExplanation,
    findings: authored?.findings,
  });
  if (problems.length)
    throw new UsageError(
      `Cited evidence is not in this run:\n  ${problems.join('\n  ')}`,
      `List the run's evidence with \`covi evidence --run ${run.id}\`. Evidence ids look like \`diff-hunk:src/app.ts:40\` (the + start of a hunk's @@ header), \`trace:flow-post-head#n2\`, or \`screenshot:home-desktop-after\`.`,
    );
  if (authored?.schemaVersion === 1) {
    const uncited = authored.findings.filter(
      (f) => isBlockingCandidate(f) && !f.evidenceIds?.length,
    ).length;
    if (uncited)
      run.warn(
        `findings.json is schemaVersion 1, so ${uncited} confirmed or likely finding(s) were accepted without evidence ids; version 2 requires them.`,
      );
  }
  const ungrounded = agentExplanation ? ungroundedStatements(agentExplanation) : [];
  if (ungrounded.length)
    run.warn(
      `explanation.json: ${ungrounded.length} statement(s) cite no evidence: ${ungrounded.join(', ')}.`,
    );
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
  const demo = (await run.has(DEMO_PATHS.captures))
    ? await run.readJson<Demonstration>(DEMO_PATHS.captures)
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
    language: reportLanguage(session.language.language, authored, explanation),
  });
  await run.stage('report', () =>
    writeReviewArtifacts(
      session,
      built,
      explanation,
      authored ?? { schemaVersion: 2, findings: [], dismissed: [], checked: [], notVerified: [] },
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
      : renderSummary(
          outcome.explanation,
          outcome.review,
          session.context,
          format,
          reportLanguage(session.language.language, outcome.explanation),
        );
  result.data = { summary: text };
  result.verdict = outcome.review.verdict;
  artifact(session, result, 'summary', 'summary.md');
  artifact(session, result, 'evidence', RUN_PATHS.evidence);
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
  const language = reportLanguage(run.manifest.language?.value ?? 'en', explanation, review);
  // In the workflow_run pattern this file comes from an untrusted artifact: validated, then only
  // ever rendered as escaped text or a checked link.
  const evidence = (await run.has(RUN_PATHS.evidence))
    ? indexEvidence(
        parseOrThrow(EvidenceFileSchema, await run.readJson(RUN_PATHS.evidence), 'evidence.json'),
        (text) => run.redactor.redact(text),
      )
    : undefined;
  return {
    body: renderComment(review, explanation, context, links, language, evidence),
    review,
    context,
  };
}

export function platformSummaryTitle(platform: PlatformContext | undefined): string {
  return platform?.platform === 'gitlab' ? 'merge request' : 'pull request';
}
