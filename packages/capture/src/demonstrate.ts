import { mkdir } from 'node:fs/promises';
import {
  type CodeChange,
  type CoviConfig,
  childEnv,
  DEMO_PATHS,
  type DemoCommandResult,
  type Demonstration,
  type DemoRecording,
  type DemoRequestResult,
  type DemoShot,
  type DemoSubject,
  type DemoTraceRef,
  demoPath,
  type ExecutionPolicy,
  evidenceId,
  execShell,
  type FindingInput,
  findingId,
  hasObservations,
  type Language,
  type Logger,
  mergeSubjectWithOutcomes,
  type Params,
  type Rect,
  type ReviewContext,
  type Run,
  type SubjectHandle,
  saveSubject,
  type Trace,
  t,
  writeEvidence,
  writeSubjectSnapshot,
} from '@covi/core';
import { type Browser, chromium } from 'playwright';
import { type RunningApp, startApp } from './app.ts';
import type { ScenarioObservation, StepPixels } from './behavior.ts';
import {
  capturePage,
  type PageCapture,
  stepId,
  VIEWPORT_PRESETS,
  type ViewportName,
} from './browser.ts';
import { checkoutRevision, tempWorkspace } from './checkout.ts';
import { flowScenario, pageScenario, uniqueIds } from './ids.ts';
import { comparePngs, cropPng } from './pixels.ts';
import { type DemoPlan, flowViewport, planDemo } from './plan.ts';
import { RecordingUnavailableError } from './recording.ts';
import { describeShapeChange, type HttpResult, normalizeBody, performRequest } from './requests.ts';
import {
  compareSteps,
  flowShots,
  type ObservedFlow,
  observeFlow,
  type RecordingNote,
  recordingStatus,
  runRelative,
  writeBehaviorDiff,
} from './scenarios.ts';
import { focusShots, type SubjectCaptures, subjectImages, subjectObservation } from './subject.ts';
import { TraceCollector } from './trace.ts';

/**
 * A demo finding's title in the run's language, and the id its English title gives it: SARIF and
 * GitLab track findings across runs by id, so the id must not change with the language.
 */
function titled(language: Language, source: string, key: string, params?: Params) {
  return { title: t(language, key, params), id: findingId(source, t('en', key, params)) };
}

export interface DemonstrateInput {
  run: Run;
  change: CodeChange;
  context: ReviewContext;
  config: CoviConfig;
  logger: Logger;
  /** Agent-authored plan (demo/plan.json contents), validated before use. */
  plan?: unknown;
  /** What may run. Default: everything configured (local runs with trusted configuration). */
  execution?: ExecutionPolicy;
  /**
   * The viewport the result will mostly be seen at (mobile for a vertical video). Flows run there
   * when the plan captures it; pages are captured at every planned viewport either way.
   */
  prefer?: ViewportName;
  /** The language of findings and notes. Default: English. */
  language?: Language;
  /**
   * Whether flows are recorded, and whether a recording that cannot be made fails the run (exit 3).
   * Default: `demo.record`, not required.
   */
  recording?: { enabled: boolean; required: boolean };
  /** Finds ffmpeg for converting recordings to MP4; without it, recordings stay WebM. */
  locateFfmpeg?: () => Promise<string | undefined>;
  /**
   * The subject model this run reads and updates: flows it replays when the plan names none, focus
   * for page captures taken at head only, and what this run saw at head. Absent: none of that.
   */
  subject?: SubjectHandle;
}

type Revision = 'base' | 'head';

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

async function launchBrowser(recordingRequired: boolean): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    // Without a browser nothing is recorded; that fails the run only when recording was asked for.
    if (recordingRequired)
      throw new RecordingUnavailableError((error as Error).message.split('\n')[0]!);
    throw error;
  }
}

/**
 * The Demonstrate phase: run the software at both revisions and capture what a reviewer needs to
 * see. Everything observed is evidence; regressions observed here become findings.
 */
