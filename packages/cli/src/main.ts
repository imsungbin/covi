import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { FOX_FRAME, foxMarkSvg, foxSvg, logoSvg } from '@covi/brand';
import { DemoPlanSchema } from '@covi/capture';
import {
  ConfigInputSchema,
  CoviError,
  configFromEnv,
  describeCommands,
  ExitCode,
  ExplanationSchema,
  errorMessage,
  FindingsFileSchema,
  LANGUAGE_INPUTS,
  listRuns,
  listSkills,
  loadRepositoryConfig,
  loadSkill,
  NoChangesError,
  type ParsedConfigInput,
  parseConfigInput,
  parseLanguageSetting,
  parseOrThrow,
  parseYamlConfig,
  Run,
  type RunOutcome,
  repositoryCommands,
  resolveConfig,
  TrustStore,
} from '@covi/core';
import { detectPlatform, platformContext } from '@covi/platforms';
import {
  applyAnswers,
  followUpQuestions,
  loadTemplates,
  planVideo,
  resolveVideoSpec,
  respecVideo,
  ScoreSchema,
  StoryboardSchema,
  type VideoQuestion,
  type VideoRequest,
  type VideoSpec,
} from '@covi/video';
import { Command, InvalidArgumentError, Option } from 'commander';
import pc from 'picocolors';
import { z } from 'zod';
import { ciWorkflow, publishRun } from './ci.ts';
import { browserCheck, type DoctorCheck, doctor, installBrowser } from './doctor.ts';
import { getExample, listExamples, materializeExample } from './examples.ts';
import { initConfig } from './init.ts';
import { openSession, reloadChange, repoRoot, type Session, startSession } from './session.ts';
import { installSkills, type SkillTarget } from './skills.ts';
import {
  ask,
  isInteractive,
  printJson,
  printResult,
  TerminalLogger,
  terminalQuestion,
  type UiOptions,
} from './ui.ts';
import { coviVersion, coviVersionSync } from './version.ts';
import {
  analyzeWorkflow,
  baseResult,
  demoWorkflow,
  explainWorkflow,
  renderWorkflow,
  reportWorkflow,
  reviewWorkflow,
  summarizeWorkflow,
  videoWorkflow,
  WORKFLOW_DEFAULTS,
  type WorkflowResult,
} from './workflows.ts';

interface GlobalFlags {
  repo: string;
  config?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
  yes?: boolean;
  trustCommands?: boolean;
}

function ui(cmd: Command): UiOptions & { flags: GlobalFlags } {
  const flags = cmd.optsWithGlobals<GlobalFlags>();
  return {
    json: Boolean(flags.json),
    quiet: Boolean(flags.quiet),
    verbose: Boolean(flags.verbose),
    color: flags.color !== false && !process.env.NO_COLOR,
    flags,
  };
}

/** The repository path from --repo; an empty value is a usage error, not "the current directory". */
function repoPath(value: string): string {
  if (!value.trim())
    throw new CoviError('--repo is empty.', {
      exitCode: ExitCode.usage,
      hint: 'Pass a repository path, or omit --repo to use the current directory.',
    });
  return resolve(value);
}

/** Where runs live: output.dir from configuration (no commands are read, so no trust needed). */
async function runsDirOf(root: string, flags: GlobalFlags): Promise<string> {
  const loaded = await loadRepositoryConfig(
    root,
    flags.config ? { kind: 'file', path: resolve(flags.config) } : { kind: 'worktree' },
  );
  const env = configFromEnv(process.env);
  return resolveConfig([
    ...(loaded.values ? [{ name: 'repository' as const, values: loaded.values }] : []),
    ...(Object.keys(env).length ? [{ name: 'explicit' as const, values: env }] : []),
  ]).config.output.dir;
}

function printChecks(checks: readonly DoctorCheck[], json: boolean): void {
  if (json) {
    printJson(checks);
    return;
  }
  for (const c of checks) {
    const mark =
      c.status === 'ok' ? pc.green('✓') : c.status === 'warn' ? pc.yellow('!') : pc.red('✗');
    process.stdout.write(
      `${mark} ${pc.bold(c.id.padEnd(13))} ${c.message}${c.hint ? pc.dim(`  → ${c.hint}`) : ''}\n`,
    );
  }
}

