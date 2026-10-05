import { mkdir } from 'node:fs/promises';
import {
  type CodeChange,
  type CoviConfig,
  childEnv,
  type DemoCommandResult,
  type Demonstration,
  type DemoRequestResult,
  type DemoShot,
  type ExecutionPolicy,
  execShell,
  type FindingInput,
  type Logger,
  type ReviewContext,
  type Run,
  TRUST_HINT,
} from '@covi/core';
import { type Browser, chromium } from 'playwright';
import { type RunningApp, startApp } from './app.ts';
import {
  capturePage,
  type PageCapture,
  runFlow,
  VIEWPORT_PRESETS,
  type ViewportName,
} from './browser.ts';
import { checkoutRevision, tempWorkspace } from './checkout.ts';
import { comparePngs, cropPng, readPng } from './pixels.ts';
import { type DemoPlan, flowViewport, planDemo } from './plan.ts';
import { describeShapeChange, type HttpResult, normalizeBody, performRequest } from './requests.ts';

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
}

type Revision = 'base' | 'head';

function slug(text: string): string {
  return (
    text
      .replace(/^\/+/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'home'
  );
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * The Demonstrate phase: run the software at both revisions and capture what a reviewer needs to
 * see. Everything observed is evidence; regressions observed here become findings.
 */
export async function demonstrate(input: DemonstrateInput): Promise<Demonstration> {
  const { run, change, context, config, logger } = input;
  const policy: ExecutionPolicy = input.execution ?? { allowed: true, withheld: [] };
  const withheld = new Set(policy.withheld.map((c) => c.key));
  const plan = planDemo(context, config, input.plan);
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
    result.skipped.push({ what: `app.start (${config.app.start})`, reason: policy.reason ?? '' });
    mode = undefined;
  }
  const commandsToRun = policy.allowed ? plan.commands : [];
  for (const command of policy.allowed ? [] : plan.commands)
    result.skipped.push({ what: `command "${command.name}"`, reason: policy.reason ?? '' });
  for (const c of policy.withheld.filter((c) => c.key.startsWith('demo.commands.')))
    result.skipped.push({
      what: `command "${c.key.slice('demo.commands.'.length)}"`,
      reason: `Not trusted on this machine yet. ${TRUST_HINT}`,
    });

  if (!wantsApp && commandsToRun.length === 0) {
    result.skipped.push({
      what: 'demonstration',
      reason: context.demonstration.reasons.at(-1) ?? 'Nothing to demonstrate.',
    });
    await run.writeJson('demo/captures.json', result, 'capture');
    return result;
  }
  if (wantsApp && !mode) {
    result.skipped.push({
      what: 'pages, flows, and requests',
      reason: !policy.allowed
        ? (policy.reason ?? '')
        : withheld.has('app.start') || withheld.has('app.url')
          ? `The app settings in the repository configuration are not trusted on this machine yet. ${TRUST_HINT}`
          : `Covi does not know how to run this project. Set app.start (and app.url if needed) or app.static in .covi/config.yml${runnable.suggestions.length ? `, e.g. ${runnable.suggestions[0]}` : ''}.`,
    });
  }
  const revisions: Revision[] = mode === 'url' ? ['head'] : ['base', 'head'];
  result.app = mode ? { mode, revisions } : undefined;

  const workspace = await tempWorkspace();
  const shotsDir = 'demo/screenshots';
  await mkdir(run.path(shotsDir), { recursive: true });
  let browser: Browser | undefined;
  const pages = new Map<string, Partial<Record<Revision, PageCapture>>>();
  const requests = new Map<string, Partial<Record<Revision, HttpResult>>>();
  const commands = new Map<
    string,
    Partial<Record<Revision, { exitCode: number | null; output: string }>>
  >();

  try {
    if (wantsBrowser && mode) browser = await chromium.launch();
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
          result.skipped.push({ what: `app at ${revision}`, reason: message.split('\n')[0]! });
          if (revision === 'head') {
            result.findings.push({
              title: 'The app does not start at the head revision',
              certainty:
                revisions.includes('base') && pages.size + requests.size > 0
                  ? 'confirmed'
                  : 'likely',
              severity: 'high',
              category: 'regression',
              evidence: message.slice(0, 600),
              explanation:
                'Covi could not start the configured app with this change applied, so the change likely breaks startup or the build.',
              source: { kind: 'demo', id: 'app-start' },
            });
          }
        }
      }
      try {
        if (app && browser) {
          for (const path of plan.pages) {
            for (const viewport of plan.viewports) {
              const key = `${path}|${viewport}`;
              const file = run.path(`${shotsDir}/${slug(path)}-${viewport}-${revision}.full.png`);
              logger.info(`  capturing ${path} (${viewport}, ${revision})`);
              try {
                const capture = await capturePage(browser, `${app.url}${path}`, viewport, file);
                pages.set(key, { ...pages.get(key), [revision]: capture });
              } catch (error) {
                result.skipped.push({
                  what: `${path} (${viewport}, ${revision})`,
                  reason: (error as Error).message.split('\n')[0]!,
                });
              }
            }
          }
          if (revision === 'head') {
            for (const flow of plan.flows) {
              const viewport = flowViewport(flow, plan.viewports, input.prefer);
              logger.info(`  running flow "${flow.name}" (${viewport})`);
              const outcome = await runFlow(browser, app.url, flow, viewport, (i) =>
                run.path(
                  `${shotsDir}/flow-${slug(flow.name)}-${String(i + 1).padStart(2, '0')}.png`,
                ),
              );
              if (outcome.error) {
                result.skipped.push({ what: `flow "${flow.name}"`, reason: outcome.error });
                result.findings.push({
                  title: `Flow "${flow.name}" fails at the head revision`,
                  certainty: 'likely',
                  severity: 'medium',
                  category: 'regression',
                  evidence: outcome.error,
                  explanation:
                    'A configured user flow could not be completed with this change applied.',
                  source: { kind: 'demo', id: 'flow-failure' },
                });
              }
              for (const [i, frame] of outcome.frames.entries()) {
                const size = await readPng(frame.file);
                result.shots.push({
                  id: `flow-${slug(flow.name)}-${i + 1}`,
                  kind: 'flow-step',
                  name: frame.label,
                  flow: flow.name,
                  step: i + 1,
                  viewport,
                  after: {
                    path: relativeTo(run, frame.file),
                    width: size.width,
                    height: size.height,
                  },
                  click: frame.click,
                  focus: frame.focus,
                  label: frame.label,
                });
              }
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

    result.shots.unshift(...(await assemblePageShots(run, pages, result.findings)));
    result.requests = compareRequests(plan, requests, result.findings);
    result.commands = compareCommands(plan, commands, result.findings);
  } finally {
    await browser?.close().catch(() => undefined);
    await workspace.dispose();
  }

  await run.writeJson('demo/captures.json', result, 'capture');
  for (const shot of result.shots) {
    for (const image of [shot.before, shot.after])
      if (image) await run.record(image.path, 'screenshot');
    if (shot.diff?.path) await run.record(shot.diff.path, 'screenshot');
  }
  return result;
}

function relativeTo(run: Run, file: string): string {
  return file.startsWith(run.dir) ? file.slice(run.dir.length + 1) : file;
}

/** Crops full-page captures to a viewport-sized window around the change and records diffs. */
async function assemblePageShots(
  run: Run,
  pages: Map<string, Partial<Record<Revision, PageCapture>>>,
  findings: FindingInput[],
): Promise<DemoShot[]> {
  const shots: DemoShot[] = [];
  for (const [key, captures] of pages) {
    const [path, viewport] = key.split('|') as [string, ViewportName];
    const preset = VIEWPORT_PRESETS[viewport];
    const windowSize = {
      width: preset.width * preset.deviceScaleFactor,
      height: preset.height * preset.deviceScaleFactor,
    };
    const id = `${slug(path)}-${viewport}`;
    const shot: DemoShot = { id, kind: 'page', name: path, viewport };
    let crop = { x: 0, y: 0, ...windowSize };
    if (captures.base && captures.head) {
      const diffPath = `demo/diffs/${id}.png`;
      await mkdir(run.path('demo/diffs'), { recursive: true });
      const diff = await comparePngs(captures.base.file, captures.head.file, run.path(diffPath));
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
          title: `New JavaScript error on ${path}`,
          certainty: 'confirmed',
          severity: 'medium',
          category: 'regression',
          location: undefined,
          evidence: newErrors.slice(0, 3).join('\n'),
          explanation: `Loading ${path} (${viewport}) logs errors at the head revision that do not occur at the base revision.`,
          source: { kind: 'demo', id: 'page-error' },
        });
      }
      if ((captures.base.status ?? 200) < 400 && (captures.head.status ?? 200) >= 400) {
        findings.push({
          title: `${path} returns HTTP ${captures.head.status} after the change`,
          certainty: 'confirmed',
          severity: 'high',
          category: 'regression',
          evidence: `Base: HTTP ${captures.base.status}; head: HTTP ${captures.head.status}.`,
          explanation: 'The page loads at the base revision but fails with this change.',
          source: { kind: 'demo', id: 'page-status' },
        });
      }
    }
    for (const revision of ['base', 'head'] as const) {
      const capture = captures[revision];
      if (!capture) continue;
      const out = `demo/screenshots/${id}-${revision === 'base' ? 'before' : 'after'}.png`;
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
): DemoRequestResult[] {
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
    const shapeChange = before ? describeShapeChange(before.body, after.body) : undefined;
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
      findings.push({
        title: `${request.method} ${request.path} changed its response shape`,
        certainty: 'confirmed',
        severity: 'high',
        category: 'api-compatibility',
        evidence: `Observed by calling ${request.method} ${request.path} at both revisions: ${shapeChange}.`,
        explanation:
          'Existing clients that parse the previous shape will break unless they are updated in the same release.',
        suggestion:
          'Version the endpoint, keep the old shape behind a parameter, or update every client in this change.',
        source: { kind: 'demo', id: 'api-shape' },
      });
    }
    if (before && before.status < 400 && after.status >= 500) {
      findings.push({
        title: `${request.method} ${request.path} now fails with HTTP ${after.status}`,
        certainty: 'confirmed',
        severity: 'high',
        category: 'regression',
        evidence: `Base: HTTP ${before.status}; head: HTTP ${after.status}. ${after.body.slice(0, 200)}`,
        explanation: 'The endpoint worked before this change and returns a server error with it.',
        source: { kind: 'demo', id: 'api-status' },
      });
    }
  }
  return out;
}

function compareCommands(
  plan: DemoPlan,
  observed: Map<string, Partial<Record<Revision, { exitCode: number | null; output: string }>>>,
  findings: FindingInput[],
): DemoCommandResult[] {
  const out: DemoCommandResult[] = [];
  for (const command of plan.commands) {
    const r = observed.get(command.name);
    if (!r?.head) continue;
    const changed =
      !r.base || r.base.output !== r.head.output || r.base.exitCode !== r.head.exitCode;
    out.push({ name: command.name, command: command.run, before: r.base, after: r.head, changed });
    if (r.base && r.base.exitCode === 0 && r.head.exitCode !== 0) {
      findings.push({
        title: `\`${command.run}\` now fails`,
        certainty: 'confirmed',
        severity: 'high',
        category: 'regression',
        evidence: `Exit code ${r.base.exitCode} at base, ${r.head.exitCode ?? 'timeout'} at head.\n${r.head.output.split('\n').slice(-6).join('\n')}`,
        explanation: 'The demo command succeeds without this change and fails with it.',
        source: { kind: 'demo', id: 'command-failure' },
      });
    }
  }
  return out;
}