export async function demonstrate(input: DemonstrateInput): Promise<Demonstration> {
  const { run, change, context, config, logger } = input;
  const language = input.language ?? 'en';
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `capture.${key}`, params);
  const hint = say('trustHint');
  const policy: ExecutionPolicy = input.execution ?? { allowed: true, withheld: [] };
  const withheld = new Set(policy.withheld.map((c) => c.key));
  // Covi does not drive a site it did not start (an app given by URL) with flows nobody asked for.
  const external = !config.app.start && config.app.url !== undefined;
  const plan = planDemo(context, config, input.plan, external ? undefined : input.subject?.model);
  const recording = input.recording ?? { enabled: config.demo.record, required: false };
  let ffmpeg: Promise<string | undefined> | undefined;
  const locateFfmpeg = () => {
    // A locator that fails counts as no ffmpeg: recordings stay WebM rather than go missing.
    ffmpeg ??= (input.locateFfmpeg?.() ?? Promise.resolve(undefined)).catch(() => undefined);
    return ffmpeg;
  };
  const result: Demonstration = {
    schemaVersion: 1,
    shots: [],
    commands: [],
    requests: [],
    skipped: [],
    findings: [],
  };
  const wantsBrowser = plan.pages.length > 0 || plan.flows.length > 0;
  const wantsApp = wantsBrowser || plan.requests.length > 0;
  const runnable = context.demonstration.runnable;
  let mode: 'static' | 'command' | 'url' | undefined = config.app.start
    ? 'command'
    : config.app.url
      ? 'url'
      : runnable.staticRoot !== undefined
        ? 'static'
        : undefined;
  // Serving files and browsing them runs no project code; starting the app and demo commands do.
  if (!policy.allowed && mode === 'command') {
    result.skipped.push({
      what: say('skip.appStart', { command: config.app.start ?? '' }),
      reason: policy.reason ?? '',
    });
    mode = undefined;
  }
  const commandsToRun = policy.allowed ? plan.commands : [];
  for (const command of policy.allowed ? [] : plan.commands)
    result.skipped.push({
      what: say('skip.command', { name: command.name }),
      reason: policy.reason ?? '',
    });
  for (const c of policy.withheld.filter((c) => c.key.startsWith('demo.commands.')))
    result.skipped.push({
      what: say('skip.command', { name: c.key.slice('demo.commands.'.length) }),
      reason: say('reason.notTrusted', { hint }),
    });

  if (!wantsApp && commandsToRun.length === 0) {
    result.skipped.push({
      what: say('skip.demonstration'),
      reason: context.demonstration.reasons.at(-1) ?? say('reason.nothing'),
    });
    await run.writeJson(DEMO_PATHS.captures, result, 'capture');
    return result;
  }
  if (wantsApp && !mode) {
    result.skipped.push({
      what: say('skip.pagesFlowsRequests'),
      reason: !policy.allowed
        ? (policy.reason ?? '')
        : withheld.has('app.start') || withheld.has('app.url')
          ? say('reason.appNotTrusted', { hint })
          : say('reason.cannotRun', {
              example: runnable.suggestions.length
                ? say('reason.example', { suggestion: runnable.suggestions[0]! })
                : '',
            }),
    });
  }
  const revisions: Revision[] = mode === 'url' ? ['head'] : ['base', 'head'];
  result.app = mode ? { mode, revisions } : undefined;

  const workspace = await tempWorkspace();
  await mkdir(run.path(DEMO_PATHS.screenshots), { recursive: true });
  let browser: Browser | undefined;
  const pages = new Map<string, Partial<Record<Revision, PageCapture>>>();
  const requests = new Map<string, Partial<Record<Revision, HttpResult>>>();
  const commands = new Map<
    string,
    Partial<Record<Revision, { exitCode: number | null; output: string }>>
  >();
  const pageTraces = new Map<
    string,
    { name: string; viewport: ViewportName; traces: Partial<Record<Revision, Trace>> }
  >();
  const flowIds = uniqueIds(plan.flows.map((f) => flowScenario(f.name)));
  const flows = new Map<number, Partial<Record<Revision, ObservedFlow>>>();
  const notes: RecordingNote[] = [];
  const windows = new Map<string, Rect>();

  try {
    if (wantsBrowser && mode)
      browser = await launchBrowser(
        recording.enabled && recording.required && plan.flows.length > 0,
      );
    for (const revision of revisions) {
      const needsCheckout = mode === 'static' || mode === 'command' || commandsToRun.length > 0;
      const checkout = needsCheckout
        ? await checkoutRevision(change, revision, workspace.dir)
        : undefined;
      let app: RunningApp | undefined;
      if (wantsApp && mode) {
        try {
          app = await startApp(checkout?.dir ?? change.repository.root, config, {
            mode,
            staticRoot: runnable.staticRoot,
            run,
            logger,
            revision,
          });
        } catch (error) {
          const message = (error as Error).message;
          // Kept as evidence: the app-start finding cites it, and a reviewer can read why.
          await run.writeText(demoPath.appLog(revision), `${message}\n`, 'log');
          result.skipped.push({
            what: say('skip.appAt', { revision }),
            reason: message.split('\n')[0]!,
          });
          if (revision === 'head') {
            result.findings.push({
              ...titled(language, 'app-start', 'capture.finding.appStart.title'),
              certainty:
                revisions.includes('base') && pages.size + requests.size > 0
                  ? 'confirmed'
                  : 'likely',
              severity: 'high',
              category: 'regression',
              evidence: message.slice(0, 600),
              explanation: say('finding.appStart.explanation'),
              source: { kind: 'demo', id: 'app-start' },
              evidenceIds: [evidenceId.appStart('head')],
            });
          }
        }
      }
      try {
        if (app && browser) {
          const origin = new URL(app.url).origin;
          for (const path of plan.pages) {
            for (const viewport of plan.viewports) {
              const key = `${path}|${viewport}`;
              const id = pageScenario(path, viewport);
              const file = run.path(demoPath.pageFull(id, revision));
              logger.info(`  capturing ${path} (${viewport}, ${revision})`);
              const collector = new TraceCollector(
                {
                  id: `${id}-${revision}`,
                  scenario: id,
                  kind: 'page',
                  name: path,
                  revision,
                  viewport,
                  path,
                },
                { origin, redactor: run.redactor, relative: (f) => runRelative(run, f) },
              );
              let trace: Trace;
              try {
                const capture = await capturePage(
                  browser,
                  `${app.url}${path}`,
                  viewport,
                  file,
                  collector,
                );
                pages.set(key, { ...pages.get(key), [revision]: capture });
                collector.stop();
                trace = collector.finish({ title: capture.title });
              } catch (error) {
                const reason = (error as Error).message.split('\n')[0]!;
                result.skipped.push({ what: `${path} (${viewport}, ${revision})`, reason });
                collector.stop();
                trace = collector.finish({ error: reason });
              }
              await run.writeJson(demoPath.trace(id, revision), trace, 'trace');
              const seen = pageTraces.get(id) ?? { name: path, viewport, traces: {} };
              seen.traces[revision] = trace;
              pageTraces.set(id, seen);
            }
          }
          for (const [index, flow] of plan.flows.entries()) {
            const viewport = flowViewport(flow, plan.viewports, input.prefer);
            logger.info(`  running flow "${flow.name}" (${viewport}, ${revision})`);
            const observed = await observeFlow({
              run,
              browser,
              baseUrl: app.url,
              flow,
              scenario: flowIds[index]!,
              viewport,
              revision,
              record: recording.enabled,
              ffmpeg: locateFfmpeg,
            });
            flows.set(index, { ...flows.get(index), [revision]: observed });
            if (observed.note) {
              if (observed.note.status === 'unavailable' && recording.required)
                throw new RecordingUnavailableError(
                  observed.note.detail ?? 'the recorder did not start',
                );
              notes.push(observed.note);
            }
            // A flow may fail at base because the change adds what it uses; only head failures count.
            if (revision === 'head' && observed.outcome.error) {
              result.skipped.push({
                what: say('skip.flow', { name: flow.name }),
                reason: observed.outcome.error,
              });
              result.findings.push({
                ...titled(language, 'flow-failure', 'capture.finding.flow.title', {
                  name: flow.name,
                }),
                // A flow replayed from the subject model was not asked for in this change: what
                // broke is worth a look, not a gate.
                certainty: plan.proposed.includes(flow.name) ? 'risk' : 'likely',
                severity: 'medium',
                category: 'regression',
                evidence: observed.outcome.error,
                explanation: say('finding.flow.explanation'),
                source: { kind: 'demo', id: 'flow-failure' },
                evidenceIds: [
                  evidenceId.trace(observed.trace.id),
                  ...(observed.recording ? [evidenceId.recording(observed.recording.id)] : []),
                ],
              });
            }
          }
        }
        if (app) {
          for (const request of plan.requests) {
            if (revision === 'base' && !request.compare) continue;
            try {
              const response = await performRequest(app.url, request);
              requests.set(request.name, {
                ...requests.get(request.name),
                [revision]: { ...response, body: run.redactor.redact(response.body) },
              });
            } catch (error) {
              result.skipped.push({
                what: `${request.method} ${request.path} (${revision})`,
                reason: (error as Error).message,
              });
            }
          }
        }
        if (checkout) {
          for (const command of commandsToRun) {
            if (revision === 'base' && !command.compare) continue;
            const env = childEnv({
              extra: { ...config.app.env, ...(app ? { APP_URL: app.url } : {}) },
              passThrough: config.app.passEnv,
            });
            const outcome = await execShell(command.run, {
              cwd: checkout.dir,
              env,
              timeoutMs: (command.timeout ?? 60) * 1000,
            });
            run.recordCommand({
              command: command.run,
              cwd: revision,
              exitCode: outcome.exitCode,
              durationMs: outcome.durationMs,
              timedOut: outcome.timedOut,
              purpose: `demo: ${command.name}`,
            });
            const output = run.redactor
              .redact(
                `${outcome.stdout}${outcome.stderr ? `${outcome.stdout ? '\n' : ''}${outcome.stderr}` : ''}`
                  .replace(ANSI, '')
                  .trimEnd(),
              )
              .slice(0, 8000);
            commands.set(command.name, {
              ...commands.get(command.name),
              [revision]: { exitCode: outcome.timedOut ? null : outcome.exitCode, output },
            });
          }
        }
      } finally {
        await app?.stop();
      }
    }

    const pixels = new Map<string, StepPixels>();
    const pageShots = await assemblePageShots(
      run,
      pages,
      result.findings,
      language,
      pixels,
      windows,
    );
    const observations = [...pageTraces].map(([id, seen]): ScenarioObservation => {
      const load = pixels.get(id);
      return {
        id,
        kind: 'page',
        name: seen.name,
        viewport: seen.viewport,
        traces: seen.traces,
        pixels: load ? { load } : {},
      };
    });
    const flowShotList: DemoShot[] = [];
    const recordings: DemoRecording[] = [];
    for (const [index, flow] of plan.flows.entries()) {
      const observed = flows.get(index);
      if (!observed) continue;
      const scenario = flowIds[index]!;
      const viewport = flowViewport(flow, plan.viewports, input.prefer);
      const { base, head } = observed;
      const stepPixels =
        base && head ? await compareSteps(run, scenario, viewport, base.trace, head.trace) : {};
      if (head)
        flowShotList.push(
          ...(await flowShots(run, {
            scenario,
            flow,
            viewport,
            head: head.outcome,
            base: base?.outcome,
            pixels: stepPixels,
          })),
        );
      observations.push({
        id: scenario,
        kind: 'flow',
        name: flow.name,
        viewport,
        traces: { ...(base ? { base: base.trace } : {}), ...(head ? { head: head.trace } : {}) },
        pixels: stepPixels,
      });
      for (const o of [base, head]) if (o?.recording) recordings.push(o.recording);
    }
    result.shots = [...pageShots, ...flowShotList];
    result.requests = compareRequests(plan, requests, result.findings, language);
    result.commands = compareCommands(plan, commands, result.findings, language);
    const traces: DemoTraceRef[] = observations.flatMap((o) =>
      (['base', 'head'] as const).flatMap((revision) => {
        const trace = o.traces[revision];
        return trace
          ? [
              {
                id: trace.id,
                scenario: o.id,
                kind: o.kind,
                revision,
                path: demoPath.trace(o.id, revision),
              },
            ]
          : [];
      }),
    );
    if (traces.length) result.traces = traces;
    if (recordings.length) result.recordings = recordings;
    // Say how recording went only when a flow ran: otherwise there was nothing to record.
    if (browser && flows.size)
      result.recording = recordingStatus(recording.enabled, notes, recordings.length);
    // Without base there is nothing to compare (an app given by URL runs at head only).
    if (revisions.includes('base') && observations.length) {
      const diff = await writeBehaviorDiff(run, observations);
      result.behavior = {
        path: DEMO_PATHS.behaviorDiff,
        scenarios: diff.summary.scenarios,
        changed: diff.summary.changed,
      };
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await workspace.dispose();
  }

  if (input.subject)
    result.subject = await keepSubject(
      run,
      input.subject,
      () =>
        headCaptures({
          run,
          revision: change.head.sha.slice(0, 12),
          plan,
          pages,
          windows,
          flows,
          result,
          prefer: input.prefer,
        }),
      plan.proposed,
      result.shots,
    );
  await run.writeJson(DEMO_PATHS.captures, result, 'capture');
  for (const shot of result.shots) {
    for (const image of [shot.before, shot.after])
      if (image) await run.record(image.path, 'screenshot');
    if (shot.diff?.path) await run.record(shot.diff.path, 'screenshot');
  }
  // What this run captured is now evidence: claims cite it by id.
  await writeEvidence(run);
  return result;
}