/** Two commit ids name the same commit: the shorter (at least 7 characters) prefixes the longer. */
function sameCommit(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

/** Parses a whole number in [min, max]; anything else is a usage error naming the option. */
function int(min: number, max: number): (value: string) => number {
  return (value) => {
    const n = Number(value);
    if (!/^\d+$/.test(value.trim()) || n < min || n > max)
      throw new InvalidArgumentError(`expected a whole number from ${min} to ${max}`);
    return n;
  };
}

const FAIL_ON_HELP = 'exit 1 when confirmed/likely findings reach this severity';

/** A language code for --language: auto, en, ko, ja, zh (zh-CN and zh-Hans mean zh). */
function languageOption(value: string): string {
  if (!parseLanguageSetting(value))
    throw new InvalidArgumentError(
      `expected one of ${LANGUAGE_INPUTS.join(', ')} (Traditional Chinese is not supported)`,
    );
  return value;
}

const explicitSource = (cmd: Command, key: string) =>
  cmd.getOptionValueSource(key) === 'cli' || cmd.getOptionValueSource(key) === 'env';

/** Translates command-line flags into the explicit configuration layer. */
function explicitConfig(cmd: Command): ParsedConfigInput {
  const o = cmd.opts<Record<string, unknown>>();
  const raw: Record<string, unknown> = {};
  const set = (section: string, key: string, value: unknown) => {
    if (value === undefined) return;
    raw[section] ??= {};
    (raw[section] as Record<string, unknown>)[key] = value;
  };
  if (o.language !== undefined) raw.language = o.language;
  set('intelligence', 'provider', o.provider);
  set('intelligence', 'model', o.model);
  set('review', 'failOn', o.failOn);
  if (o.maxFindings !== undefined) set('review', 'maxFindings', Number(o.maxFindings));
  if (o.runTests) set('review', 'runTests', true);
  const mode = o.short
    ? 'short'
    : o.standard
      ? 'standard'
      : o.custom
        ? 'custom'
        : (o.mode as string | undefined);
  set('video', 'mode', mode);
  if (o.width !== undefined) set('video', 'width', Number(o.width));
  if (o.height !== undefined) set('video', 'height', Number(o.height));
  set('video', 'duration', o.duration);
  if (o.fps !== undefined) set('video', 'fps', Number(o.fps));
  if (explicitSource(cmd, 'captions')) set('video', 'captions', o.captions);
  set('video', 'theme', o.theme);
  set('video', 'when', o.video);
  const narration: Record<string, unknown> = {};
  if (explicitSource(cmd, 'narration')) narration.enabled = o.narration;
  if (o.voice) narration.voice = o.voice;
  if (o.tts) narration.provider = o.tts;
  if (Object.keys(narration).length) set('video', 'narration', narration);
  const music: Record<string, unknown> = {};
  if (o.music) music.use = o.music;
  if (o.musicPlacement) music.placement = o.musicPlacement;
  if (Object.keys(music).length) set('video', 'music', music);
  if (explicitSource(cmd, 'soundEffects'))
    set('video', 'soundEffects', { enabled: o.soundEffects });
  if (explicitSource(cmd, 'outro')) set('video', 'outro', o.outro);
  if (explicitSource(cmd, 'comment')) set('publish', 'comment', o.comment);
  if (explicitSource(cmd, 'annotations')) set('publish', 'annotations', o.annotations);
  if (explicitSource(cmd, 'record')) set('demo', 'record', o.record);
  return parseConfigInput(raw, 'command-line options');
}

function addSelection(cmd: Command): Command {
  return cmd
    .argument('[range]', 'what to review: a base ref (main), A..B, A...B, or <sha>^!')
    .option('--base <ref>', 'base revision (merge-base semantics, like a pull request)')
    .option('--head <ref>', 'head revision (default: HEAD plus uncommitted work)')
    .option('--staged', 'only staged changes')
    .option('--uncommitted', 'only uncommitted changes (staged, unstaged, untracked)')
    .option('--committed', 'ignore uncommitted work')
    .option('--fetch', 'fetch missing commits (shallow clones)')
    .option('--out <dir>', 'write the run to this exact directory');
}

/** --language for commands that write for people. */
function addLanguage(cmd: Command): Command {
  return cmd.option(
    '--language <code>',
    'language Covi writes and narrates in: auto (from the change), en, ko, ja, or zh (Simplified Chinese)',
    languageOption,
  );
}

/** --record and --no-record, for commands that may run browser flows. */
function addRecord(cmd: Command): Command {
  return cmd
    .option(
      '--record',
      'record browser flows at base and head (the default); exit 3 if they cannot be recorded',
    )
    .option('--no-record', 'do not record browser flows (screenshots and traces are still taken)');
}

function addIntelligence(cmd: Command): Command {
  return addLanguage(cmd)
    .addOption(
      new Option('--provider <provider>', 'who does the reasoning').choices([
        'auto',
        'heuristic',
        'anthropic',
        'command',
      ]),
    )
    .option('--model <id>', 'model id for the anthropic provider');
}

function addVideo(cmd: Command): Command {
  return cmd
    .option('--short', 'short-form: vertical 9:16, ~30s')
    .option('--standard', 'standard review: 16:9, up to 120s')
    .option('--custom', 'custom size (use --width/--height)')
    .addOption(
      new Option(
        '--mode <mode>',
        'video mode by name (same as --short, --standard, --custom)',
      ).choices(['short', 'standard', 'custom']),
    )
    .option('--width <px>', 'custom width', int(240, 3840))
    .option('--height <px>', 'custom height', int(240, 3840))
    .option('--duration <time>', 'target length, e.g. 30s, 1m30s, or auto')
    .option('--fps <n>', 'frames per second (default 30)', int(10, 60))
    .option('--narration', 'force narration on')
    .option('--no-narration', 'captions only, no voice')
    .option('--no-captions', 'no burned-in captions')
    .option('--voice <name>', 'voice for the speech engine')
    .addOption(
      new Option('--tts <provider>', 'speech engine').choices([
        'auto',
        'system',
        'openai',
        'elevenlabs',
        'none',
      ]),
    )
    .addOption(new Option('--theme <theme>', 'color theme').choices(['light', 'dark']))
    .addOption(
      new Option(
        '--music <music>',
        'background music: theme (the Covi theme, default), compose (a score for this video), none',
      ).choices(['theme', 'compose', 'none']),
    )
    .addOption(
      new Option(
        '--music-placement <placement>',
        'where music plays: auto (by the kind of video, default), continuous (a quiet bed under the narration), bookends (around the narration only)',
      ).choices(['auto', 'continuous', 'bookends']),
    )
    .option(
      '--no-sound-effects',
      'no sound effects for clicks, reveals, findings, the verdict, and the outro',
    )
    .option('--outro', 'end with the branded Covi outro (default)')
    .option('--no-outro', 'no outro: hold the last scene for a second instead');
}

function selection(cmd: Command, range: string | undefined) {
  const o = cmd.opts<{
    base?: string;
    head?: string;
    staged?: boolean;
    uncommitted?: boolean;
    committed?: boolean;
    fetch?: boolean;
  }>();
  const flags = cmd.optsWithGlobals<GlobalFlags>();
  const scope = o.staged
    ? 'staged'
    : o.uncommitted
      ? 'uncommitted'
      : o.committed
        ? 'committed'
        : 'auto';
  return {
    repo: repoPath(flags.repo),
    range,
    base: o.base,
    head: o.head,
    scope,
    fetch: Boolean(o.fetch),
  } as const;
}

async function session(
  cmd: Command,
  workflow: string,
  range: string | undefined,
  extra: { workflowDefaults?: ParsedConfigInput } = {},
): Promise<Session> {
  const u = ui(cmd);
  const out = cmd.opts<{ out?: string }>().out;
  return startSession({
    workflow,
    selection: selection(cmd, range),
    configPath: u.flags.config,
    out: out ? resolve(out) : undefined,
    explicit: explicitConfig(cmd),
    workflowDefaults: extra.workflowDefaults ?? WORKFLOW_DEFAULTS[workflow],
    entryPoint:
      process.env.CLAUDECODE || process.env.CODEX_SANDBOX || process.env.CODEX_HOME
        ? 'agent'
        : 'cli',
    interactive: isInteractive({ ...u.flags }),
    trustCommands: Boolean(u.flags.trustCommands),
    logger: new TerminalLogger(u),
    options: { command: workflow, range, ...cmd.opts() },
  });
}

async function finish(
  cmd: Command,
  result: WorkflowResult,
  s?: Pick<Session, 'run'>,
  human?: string,
): Promise<void> {
  const u = ui(cmd);
  if (s) {
    result.warnings.push(...s.run.manifest.warnings.filter((w) => !result.warnings.includes(w)));
    const status: RunOutcome['status'] =
      result.exitCode === ExitCode.gate
        ? 'gated'
        : result.ok
          ? s.run.manifest.errors.length
            ? 'partial'
            : 'success'
          : 'failed';
    const video = result.video
      ? {
          rendered: result.video.rendered,
          reason: result.video.reason,
          path: result.video.path ? relative(s.run.dir, result.video.path) : undefined,
          seconds: result.video.seconds,
        }
      : undefined;
    if (!s.run.manifest.finishedAt) {
      await s.run.finish({
        status,
        exitCode: result.exitCode,
        verdict: result.verdict,
        findings: result.findings,
        gateFailures: result.gate?.failures,
        video,
        message: result.message,
      });
    } else if (result.command === 'render') {
      // Re-rendering changes the video, not the review's outcome.
      await s.run.updateOutcome({ video });
    } else {
      await s.run.updateOutcome({
        status,
        exitCode: result.exitCode,
        verdict: result.verdict,
        findings: result.findings,
        gateFailures: result.gate?.failures,
        video,
        message: result.message,
      });
    }
  }
  if (u.json) printJson(result);
  else if (!u.quiet || result.exitCode !== 0) printResult(result, u, human);
  process.exitCode = result.exitCode;
}

function readJsonFile(path: string): Promise<unknown> {
  return readFile(path, 'utf8').then((t) => JSON.parse(t) as unknown);
}

/** A demo plan file, validated up front so mistakes are usage errors with field-level messages. */
async function readPlan(path: string): Promise<unknown> {
  const plan = await readJsonFile(path).catch((error: Error) => {
    throw new CoviError(`Cannot read the demo plan ${path}: ${error.message}`, {
      exitCode: ExitCode.usage,
    });
  });
  parseOrThrow(DemoPlanSchema, plan, path, 'Run `covi schema demo-plan` for the format.');
  return plan;
}

function videoRequestFrom(cmd: Command): VideoRequest {
  const o = cmd.opts<Record<string, unknown>>();
  const req: VideoRequest = {};
  const mode = o.short
    ? 'short'
    : o.standard
      ? 'standard'
      : o.custom
        ? 'custom'
        : (o.mode as VideoRequest['mode']);
  if (mode) req.mode = mode;
  if (o.width) req.width = Number(o.width);
  if (o.height) req.height = Number(o.height);
  if (o.duration)
    req.duration =
      o.duration === 'auto'
        ? 'auto'
        : Number.isNaN(Number(o.duration))
          ? (parseConfigInput({ video: { duration: o.duration } }, '--duration').video
              ?.duration as number)
          : Number(o.duration);
  if (explicitSource(cmd, 'narration')) req.narration = Boolean(o.narration);
  if (explicitSource(cmd, 'captions')) req.captions = Boolean(o.captions);
  if (o.theme) req.theme = o.theme as VideoRequest['theme'];
  if (o.music) req.music = o.music as VideoRequest['music'];
  if (o.musicPlacement) req.musicPlacement = o.musicPlacement as VideoRequest['musicPlacement'];
  if (explicitSource(cmd, 'soundEffects')) req.soundEffects = Boolean(o.soundEffects);
  if (explicitSource(cmd, 'outro')) req.outro = Boolean(o.outro);
  return req;
}

/** Keys considered "decided" (by flags or by the repository's config) so Covi does not ask about them. */
function providedVideoKeys(provenance: Record<string, string>): string[] {
  const keys: string[] = [];
  const decided = (k: string) => /^(repository|explicit)/.test(provenance[k] ?? '');
  if (decided('video.mode')) keys.push('mode');
  if (decided('video.duration')) keys.push('duration');
  if (decided('video.music.use')) keys.push('music');
  return keys;
}

export function buildProgram(): Command {
  // Configure error handling before subcommands exist: they copy these settings when created.
  const program = new Command().exitOverride();
  program
    .name('covi')
    .description('Understand, explain, demonstrate, and review code changes.')
    .version(coviVersionSync(), '-V, --version', 'print the Covi version')
    .option('-C, --repo <path>', 'repository to work in', process.cwd())
    .option('-c, --config <file>', 'configuration file (default: .covi/config.yml)')
    .option('--json', 'machine-readable result on stdout (logs go to stderr)')
    .option('-q, --quiet', 'only print problems')
    .option('-v, --verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .option('-y, --yes', 'never ask questions; use defaults')
    .option(
      '--trust-commands',
      "run commands from this repository's configuration even if they are not trusted yet (see covi trust)",
    )
    .showHelpAfterError()
    .configureHelp({ sortSubcommands: false })
    .addHelpText(
      'after',
      `
Examples:
  covi review                      review this branch against main
  covi explain HEAD~3..HEAD        explain the last three commits
  covi review --fail-on high       fail (exit 1) on high-severity confirmed/likely issues
  covi video --short --duration 30s
  covi analyze --json              start an agent-driven review (writes brief.md)

Exit codes: 0 ok · 1 review gate failed · 2 usage or invalid input · 3 environment · 4 internal error`,
    );

  addIntelligence(
    addSelection(
      program
        .command('analyze')
        .description(
          'Understand a change and write an agent brief (context.json, brief.md, rule findings)',
        ),
    ),
  ).action(async (range: string | undefined, _o, cmd: Command) => {
    const s = await session(cmd, 'analyze', range);
    const result = await analyzeWorkflow(s, s.change);
    await finish(
      cmd,
      result,
      s,
      ui(cmd).json ? undefined : `${pc.dim('Brief:')} ${result.artifacts.brief}`,
    );
  });

  addIntelligence(
    addSelection(
      program
        .command('explain')
        .description('Explain what changed, why, and what reviewers should know'),
    ),
  ).action(async (range: string | undefined, _o, cmd: Command) => {
    const s = await session(cmd, 'explain', range);
    const result = await explainWorkflow(s, s.change);
    const markdown = await s.run.readText('explanation.md');
    await finish(cmd, result, s, ui(cmd).json ? undefined : markdown);
  });

  addRecord(
    addIntelligence(
      addSelection(
        program
          .command('review')
          .description('Review a change: explanation, evidence-based findings, and a verdict'),
      ),
    ),
  )
    .addOption(
      new Option('--fail-on <level>', FAIL_ON_HELP).choices(['none', 'low', 'medium', 'high']),
    )
    .option(
      '--max-findings <n>',
      'findings to show (the rest are listed under "omitted" in review.json)',
      int(1, 50),
    )
    .option('--run-tests', 'run test.command as part of the review')
    .option('--demo', 'also run the software and capture the change (see `covi demo`)')
    .option('--plan <file>', 'with --demo: the demo plan to follow (see `covi schema demo-plan`)')
    .action(
      async (
        range: string | undefined,
        o: { runTests?: boolean; demo?: boolean; plan?: string },
        cmd: Command,
      ) => {
        if (o.plan && !o.demo)
          throw new CoviError('--plan needs --demo.', { exitCode: ExitCode.usage });
        const s = await session(cmd, 'review', range);
        const result = await reviewWorkflow(s, s.change, {
          runTests: o.runTests,
          demo: o.demo,
          demoPlan: o.plan ? await readPlan(o.plan) : undefined,
        });
        await finish(cmd, result, s);
      },
    );

  addRecord(
    addLanguage(
      addSelection(
        program
          .command('demo')
          .description('Run the software at base and head and capture what changed'),
      ),
    ),
  )
    .option(
      '--plan <file>',
      'demo plan JSON (pages, flows, commands, requests); see `covi schema demo-plan`',
    )
    .action(async (range: string | undefined, o: { plan?: string }, cmd: Command) => {
      const s = await session(cmd, 'demo', range);
      const plan = o.plan ? await readPlan(o.plan) : undefined;
      const result = await demoWorkflow(s, s.change, { plan });
      await finish(cmd, result, s);
    });

  addRecord(
    addVideo(
      addIntelligence(
        addSelection(
          program.command('video').description('Make a review video when seeing the change helps'),
        ),
      ),
    ),
  )
    .option('--request <text>', 'the request in plain words, e.g. "30-second vertical video"')
    .option('--template <id>', 'storytelling template (see `covi templates`)')
    .option('--storyboard <file>', 'render this storyboard instead of drafting one')
    .option('--draft', 'write video/storyboard.json and stop, so it can be edited before rendering')
    .option('--dry-run', 'print the resolved video plan and the questions worth asking, then stop')
    .option('--force', 'render even when Covi judges a video unhelpful')
    .option('--workers <n>', 'parallel render workers', int(1, 64))
    .action(
      async (
        range: string | undefined,
        o: {
          request?: string;
          template?: string;
          storyboard?: string;
          draft?: boolean;
          dryRun?: boolean;
          force?: boolean;
          workers?: string;
        },
        cmd: Command,
      ) => {
        const u = ui(cmd);
        const s = await session(cmd, 'video', range);
        const interactive = isInteractive(u.flags) && !o.dryRun;
        const plan = planVideo(s.config, {
          text: o.request,
          explicit: videoRequestFrom(cmd),
          provided: providedVideoKeys(s.resolved.provenance),
          interactive: o.dryRun ? !u.flags.yes : interactive,
          language: s.language.language,
        });
        if (o.dryRun) {
          const { decideVideo } = await import('@covi/video');
          const result = baseResult('video', s);
          result.data = {
            ...plan,
            decision: decideVideo(s.context, { when: s.config.video.when, force: o.force }),
            demonstration: s.context.demonstration,
          };
          result.message = plan.questions.length
            ? `Questions worth asking: ${plan.questions.map((q) => q.question).join(' / ')}`
            : 'Nothing to ask; the plan is complete.';
          await finish(cmd, result, s);
          return;
        }
        let spec = plan.spec;
        // Nobody chose the music: the result says how to change it.
        let musicDefault = plan.missing.includes('music');
        if (interactive && plan.questions.length) {
          const answers: Partial<Record<VideoQuestion['id'], string>> = {};
          const queue = [...plan.questions];
          for (let q = queue.shift(); q; q = queue.shift()) {
            if (q.id === 'size' && answers.mode && answers.mode !== 'custom') continue;
            answers[q.id] = await ask(terminalQuestion(q, { canCompose: Boolean(s.provider) }));
            queue.push(
              ...followUpQuestions(
                plan,
                answers,
                [...Object.keys(answers), ...queue.map((x) => x.id)] as VideoQuestion['id'][],
                s.language.language,
              ),
            );
          }
          const base: VideoRequest = {
            mode: plan.spec.mode,
            width: plan.spec.mode === 'custom' ? plan.spec.width : undefined,
            height: plan.spec.mode === 'custom' ? plan.spec.height : undefined,
            duration: plan.spec.duration.auto ? 'auto' : plan.spec.duration.target,
            narration: plan.spec.narration.enabled,
            captions: plan.spec.captions,
            theme: plan.spec.theme,
            // A language the request named survives the answers.
            ...(plan.spec.language ? { language: plan.spec.language } : {}),
            music: plan.spec.music.use,
            musicPlacement: plan.spec.music.setting,
            soundEffects: plan.spec.soundEffects,
            outro: plan.spec.outro,
          };
          spec = resolveVideoSpec(s.config, applyAnswers(base, answers));
          musicDefault &&= !answers.music;
        }
        const storyboard = o.storyboard ? await readJsonFile(o.storyboard) : undefined;
        const result = await videoWorkflow(s, s.change, {
          spec,
          force: o.force,
          draft: o.draft,
          template: o.template,
          storyboard,
          workers: o.workers ? Number(o.workers) : undefined,
          musicDefault,
        });
        await finish(cmd, result, s);
      },
    );

  addIntelligence(
    addSelection(
      program
        .command('summarize')
        .description('A short summary for a PR/MR description, changelog, or chat'),
    ),
  )
    .addOption(
      new Option('--format <format>', 'output format')
        .choices(['markdown', 'text', 'json'])
        .default('markdown'),
    )
    .action(
      async (
        range: string | undefined,
        o: { format: 'markdown' | 'text' | 'json' },
        cmd: Command,
      ) => {
        const s = await session(cmd, 'summarize', range);
        const result = await summarizeWorkflow(s, s.change, o.format);
        const text = (result.data as { summary: string }).summary;
        if (ui(cmd).json) await finish(cmd, result, s);
        else {
          await s.run.finish({ status: 'success', exitCode: 0, verdict: result.verdict });
          process.stdout.write(`${text.trimEnd()}\n`);
        }
      },
    );

  addLanguage(
    program
      .command('report')
      .description(
        'Validate agent-written explanation.json and findings.json, then render the reports',
      ),
  )
    .option('--run <id>', 'run id, directory, or "latest"', 'latest')
    .addOption(
      new Option('--fail-on <level>', FAIL_ON_HELP).choices(['none', 'low', 'medium', 'high']),
    )
    .action(async (o: { run: string }, cmd: Command) => {
      const u = ui(cmd);
      const s = await openSession(o.run, {
        repo: repoPath(u.flags.repo),
        logger: new TerminalLogger(u),
        interactive: false,
        explicit: explicitConfig(cmd),
        configPath: u.flags.config,
        trustCommands: Boolean(u.flags.trustCommands),
      });
      const result = await reportWorkflow(s as Session);
      await finish(cmd, result, s);
    });

  addLanguage(
    addVideo(
      program
        .command('render')
        .description("Render (or re-render) a run's storyboard into a video"),
    ),
  )
    .option('--run <id>', 'run id, directory, or "latest"', 'latest')
    .option(
      '--storyboard <file>',
      'storyboard to render (default: video/storyboard.json in the run)',
    )
    .option('--workers <n>', 'parallel render workers', int(1, 64))
    .action(async (o: { run: string; storyboard?: string; workers?: string }, cmd: Command) => {
      const u = ui(cmd);
      const s = await openSession(o.run, {
        repo: repoPath(u.flags.repo),
        logger: new TerminalLogger(u),
        interactive: false,
        explicit: explicitConfig(cmd),
        configPath: u.flags.config,
        trustCommands: Boolean(u.flags.trustCommands),
      });
      const change = await reloadChange(s.run, s.git.cwd, s.logger);
      // Keep the size, length, and voice chosen when the storyboard was drafted; flags still win.
      const decision = (await s.run.has('video/decision.json'))
        ? await s.run.readJson<{ spec?: VideoSpec; musicDefault?: boolean }>('video/decision.json')
        : undefined;
      const saved = decision?.spec;
      const explicit = new Set(
        Object.entries(s.resolved.provenance)
          .filter(([, origin]) => origin.startsWith('explicit'))
          .map(([key]) => key),
      );
      const spec = respecVideo(s.config, saved, videoRequestFrom(cmd), explicit);
      // The music is still a default when nobody chose it at draft time and nobody chooses it now.
      const musicDefault =
        !explicit.has('video.music.use') &&
        (decision
          ? Boolean(decision.musicDefault)
          : !providedVideoKeys(s.resolved.provenance).includes('music'));
      const result = await renderWorkflow({ ...s, change } as Session, change, {
        spec,
        storyboardPath: o.storyboard ? resolve(o.storyboard) : undefined,
        workers: o.workers ? Number(o.workers) : undefined,
        musicDefault,
      });
      await finish(cmd, result, s);
    });

  addRecord(
    addVideo(
      addIntelligence(
        program
          .command('ci')
          .description('Run Covi in GitHub Actions or GitLab CI (never interactive)'),
      ),
    ),
  )
    .addOption(
      new Option('--platform <platform>', 'CI platform (auto: detect from the environment)')
        .choices(['auto', 'github', 'gitlab', 'local'])
        .default('auto'),
    )
    .addOption(
      new Option('--fail-on <level>', FAIL_ON_HELP).choices(['none', 'low', 'medium', 'high']),
    )
    .addOption(
      new Option('--video <when>', 'render a video: auto (when useful), always, never').choices([
        'auto',
        'always',
        'never',
      ]),
    )
    .option(
      '--no-annotations',
      'do not annotate findings inline (GitHub) or list them in the Code Quality report (GitLab)',
    )
    .option('--comment', 'post or update the summary comment')
    .option('--no-comment', 'do not post a comment (e.g. when publishing in a later step)')
    .option('--run-tests', 'run test.command')
    .option('--out <dir>', 'write the run to this exact directory')
    .action(async (o: { platform: string; out?: string }, cmd: Command) => {
      const u = ui(cmd);
      const id =
        o.platform === 'auto' ? detectPlatform() : (o.platform as 'github' | 'gitlab' | 'local');
      const platform = await platformContext(id);
      const logger = new TerminalLogger(u);
      const explicit = explicitConfig(cmd);
      const result = await ciWorkflow({
        platform,
        repo: repoPath(u.flags.repo),
        out: o.out ? resolve(o.out) : undefined,
        explicit,
        configPath: u.flags.config,
        publish: explicitSource(cmd, 'comment') ? cmd.opts().comment : undefined,
        logger,
        spec: (config) => resolveVideoSpec(config, {}),
        log: (line) => process.stdout.write(`${line}\n`),
        env: process.env,
      });
      if (u.json) printJson(result);
      else printResult(result, u);
      process.exitCode = result.exitCode;
    });

  program
    .command('publish')
    .description('Post or update the summary comment for a finished run')
    .option('--run <id>', 'run id, directory, or "latest"', 'latest')
    .addOption(
      new Option('--platform <platform>', 'where to comment (auto: detect from the environment)')
        .choices(['auto', 'github', 'gitlab'])
        .default('auto'),
    )
    .option(
      '--number <n>',
      'pull/merge request number (e.g. from a workflow_run event)',
      int(1, Number.MAX_SAFE_INTEGER),
    )
    .option('--expect-head <sha>', 'refuse to publish unless the run reviewed this head commit')
    .option('--artifact-url <url>', 'link to the uploaded run artifacts')
    .option('--video-url <url>', 'link to the video')
    .action(
      async (
        o: {
          run: string;
          platform: string;
          number?: string;
          expectHead?: string;
          artifactUrl?: string;
          videoUrl?: string;
        },
        cmd: Command,
      ) => {
        const u = ui(cmd);
        const root = await repoRoot(repoPath(u.flags.repo)).catch(() => repoPath(u.flags.repo));
        const run = await Run.open(o.run, { root, runsDir: await runsDirOf(root, u.flags) });
        const result = baseResult('publish');
        result.runId = run.id;
        result.runDir = run.dir;
        const id = o.platform === 'auto' ? detectPlatform() : (o.platform as 'github' | 'gitlab');
        const platform = await platformContext(id);
        // The run directory may come from an untrusted artifact: it must have reviewed the commit
        // the trusted event (or --expect-head) names, and the comment goes to that pull request.
        if (o.expectHead) platform.expectedHead = o.expectHead;
        const expected = platform.expectedHead;
        const head = run.manifest.change?.head.sha;
        if (expected && !(head && sameCommit(head, expected))) {
          throw new CoviError(
            `Run ${run.id} reviewed ${head?.slice(0, 12) ?? 'nothing'}, not ${expected.slice(0, 12)}; refusing to publish.`,
            { exitCode: ExitCode.usage },
          );
        }
        const config = run.manifest.config?.values as
          | { publish?: { video?: 'link' | 'upload' | 'none' } }
          | undefined;
        const outcome = await publishRun(run, platform, process.env, {
          videoMode: config?.publish?.video ?? 'link',
          number: o.number ? Number(o.number) : undefined,
          artifactUrl: o.artifactUrl,
          videoUrl: o.videoUrl,
        });
        result.data = { publish: outcome };
        result.message =
          outcome.status === 'created' || outcome.status === 'updated'
            ? `Comment ${outcome.status}${outcome.url ? `: ${outcome.url}` : ''}`
            : `Comment ${outcome.status}: ${outcome.reason}`;
        if (outcome.status === 'failed')
          result.warnings.push(outcome.reason ?? 'publishing failed');
        await finish(cmd, result);
      },
    );

  program
    .command('init')
    .description('Create .covi/config.yml from what Covi detects in this repository')
    .option('--force', 'overwrite an existing config')
    .action(async (o: { force?: boolean }, cmd: Command) => {
      const u = ui(cmd);
      const root = await repoRoot(repoPath(u.flags.repo));
      const result = await initConfig(root, o);
      // The user just generated these commands and sees them below, so they are trusted here.
      const commands = result.created
        ? repositoryCommands(parseYamlConfig(result.content, result.path))
        : [];
      if (commands.length) await new TrustStore().trust(root, commands);
      if (u.json) printJson({ ...result, trusted: describeCommands(commands) });
      else
        process.stdout.write(
          result.created
            ? `Created ${result.path}${result.detected.length ? ` (detected: ${result.detected.join(', ')})` : ''}\n\n${result.content}${commands.length ? `\n${pc.dim('Trusted these commands for this repository on this machine (covi trust --revoke to undo).')}\n` : ''}`
            : `${result.path} already exists (use --force to overwrite).\n`,
        );
    });

  program
    .command('trust')
    .description(
      "Review and allow the commands this repository's .covi/config.yml asks Covi to run",
    )
    .option('--revoke', 'forget the commands trusted for this repository')
    .addHelpText(
      'after',
      `
Repository configuration can ask Covi to run commands (app.install, app.start, test.command,
demo.commands, intelligence.command), open app.url, and pass app.env/app.passEnv to them.
Locally they take effect only after you trust that exact set; any change needs trusting again.
Non-interactive runs need --yes. In CI, Covi reads configuration from the base revision instead.`,
    )
    .action(async (o: { revoke?: boolean }, cmd: Command) => {
      const u = ui(cmd);
      const root = await repoRoot(repoPath(u.flags.repo));
      const store = new TrustStore();
      if (o.revoke) {
        const revoked = await store.revoke(root);
        if (u.json) printJson({ repository: root, revoked });
        else
          process.stdout.write(
            revoked
              ? `Forgot the trusted commands for ${root}.\n`
              : `No trusted commands were recorded for ${root}.\n`,
          );
        return;
      }
      const loaded = await loadRepositoryConfig(
        root,
        u.flags.config ? { kind: 'file', path: resolve(u.flags.config) } : { kind: 'worktree' },
      );
      const commands = repositoryCommands(loaded.values);
      const lines = describeCommands(commands);
      const already = await store.isTrusted(root, commands);
      if (commands.length && !already) {
        if (!u.json)
          process.stderr.write(
            `${loaded.source} asks Covi to run:\n${lines.map((l) => `  ${l}`).join('\n')}\n`,
          );
        if (!u.flags.yes) {
          if (!isInteractive({ ...u.flags })) {
            // Agents read JSON: give them the exact commands to show the user before confirming.
            if (u.json) {
              printJson({
                ok: false,
                exitCode: ExitCode.usage,
                error: 'Refusing to trust commands without confirmation.',
                hint: 'Show these commands to the user; run `covi trust --yes` only if they agree.',
                repository: root,
                source: loaded.source,
                commands: lines,
                trusted: false,
              });
              process.exitCode = ExitCode.usage;
              return;
            }
            throw new CoviError('Refusing to trust commands without confirmation.', {
              exitCode: ExitCode.usage,
              hint: 'Review the commands above, then run `covi trust --yes`.',
            });
          }
          const answer = await ask({
            question: 'Trust these commands for this repository on this machine?',
            options: [
              { label: 'No', value: 'no', description: 'keep them withheld' },
              { label: 'Yes', value: 'yes', description: 'Covi may run them until they change' },
            ],
          });
          if (answer !== 'yes') throw new CoviError('Not trusted.', { exitCode: ExitCode.usage });
        }
        await store.trust(root, commands);
      }
      if (u.json)
        printJson({ repository: root, source: loaded.source, commands: lines, trusted: true });
      else
        process.stdout.write(
          commands.length
            ? already
              ? `These commands are already trusted for ${root}.\n`
              : `Trusted ${commands.length} command${commands.length === 1 ? '' : 's'} for ${root}.\n`
            : `${loaded.source ?? 'This repository'} asks Covi to run no commands; nothing to trust.\n`,
        );
    });

  program
    .command('doctor')
    .description('Check what Covi can do in this environment')
    .option(
      '--install-browser',
      'download the Chromium build this Covi version uses, then check only the browser',
    )
    .option('--with-deps', 'with --install-browser: also install system libraries (Linux)')
    .action(async (o: { installBrowser?: boolean; withDeps?: boolean }, cmd: Command) => {
      const u = ui(cmd);
      if (o.installBrowser) {
        const code = await installBrowser({ withDeps: o.withDeps });
        const check =
          code === 0
            ? await browserCheck()
            : ({
                id: 'browser',
                status: 'fail',
                message: `Installing Chromium failed (exit ${code})`,
                hint: 'On Linux, system libraries need --with-deps and root or sudo.',
              } as const);
        printChecks([check], u.json);
        process.exitCode = check.status === 'ok' ? ExitCode.ok : ExitCode.environment;
        return;
      }
      const checks = await doctor(repoPath(u.flags.repo));
      printChecks(checks, u.json);
      process.exitCode = checks.some((c) => c.status === 'fail')
        ? ExitCode.environment
        : ExitCode.ok;
    });

  const runs = program.command('runs').description('List and inspect runs');
  runs
    .command('list', { isDefault: true })
    .description('List recent runs')
    .action(async (_o, cmd: Command) => {
      const u = ui(cmd);
      const root = await repoRoot(repoPath(u.flags.repo));
      const list = await listRuns(root, await runsDirOf(root, u.flags));
      if (u.json) printJson(list);
      else if (list.length === 0) process.stdout.write('No runs yet.\n');
      else
        for (const r of list.slice(0, 30))
          process.stdout.write(
            `${r.id}  ${pc.dim(r.status ?? 'running')}${r.verdict ? `  ${r.verdict}` : ''}${r.title ? `  ${r.title}` : ''}\n`,
          );
    });
  runs
    .command('show')
    .argument('[id]', 'run id, directory, or "latest"', 'latest')
    .description('Show a run manifest summary')
    .action(async (id: string, _o, cmd: Command) => {
      const u = ui(cmd);
      const root = await repoRoot(repoPath(u.flags.repo));
      const run = await Run.open(id, { root, runsDir: await runsDirOf(root, u.flags) });
      if (u.json) printJson(run.manifest);
      else {
        const m = run.manifest;
        process.stdout.write(
          `${pc.bold(m.runId)}  ${m.workflow} · ${m.outcome?.status ?? 'running'} · ${m.change ? `${m.change.base.sha.slice(0, 7)}…${m.change.head.sha.slice(0, 7)}` : ''}\n`,
        );
        for (const s of m.stages)
          process.stdout.write(
            `  ${s.status === 'ok' ? pc.green('✓') : s.status === 'skipped' ? pc.dim('-') : pc.red('✗')} ${s.name.padEnd(16)} ${pc.dim(`${(s.durationMs / 1000).toFixed(1)}s`)}${s.reason ? pc.dim(`  ${s.reason}`) : ''}${s.error ? pc.red(`  ${s.error}`) : ''}\n`,
          );
        for (const a of m.artifacts)
          process.stdout.write(`  ${pc.dim(a.kind.padEnd(13))} ${a.path}\n`);
      }
    });

  program
    .command('schema')
    .argument('<name>', 'explanation | findings | storyboard | score | demo-plan | config')
    .description('Print the JSON Schema for a file agents can author')
    .action(async (name: string) => {
      const schemas: Record<string, z.ZodType> = {
        explanation: ExplanationSchema,
        findings: FindingsFileSchema,
        storyboard: StoryboardSchema,
        score: ScoreSchema,
        'demo-plan': DemoPlanSchema,
        config: ConfigInputSchema,
      };
      const schema = schemas[name];
      if (!schema)
        throw new CoviError(
          `Unknown schema "${name}". Choose one of: ${Object.keys(schemas).join(', ')}`,
          { exitCode: ExitCode.usage },
        );
      printJson(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
    });

  const templates = program
    .command('templates')
    .description('Storytelling templates for review videos');
  templates
    .command('list', { isDefault: true })
    .description('List the templates')
    .action(async (_o, cmd: Command) => {
      const list = [...(await loadTemplates()).values()];
      if (ui(cmd).json) printJson(list);
      else
        for (const t of list)
          process.stdout.write(
            `${pc.bold(t.id.padEnd(24))} ${t.description}\n${' '.repeat(25)}${pc.dim(`beats: ${t.beats.map((b) => b.id).join(' → ')}`)}\n`,
          );
    });
  templates
    .command('show')
    .description('Print a template as JSON')
    .argument('<id>')
    .action(async (id: string) => {
      const t = (await loadTemplates()).get(id);
      if (!t) throw new CoviError(`Unknown template "${id}"`, { exitCode: ExitCode.usage });
      printJson(t);
    });

  const skills = program
    .command('skills')
    .description("Covi's agent skills (the review methodology)");
  skills
    .command('list', { isDefault: true })
    .description('List the skills')
    .action(async (_o, cmd: Command) => {
      const list = await listSkills();
      if (ui(cmd).json)
        printJson(list.map(({ name, description, path }) => ({ name, description, path })));
      else
        for (const s of list)
          process.stdout.write(`${pc.bold(s.name.padEnd(20))} ${s.description}\n`);
    });
  skills
    .command('show')
    .description("Print a skill's instructions")
    .argument('<name>')
    .action(async (name: string) => {
      const skill = await loadSkill(name).catch(() => {
        throw new CoviError(`Unknown skill "${name}"`, { exitCode: ExitCode.usage });
      });
      process.stdout.write(`${skill.body}\n`);
    });
  skills
    .command('install')
    .description('Install the skills for an agent client')
    .addOption(
      new Option(
        '--target <client>',
        'agent client: claude (.claude/skills), codex or agents (.agents/skills)',
      )
        .choices(['claude', 'codex', 'agents'])
        .default('claude'),
    )
    .option('--global', 'install for the user instead of this repository')
    .option('--dest <dir>', 'install into this directory')
    .action(async (o: { target: SkillTarget; global?: boolean; dest?: string }, cmd: Command) => {
      const u = ui(cmd);
      const result = await installSkills(o.target, {
        repo: repoPath(u.flags.repo),
        global: Boolean(o.global),
        dest: o.dest ? resolve(o.dest) : undefined,
      });
      if (u.json) printJson(result);
      else
        process.stdout.write(
          `Installed ${result.installed.length} skills into ${result.destination}\n`,
        );
    });

  const examples = program
    .command('examples')
    .description('Example changes for trying Covi locally');
  examples
    .command('list', { isDefault: true })
    .description('List the examples and what Covi should conclude about each')
    .action(async (_o, cmd: Command) => {
      const list = await listExamples();
      if (ui(cmd).json) printJson(list.map(({ dir: _dir, ...e }) => e));
      else
        for (const e of list)
          process.stdout.write(
            `${pc.bold(e.name.padEnd(26))} ${e.title}\n${' '.repeat(27)}${pc.dim(`expect: ${e.expect.intent}, demo ${e.expect.demonstration}, video ${e.expect.video ? 'yes' : 'no'}`)}\n`,
          );
    });
  examples
    .command('create')
    .argument('<name>')
    .option('--into <dir>', 'directory for the repository (default: a temporary directory)')
    .description('Create a git repository containing the example change')
    .action(async (name: string, o: { into?: string }, cmd: Command) => {
      const dir = await materializeExample(
        await getExample(name),
        o.into ? resolve(o.into) : undefined,
      );
      if (ui(cmd).json) printJson({ name, dir });
      else {
        // Only the path goes to stdout, so `dir=$(covi examples create …)` works.
        process.stdout.write(`${dir}\n`);
        process.stderr.write(`${pc.dim(`Try: covi review --repo ${dir}`)}\n`);
      }
    });

  program
    .command('mascot')
    .description('Export the Covi fox as SVG')
    .addOption(
      new Option('--expression <name>', "the fox's expression")
        .choices(['neutral', 'explaining', 'thinking', 'reviewing', 'warning', 'success'])
        .default('neutral'),
    )
    .option('--size <px>', 'size in pixels', int(16, 4096), 256)
    .option('--mark', 'the simplified mark for small icons')
    .option('--logo', 'fox and wordmark')
    .option('--out <file>', 'write to a file instead of stdout')
    .action(
      async (o: {
        expression: 'neutral';
        size: number;
        mark?: boolean;
        logo?: boolean;
        out?: string;
      }) => {
        const size = o.size;
        // A file clips to its view box, so the fox gets the frame that fits a pointing tail.
        const svg = o.logo
          ? logoSvg({ height: size / 2 })
          : o.mark
            ? foxMarkSvg({ size })
            : foxSvg({ expression: o.expression, size, frame: FOX_FRAME });
        if (o.out) await writeFile(o.out, `${svg}\n`);
        else process.stdout.write(`${svg}\n`);
      },
    );

  program
    .command('version')
    .description('Print the Covi version')
    .action(async () => {
      process.stdout.write(`${await coviVersion()}\n`);
    });
  return program;
}

/** Runs the CLI and returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv, { from: 'user' });
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    const err = error as Error & { code?: string; exitCode?: number; hint?: string };
    if (
      err.code === 'commander.helpDisplayed' ||
      err.code === 'commander.version' ||
      err.code === 'commander.help'
    )
      return 0;
    if (err.code?.startsWith('commander.')) return ExitCode.usage;
    const json = argv.includes('--json');
    if (error instanceof NoChangesError) {
      if (json)
        printJson({ ok: true, exitCode: 0, message: error.message, artifacts: {}, warnings: [] });
      else process.stderr.write(`${pc.dim(error.message)}\n`);
      return ExitCode.ok;
    }
    const code = error instanceof CoviError ? error.exitCode : ExitCode.internal;
    if (json) printJson({ ok: false, exitCode: code, error: errorMessage(error), hint: err.hint });
    process.stderr.write(
      `${pc.red('error')} ${errorMessage(error)}\n${err.hint ? `${pc.dim(`hint: ${err.hint}`)}\n` : ''}`,
    );
    if (code === ExitCode.internal && process.env.COVI_DEBUG)
      process.stderr.write(`${err.stack}\n`);
    return code;
  }
}
