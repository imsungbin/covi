import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  type Calibration,
  type ChangeScope,
  type CodeChange,
  type ConfigLayer,
  type CoviConfig,
  calibrationOf,
  chooseProvider,
  configFromEnv,
  createProvider,
  describeCommands,
  type EntryPoint,
  EnvironmentError,
  type ExecutionPolicy,
  Git,
  ignoreReason,
  type Language,
  type Logger,
  loadRepositoryConfig,
  type ModelProvider,
  openSubject,
  outcomesOfRepository,
  type ParsedConfigInput,
  type ProviderChoice,
  Redactor,
  type RepositoryCommand,
  type ResolvedConfig,
  type ResolvedLanguage,
  type ReviewContext,
  RUN_PATHS,
  Run,
  readOutcomes,
  renderFileDiff,
  repositoryCommands,
  resolveChange,
  resolveConfig,
  resolveOutputLanguage,
  runsRootFor,
  type SubjectHandle,
  TRUST_HINT,
  TrustStore,
  understandChange,
  withoutRepositoryCommands,
  writeEvidence,
} from '@covi/core';
import type { PlatformContext } from '@covi/platforms';
import { coviVersion } from './version.ts';

export interface ChangeSelection {
  repo: string;
  range?: string;
  base?: string;
  head?: string;
  scope: ChangeScope;
  fetch: boolean;
}

export interface SessionOptions {
  workflow: string;
  selection: ChangeSelection;
  configPath?: string;
  /** Exact run directory (CI uses this for a predictable artifact path). */
  out?: string;
  explicit: ParsedConfigInput;
  workflowDefaults?: ParsedConfigInput;
  entryPoint: EntryPoint;
  interactive: boolean;
  logger: Logger;
  platform?: PlatformContext;
  /** Read repository config from the base revision (CI) so a change cannot reconfigure its own review. */
  trustedConfig?: boolean;
  /** Use repository commands even if they are not trusted on this machine (`--trust-commands`). */
  trustCommands?: boolean;
  options?: Record<string, unknown>;
}

export interface Session {
  run: Run;
  change: CodeChange;
  context: ReviewContext;
  config: CoviConfig;
  resolved: ResolvedConfig;
  git: Git;
  logger: Logger;
  redactor: Redactor;
  providerChoice: ProviderChoice;
  provider?: ModelProvider;
  cacheDir: string;
  interactive: boolean;
  /** Whether project commands may run, and which repository commands were withheld. */
  execution: ExecutionPolicy;
  /** The language Covi writes in (recorded in run.json). */
  language: ResolvedLanguage;
  /** The language settings speech resolution honors: a flag, or a configured language. */
  languageSettings: LanguageSettings;
  /**
   * What Covi has seen of the software, for this run to read and update; absent when
   * `subject.store` is off.
   */
  subject?: SubjectHandle;
   * How past findings held up in this repository, for the brief and the model's material. Read
   * when the session starts, before any project command could write to `.covi/outcomes/`. A hint
   * only: nothing changes a finding's certainty because of it.
   */
  calibration?: Calibration;
}

export interface LanguageSettings {
  /** --language or COVI_LANGUAGE for this command. */
  flag?: Language;
  /** `language` in configuration, when it names a language rather than `auto`. */
  configured?: Language;
}

/** Splits the resolved `language` setting by where it came from: a flag, or configuration. */
export function languageSettingsOf(resolved: ResolvedConfig): LanguageSettings {
  const setting = resolved.config.language;
  if (setting === 'auto') return {};
  return /^explicit/.test(resolved.provenance.language ?? '')
    ? { flag: setting }
    : { configured: setting };
}

function settingSource(resolved: ResolvedConfig): string {
  return `language: ${resolved.config.language} from ${resolved.provenance.language ?? 'global'}`;
}

/** The output language for a change: the setting, or the script of its title, description, and commits. */
export function changeLanguage(resolved: ResolvedConfig, change: CodeChange): ResolvedLanguage {
  return resolveOutputLanguage(resolved.config.language, settingSource(resolved), {
    title: change.metadata.title,
    description: change.metadata.description,
    commits: change.commits.map((c) => `${c.subject}\n${c.body}`),
  });
}