/** Crops full-page captures to a viewport-sized window around the change and records diffs. */
async function assemblePageShots(
  run: Run,
  pages: Map<string, Partial<Record<Revision, PageCapture>>>,
  findings: FindingInput[],
  language: Language,
  pixels: Map<string, StepPixels>,
  windows: Map<string, Rect>,
): Promise<DemoShot[]> {
  const shots: DemoShot[] = [];
  for (const [key, captures] of pages) {
    const [path, viewport] = key.split('|') as [string, ViewportName];
    const preset = VIEWPORT_PRESETS[viewport];
    const windowSize = {
      width: preset.width * preset.deviceScaleFactor,
      height: preset.height * preset.deviceScaleFactor,
    };
    const id = pageScenario(path, viewport);
    const shot: DemoShot = { id, kind: 'page', name: path, viewport };
    let crop = { x: 0, y: 0, ...windowSize };
    if (captures.base && captures.head) {
      const diffPath = demoPath.pageDiff(id);
      await mkdir(run.path(DEMO_PATHS.diffs), { recursive: true });
      const diff = await comparePngs(captures.base.file, captures.head.file, run.path(diffPath));
      pixels.set(id, {
        changedPixels: diff.changedPixels,
        changedRatio: diff.changedRatio,
        diff: diffPath,
        regions: diff.regions,
        ...(diff.bounds ? { bounds: diff.bounds } : {}),
      });
      if (diff.bounds) {
        const cy = diff.bounds.y + diff.bounds.height / 2;
        crop = {
          x: 0,
          y: Math.max(
            0,
            Math.min(
              cy - windowSize.height / 2,
              Math.min(captures.head.height, captures.base.height) - windowSize.height,
            ),
          ),
          ...windowSize,
        };
      }
      shot.diff = {
        path: diffPath,
        changedRatio: Number(diff.changedRatio.toFixed(5)),
        bounds: diff.bounds
          ? {
              x: diff.bounds.x - crop.x,
              y: diff.bounds.y - crop.y,
              width: diff.bounds.width,
              height: diff.bounds.height,
            }
          : undefined,
      };
      const newErrors = captures.head.errors.filter((e) => !captures.base!.errors.includes(e));
      if (newErrors.length) {
        findings.push({
          ...titled(language, 'page-error', 'capture.finding.pageError.title', { path }),
          certainty: 'confirmed',
          severity: 'medium',
          category: 'regression',
          location: undefined,
          evidence: newErrors.slice(0, 3).join('\n'),
          explanation: t(language, 'capture.finding.pageError.explanation', { path, viewport }),
          source: { kind: 'demo', id: 'page-error' },
          evidenceIds: [evidenceId.trace(`${id}-head`)],
        });
      }
      if ((captures.base.status ?? 200) < 400 && (captures.head.status ?? 200) >= 400) {
        findings.push({
          ...titled(language, 'page-status', 'capture.finding.pageStatus.title', {
            path,
            status: String(captures.head.status),
          }),
          certainty: 'confirmed',
          severity: 'high',
          category: 'regression',
          evidence: t(language, 'capture.finding.pageStatus.evidence', {
            base: String(captures.base.status),
            head: String(captures.head.status),
          }),
          explanation: t(language, 'capture.finding.pageStatus.explanation'),
          source: { kind: 'demo', id: 'page-status' },
          evidenceIds: [
            evidenceId.trace(`${id}-head`),
            evidenceId.screenshot(demoPath.pageCrop(id, 'after')),
          ],
        });
      }
    }
    // Where the crop sits in the full capture: the subject model places elements in it.
    windows.set(id, crop);
    for (const revision of ['base', 'head'] as const) {
      const capture = captures[revision];
      if (!capture) continue;
      const out = demoPath.pageCrop(id, revision === 'base' ? 'before' : 'after');
      const size = await cropPng(capture.file, crop, run.path(out));
      shot[revision === 'base' ? 'before' : 'after'] = { path: out, ...size };
    }
    if (shot.diff?.bounds && shot.after) {
      const b = shot.diff.bounds;
      shot.diff.bounds = {
        x: Math.max(0, b.x),
        y: Math.max(0, b.y),
        width: Math.min(shot.after.width, b.width),
        height: Math.min(shot.after.height - Math.max(0, b.y), b.height),
      };
      shot.focus = shot.diff.bounds;
    }
    shots.push(shot);
  }
  return shots.sort((a, b) => (b.diff?.changedRatio ?? 0) - (a.diff?.changedRatio ?? 0));
}

function compareRequests(
  plan: DemoPlan,
  observed: Map<string, Partial<Record<Revision, HttpResult>>>,
  findings: FindingInput[],
  language: Language,
): DemoRequestResult[] {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `capture.finding.${key}`, params);
  const out: DemoRequestResult[] = [];
  for (const request of plan.requests) {
    const r = observed.get(request.name);
    if (!r?.head) continue;
    const before = r.base;
    const after = r.head;
    const changed =
      !before ||
      before.status !== after.status ||
      normalizeBody(before.body) !== normalizeBody(after.body);
    const shapeChange = before ? describeShapeChange(before.body, after.body, language) : undefined;
    out.push({
      name: request.name,
      method: request.method,
      path: request.path,
      before,
      after,
      changed,
      shapeChange,
    });
    if (before && shapeChange) {
      const params = { method: request.method, path: request.path };
      findings.push({
        ...titled(language, 'api-shape', 'capture.finding.apiShape.title', params),
        certainty: 'confirmed',
        severity: 'high',
        category: 'api-compatibility',
        evidence: say('apiShape.evidence', { ...params, shape: shapeChange }),
        explanation: say('apiShape.explanation'),
        suggestion: say('apiShape.suggestion'),
        source: { kind: 'demo', id: 'api-shape' },
        evidenceIds: [evidenceId.http(out.length)],
      });
    }
    if (before && before.status < 400 && after.status >= 500) {
      findings.push({
        ...titled(language, 'api-status', 'capture.finding.apiStatus.title', {
          method: request.method,
          path: request.path,
          status: String(after.status),
        }),
        certainty: 'confirmed',
        severity: 'high',
        category: 'regression',
        evidence: say('apiStatus.evidence', {
          base: String(before.status),
          head: String(after.status),
          body: after.body.slice(0, 200),
        }),
        explanation: say('apiStatus.explanation'),
        source: { kind: 'demo', id: 'api-status' },
        evidenceIds: [evidenceId.http(out.length)],
      });
    }
  }
  return out;
}