/** Repository root for a path, with a clear error outside git. */
export async function repoRoot(path: string): Promise<string> {
  if (!path.trim())
    throw new EnvironmentError(
      'No repository path given.',
      'Pass --repo <path> or run Covi inside a repository.',
    );
  const root = await new Git(path).tryOut(['rev-parse', '--show-toplevel']).catch(() => undefined);
  if (!root)
    throw new EnvironmentError(
      `Not a git repository: ${path}`,
      'Run Covi inside a git repository or pass --repo <path>.',
    );
  return root;
}

function buildLayers(
  options: SessionOptions,
  repo: { values?: ParsedConfigInput; source?: string },
): ConfigLayer[] {
  const layers: ConfigLayer[] = [];
  if (options.workflowDefaults)
    layers.push({ name: 'workflow', source: options.workflow, values: options.workflowDefaults });
  if (repo.values) layers.push({ name: 'repository', source: repo.source, values: repo.values });
  const env = configFromEnv(process.env);
  if (Object.keys(env).length)
    layers.push({ name: 'explicit', source: 'COVI_* environment', values: env });
  if (Object.keys(options.explicit).length)
    layers.push({ name: 'explicit', source: 'command line', values: options.explicit });
  return layers;
}

/** Applies configured ignore globs after the fact (CI loads configuration from the base revision). */
function applyIgnores(change: CodeChange, ignore: readonly string[]): void {
  if (!ignore.length) return;
  for (const f of change.files) {
    if (f.ignored) continue;
    const reason = ignoreReason(f.path, ignore);
    if (reason) {
      f.ignored = true;
      f.ignoreReason = reason;
    }
  }
  change.stats.ignoredFiles = change.files.filter((f) => f.ignored).length;
}

export async function startSession(options: SessionOptions): Promise<Session> {
  const { logger, selection } = options;
  const root = await repoRoot(selection.repo);
  const git = new Git(root);

  // Configuration: worktree locally; the trusted base revision in CI. In CI an explicit --config
  // inside the repository is read from the base revision too, so a change cannot edit it.
  let repoConfig: { values?: ParsedConfigInput; source?: string } = {};
  // Compare real paths: git reports the repository's real path (e.g. /private/var on macOS).
  const configPath = options.configPath
    ? await realpath(resolve(options.configPath)).catch(() => resolve(options.configPath!))
    : undefined;
  const configInRepo =
    configPath !== undefined && isInside(root, configPath) ? relative(root, configPath) : undefined;
  const fromBase = Boolean(options.trustedConfig) && (!configPath || configInRepo !== undefined);
  if (configPath && !fromBase)
    repoConfig = await loadRepositoryConfig(root, { kind: 'file', path: configPath });
  else if (!options.trustedConfig)
    repoConfig = await loadRepositoryConfig(root, { kind: 'worktree' });
  const withheld: RepositoryCommand[] = [];
  repoConfig = await gateRepositoryCommands(root, repoConfig, options, withheld);
  let resolved = resolveConfig(buildLayers(options, repoConfig));

  const platform = options.platform;
  logger.step('Resolving the change');
  const change = await resolveChange({
    repo: root,
    range: selection.range,
    base: selection.base ?? platform?.base,
    head: selection.head ?? (selection.range ? undefined : platform?.head),
    scope: selection.scope,
    defaultBase: resolved.config.base,
    fetch: selection.fetch || Boolean(platform?.fetch),
    metadata: platform?.metadata,
    source: platform?.source,
    ignore: fromBase ? [] : resolved.config.ignore,
    logger,
  });
  if (fromBase) {
    repoConfig = await loadRepositoryConfig(
      root,
      { kind: 'revision', revision: change.base.sha, label: 'base', path: configInRepo },
      git,
    );
    resolved = resolveConfig(buildLayers(options, repoConfig));
    applyIgnores(change, resolved.config.ignore);
  }
  const config = resolved.config;

  const redactor = Redactor.fromProcess();
  const run = await Run.create({
    root,
    workflow: options.workflow,
    entryPoint: options.entryPoint,
    interactive: options.interactive,
    coviVersion: await coviVersion(),
    dir: options.out,
    runsDir: config.output.dir,
    // In CI the checkout is the change's: a runs directory it links elsewhere is refused, unless
    // the user chose the place (--out, or output.dir on the command line or in the environment).
    confined:
      Boolean(options.trustedConfig) && !/^explicit/.test(resolved.provenance['output.dir'] ?? ''),
    headSha: change.head.sha,
    keep: config.output.keep,
    redactor,
  });
  run.setChange(change);
  run.setConfig(resolved, options.options);
  const language = changeLanguage(resolved, change);
  run.setLanguage(language);
  // What earlier runs saw of the software. In CI the repository's copy comes from the base
  // revision, like configuration, so a change cannot steer its own demonstration.
  const subject = await openSubject({
    root,
    runsRoot: runsRootFor(root, config.output.dir),
    config,
    baseRevision: options.trustedConfig ? change.base.sha : undefined,
    git,
    warn: (message) => run.warn(message),
  });
  for (const note of platform?.notes ?? []) run.warn(note);
  const execution: ExecutionPolicy = {
    allowed: platform?.allowExecution ?? true,
    reason:
      platform?.allowExecution === false
        ? 'Project commands are disabled for this event (pull_request_target runs with secrets).'
        : undefined,
    withheld,
  };

  logger.step('Understanding the change');
  const context = await run.stage('understand', () =>
    understandChange(change, { git, config, logger, language: language.language }),
  );
  await run.writeJson('context.json', context, 'context');
  await run.writeText(RUN_PATHS.diff, renderPatch(change), 'diff');
  // Diff hunks are evidence from the start: rule findings and authors cite them.
  await writeEvidence(run);

  const calibration = await calibrationFor(config, change, git, run);
  const providerChoice = chooseSessionProvider(config, execution, run, repoConfig.source);
  const provider = createProvider(providerChoice, config, root);
  return {
    run,
    change,
    context,
    config,
    resolved,
    git,
    logger,
    redactor,
    providerChoice,
    provider,
    cacheDir: `${root}/.covi/cache`,
    interactive: options.interactive,
    execution,
    language,
    languageSettings: languageSettingsOf(resolved),
    subject,
    calibration,
  };
}