function compareCommands(
  plan: DemoPlan,
  observed: Map<string, Partial<Record<Revision, { exitCode: number | null; output: string }>>>,
  findings: FindingInput[],
  language: Language,
): DemoCommandResult[] {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `capture.finding.command.${key}`, params);
  const out: DemoCommandResult[] = [];
  for (const command of plan.commands) {
    const r = observed.get(command.name);
    if (!r?.head) continue;
    const changed =
      !r.base || r.base.output !== r.head.output || r.base.exitCode !== r.head.exitCode;
    out.push({ name: command.name, command: command.run, before: r.base, after: r.head, changed });
    if (r.base && r.base.exitCode === 0 && r.head.exitCode !== 0) {
      findings.push({
        ...titled(language, 'command-failure', 'capture.finding.command.title', {
          command: command.run,
        }),
        certainty: 'confirmed',
        severity: 'high',
        category: 'regression',
        evidence: say('evidence', {
          base: String(r.base.exitCode),
          head: r.head.exitCode === null ? say('timeout') : String(r.head.exitCode),
          output: r.head.output.split('\n').slice(-6).join('\n'),
        }),
        explanation: say('explanation'),
        source: { kind: 'demo', id: 'command-failure' },
        evidenceIds: [evidenceId.terminal(out.length)],
      });
    }
  }
  return out;
}

/** What the head revision showed in this run, redacted like every artifact, for the subject model. */
function headCaptures(input: {
  run: Run;
  revision: string;
  plan: ReturnType<typeof planDemo>;
  pages: Map<string, Partial<Record<Revision, PageCapture>>>;
  windows: Map<string, Rect>;
  flows: Map<number, Partial<Record<Revision, ObservedFlow>>>;
  result: Demonstration;
  prefer?: ViewportName;
}): SubjectCaptures {
  const { run, plan } = input;
  const pages = [...input.pages].flatMap(([key, captures]) => {
    const [path, viewport] = key.split('|') as [string, ViewportName];
    const id = pageScenario(path, viewport);
    const head = captures.head;
    const window = input.windows.get(id);
    return head?.scan && window
      ? [{ id, ...(head.title ? { title: head.title } : {}), viewport, scan: head.scan, window }]
      : [];
  });
  // Head only: the model describes head, and a base frame is never indexed.
  const flows = plan.flows.flatMap((flow, index) => {
    const head = input.flows.get(index)?.head;
    if (!head) return [];
    return [
      {
        flow,
        viewport: flowViewport(flow, plan.viewports, input.prefer),
        labels: flow.steps.map((_, i) => head.trace.steps.find((s) => s.id === stepId(i))?.label),
        passed: !head.outcome.error,
        secret: Boolean(head.outcome.secret),
        frames: head.outcome.frames.flatMap((f) =>
          f.scan ? [{ image: runRelative(run, f.file), scan: f.scan }] : [],
        ),
      },
    ];
  });
  return run.redactor.redactDeep({
    revision: input.revision,
    pages,
    flows,
    requests: input.result.requests,
    commands: input.result.commands,
  });
}