/** Calibration from this repository's collected outcomes, when it is on and there is enough. */
async function calibrationFor(
  config: CoviConfig,
  change: CodeChange,
  git: Git,
  run: Run,
): Promise<Calibration | undefined> {
  if (!config.review.calibration) return undefined;
  const files = await readOutcomes(change.repository.root, {
    git,
    warn: (message) => run.warn(message),
  });
  return calibrationOf(
    outcomesOfRepository(files, {
      name: change.repository.name,
      platform: change.metadata.platform,
    }),
  );
}

/**
 * Says once per run which repository commands were withheld, then chooses the provider. A
 * withheld `intelligence.command`, or one blocked by the event (an agent CLI would read the
 * untrusted diff while holding the job's secrets), falls back to what `auto` picks without it.
 */
function chooseSessionProvider(
  config: CoviConfig,
  execution: ExecutionPolicy,
  run: Run,
  source: string | undefined,
): ProviderChoice {
  const { withheld } = execution;
  if (withheld.length)
    run.warn(
      `${source ?? 'The repository configuration'} sets ${withheld.map((c) => c.key).join(', ')}, which ${withheld.length === 1 ? 'is' : 'are'} not trusted on this machine yet, so Covi did not use ${withheld.length === 1 ? 'it' : 'them'}. ${TRUST_HINT}`,
    );
  const withheldCommand = withheld.some((c) => c.key === 'intelligence.command');
  const blockedCommand = !execution.allowed && Boolean(config.intelligence.command);
  if (!withheldCommand && !blockedCommand) return chooseProvider(config);
  const choice = chooseProvider({
    ...config,
    intelligence: {
      ...config.intelligence,
      command: undefined,
      provider: config.intelligence.provider === 'command' ? 'auto' : config.intelligence.provider,
    },
  });
  run.warn(
    blockedCommand
      ? `intelligence.command was not run: ${execution.reason} Used the ${choice.kind} provider instead.`
      : `Used the ${choice.kind} provider instead of intelligence.command.`,
  );
  return choice;
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Commands in repository configuration run only once the user trusts them for this repository
 * (`covi trust`). Untrusted ones are removed from the configuration and listed in `withheld`.
 * An explicit --config file is the user's own choice, and in CI configuration comes from the base
 * revision; neither needs this gate.
 */
async function gateRepositoryCommands(
  root: string,
  repo: { values?: ParsedConfigInput; source?: string },
  options: SessionOptions,
  withheld: RepositoryCommand[],
): Promise<{ values?: ParsedConfigInput; source?: string }> {
  if (!repo.values || options.trustedConfig || options.configPath) return repo;
  const commands = repositoryCommands(repo.values);
  if (!commands.length) return repo;
  if (options.trustCommands || process.env.COVI_TRUST_COMMANDS === '1') return repo;
  if (await new TrustStore().isTrusted(root, commands)) return repo;
  withheld.push(...commands);
  options.logger.debug(`withheld untrusted commands: ${describeCommands(commands).join('; ')}`);
  return { ...repo, values: withoutRepositoryCommands(repo.values) };
}

/** A unified diff of the change, rebuilt from parsed hunks (redacted when written). */
export function renderPatch(change: CodeChange): string {
  return change.files
    .map((f) => {
      const from = f.status === 'added' ? '/dev/null' : `a/${f.oldPath ?? f.path}`;
      const to = f.status === 'deleted' ? '/dev/null' : `b/${f.path}`;
      const header = `diff --git a/${f.oldPath ?? f.path} b/${f.path}`;
      if (f.binary) return `${header}\nBinary files ${from} and ${to} differ\n`;
      if (!f.hunks.length) return `${header}\n`;
      return `${header}\n--- ${from}\n+++ ${to}\n${renderFileDiff(f)}\n`;
    })
    .join('');
}

/** Re-resolves a run's change (with hunks) from the revisions recorded in run.json. */
export async function reloadChange(run: Run, root: string, logger: Logger): Promise<CodeChange> {
  const recorded = run.manifest.change;
  if (!recorded) throw new EnvironmentError(`Run ${run.id} has no recorded change.`);
  const scoped = recorded.source.kind === 'uncommitted' || recorded.source.kind === 'staged';
  const change = await resolveChange({
    repo: root,
    range: scoped ? undefined : `${recorded.base.sha}..${recorded.head.sha}`,
    scope: scoped ? (recorded.source.kind as ChangeScope) : 'committed',
    source: recorded.source,
    metadata: { title: recorded.title },
    logger,
  });
  return change;
}

/** Opens an existing run and rebuilds what later stages need from its artifacts. */
export async function openSession(
  ref: string,
  options: {
    repo: string;
    logger: Logger;
    interactive: boolean;
    explicit: ParsedConfigInput;
    configPath?: string;
    trustCommands?: boolean;
  },
): Promise<Omit<Session, 'change'> & { change?: CodeChange }> {
  const root = await repoRoot(options.repo);
  const git = new Git(root);
  const sessionOptions: SessionOptions = {
    workflow: 'resume',
    selection: { repo: root, scope: 'auto', fetch: false },
    explicit: options.explicit,
    configPath: options.configPath,
    entryPoint: 'cli',
    interactive: options.interactive,
    trustCommands: options.trustCommands,
    logger: options.logger,
  };
  const withheld: RepositoryCommand[] = [];
  const repoConfig = await gateRepositoryCommands(
    root,
    await loadRepositoryConfig(
      root,
      options.configPath ? { kind: 'file', path: options.configPath } : { kind: 'worktree' },
    ),
    sessionOptions,
    withheld,
  );
  const resolved = resolveConfig(buildLayers(sessionOptions, repoConfig));
  const redactor = Redactor.fromProcess();
  const run = await Run.open(ref, { root, runsDir: resolved.config.output.dir, redactor });
  const context = await run.readJson<ReviewContext>('context.json');
  // A run keeps the language it was written in, unless this command names another.
  const settings = languageSettingsOf(resolved);
  const recorded = run.manifest.language;
  const language: ResolvedLanguage = settings.flag
    ? { language: settings.flag, setting: settings.flag, source: settingSource(resolved) }
    : recorded
      ? { language: recorded.value, setting: recorded.setting, source: recorded.source }
      : resolveOutputLanguage(resolved.config.language, settingSource(resolved), {
          title: run.manifest.change?.title,
        });
  const providerChoice = chooseSessionProvider(
    resolved.config,
    { allowed: true, withheld },
    run,
    repoConfig.source,
  );
  return {
    run,
    context,
    config: resolved.config,
    resolved,
    git,
    logger: options.logger,
    redactor,
    providerChoice,
    provider: createProvider(providerChoice, resolved.config, root),
    cacheDir: `${root}/.covi/cache`,
    interactive: options.interactive,
    execution: { allowed: true, withheld },
    language,
    languageSettings: settings,
  };
}