/**
 * Gives the subject model what this run saw. Page captures taken at head only get the model's
 * focus, judged against the model as the run found it. The merged model and the image index
 * become this run's `demo/subject.json`, and the store takes the observation when it may be
 * written. The model is never worth a demonstration: whatever goes wrong here is a warning.
 */
async function keepSubject(
  run: Run,
  handle: SubjectHandle,
  observe: () => SubjectCaptures,
  proposed: string[],
  shots: DemoShot[],
): Promise<DemoSubject> {
  const summary: DemoSubject = {
    store: handle.source.store,
    proposed,
    focused: [],
    flows: [],
    saved: false,
  };
  try {
    const captures = observe();
    summary.focused = focusShots(handle.model, captures.pages, shots);
    const observation = subjectObservation(captures, handle.model);
    if (!hasObservations(observation)) return summary;
    const merged = mergeSubjectWithOutcomes(handle.model, observation, {
      expireAfter: handle.source.expireAfter,
    });
    summary.flows = merged.flows;
    await writeSubjectSnapshot(run, {
      schemaVersion: 1,
      store: handle.source.store,
      revision: captures.revision,
      model: merged.model,
      images: subjectImages(merged.model, captures),
    });
    summary.path = DEMO_PATHS.subject;
    if (handle.writable)
      summary.saved =
        (await saveSubject(handle.source, observation, {
          redactor: run.redactor,
          warn: (message) => run.warn(message),
        })) === 'saved';
  } catch (error) {
    run.warn(
      `Could not keep what this run saw in the subject model: ${(error as Error).message.split('\n')[0]}`,
    );
  }
  return summary;
}
