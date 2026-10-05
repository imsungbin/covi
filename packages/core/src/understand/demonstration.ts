import type { CoviConfig } from '../config/schema.ts';
import { t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import type { ChangedFile } from '../model/change.ts';
import type {
  ChangeSize,
  DemoCandidate,
  DemoKind,
  DemonstrationAssessment,
  Intent,
  RouteChange,
  SymbolChange,
} from '../model/context.ts';

export interface RepoShape {
  /** Directory with an index.html that can be served without running project code. */
  staticRoot?: string;
  /** package.json scripts and whether the project needs a bundler/dev server. */
  scripts: Record<string, string>;
  needsBuild: boolean;
  bin: boolean;
}

export interface DemonstrationInput {
  files: readonly ChangedFile[];
  symbols: readonly SymbolChange[];
  routes: readonly RouteChange[];
  intent: Intent;
  size: ChangeSize;
  areaCount: number;
  config: CoviConfig;
  repo: RepoShape;
  /** The language of the reasons. Default: English. */
  language?: Language;
}

const INTERACTION_HINT =
  /\b(onClick|onChange|onSubmit|onInput|onKey\w+|addEventListener|useState|useReducer|setState|dispatch\(|v-on:|@click|on:click|fetch\(|axios\.|submit|disabled|aria-)/;

function changedText(file: ChangedFile): string {
  return file.hunks
    .flatMap((h) => h.lines.filter((l) => l.kind !== 'context').map((l) => l.text))
    .join('\n');
}

/** Maps a changed page/markup file to the URL path that renders it, when that is knowable. */
export function pagePathFor(path: string, staticRoot?: string): string | undefined {
  if (staticRoot !== undefined && /\.html?$/.test(path)) {
    const prefix =
      staticRoot === '.' || staticRoot === '' ? '' : `${staticRoot.replace(/\/$/, '')}/`;
    if (!prefix || path.startsWith(prefix)) {
      const rel = path.slice(prefix.length);
      return rel === 'index.html' ? '/' : `/${rel.replace(/(^|\/)index\.html?$/, '$1')}`;
    }
  }
  const next = /(?:^|\/)app\/(.*?)\/?page\.[jt]sx?$/.exec(path);
  if (next) return `/${next[1]!.replace(/\([^)]*\)\/?/g, '')}`.replace(/\/+$/, '') || '/';
  const pages = /(?:^|\/)pages\/(.*)\.(?:[jt]sx?|vue|svelte|astro|md)$/.exec(path);
  if (pages && !pages[1]!.startsWith('api/') && !pages[1]!.startsWith('_')) {
    return `/${pages[1]!.replace(/(^|\/)index$/, '')}`.replace(/\/+$/, '') || '/';
  }
  const svelte = /(?:^|\/)routes\/(.*?)\/?\+page\.svelte$/.exec(path);
  if (svelte) return `/${svelte[1]}`.replace(/\/+$/, '') || '/';
  return undefined;
}

export function assessDemonstration(input: DemonstrationInput): DemonstrationAssessment {
  const { files, config, repo } = input;
  const reviewable = files.filter(
    (f) => !f.ignored && f.category !== 'test' && f.category !== 'docs',
  );
  const kinds = new Set<DemoKind>();
  const reasons: string[] = [];
  const say = (key: string, params?: Record<string, string | number>) =>
    t(input.language ?? 'en', `demonstration.${key}`, params);
  const candidates: DemoCandidate[] = [];

  const styleFiles = reviewable.filter((f) => f.category === 'style');
  const uiFiles = reviewable.filter(
    (f) => f.surfaces.includes('ui') && f.category !== 'style' && f.category !== 'asset',
  );
  const interactive = uiFiles.filter((f) => INTERACTION_HINT.test(changedText(f)));
  const apiRoutes = input.routes;
  const apiFiles = reviewable.filter((f) => f.surfaces.includes('api'));
  const cliFiles = reviewable.filter((f) => f.surfaces.includes('cli'));
  const uiLines = [...uiFiles, ...styleFiles].reduce((n, f) => n + f.additions + f.deletions, 0);

  if (styleFiles.length) {
    kinds.add('visual');
    reasons.push(say('stylesheet', { count: styleFiles.length }));
  }
  if (uiFiles.length) {
    kinds.add('ui');
    reasons.push(
      say('ui', {
        where: uiFiles.length === 1 ? uiFiles[0]!.path : say('uiFiles', { count: uiFiles.length }),
      }),
    );
  }
  if (interactive.length) {
    kinds.add('interaction');
    reasons.push(say('interaction'));
  }
  if (apiRoutes.length || apiFiles.length) {
    kinds.add('api');
    reasons.push(
      apiRoutes.length
        ? say('routes', {
            routes: apiRoutes
              .slice(0, 3)
              .map((r) => (r.method ? `${r.method} ${r.path}` : r.path))
              .join(', '),
          })
        : say('handlers'),
    );
  }
  if (cliFiles.length || config.demo.commands.length) {
    kinds.add('cli');
    if (cliFiles.length) reasons.push(say('cli'));
  }
  const internalOnly = kinds.size === 0;
  if (
    internalOnly &&
    input.intent.kind === 'refactor' &&
    (input.size.class === 'large' || input.size.class === 'huge') &&
    input.areaCount >= 3
  ) {
    kinds.add('architecture');
    reasons.push(say('architecture'));
  }

  // Candidates: what concretely could be shown.
  for (const f of [...uiFiles, ...styleFiles]) {
    const page = pagePathFor(f.path, repo.staticRoot);
    if (page && !candidates.some((c) => c.target === page)) {
      candidates.push({ kind: 'ui', target: page, reason: `${f.path} renders this page` });
    }
  }
  for (const page of config.demo.pages)
    candidates.push({ kind: 'ui', target: page, reason: 'configured in demo.pages' });
  for (const flow of config.demo.flows)
    candidates.push({ kind: 'interaction', target: flow.path, reason: `flow "${flow.name}"` });
  for (const route of apiRoutes) {
    if (!route.method || route.method === 'GET') {
      candidates.push({
        kind: 'api',
        target: `GET ${route.path}`,
        reason: `route ${route.change} in ${route.file}`,
      });
    }
  }
  for (const request of config.demo.requests)
    candidates.push({
      kind: 'api',
      target: `${request.method} ${request.path}`,
      reason: `request "${request.name}"`,
    });
  for (const command of config.demo.commands)
    candidates.push({ kind: 'cli', target: command.run, reason: `command "${command.name}"` });

  // How Covi could run the software.
  const suggestions: string[] = [];
  const staticRoot =
    config.app.static ?? (config.app.start || config.app.url ? undefined : repo.staticRoot);
  const mode: 'static' | 'command' | undefined =
    config.app.start || config.app.url
      ? 'command'
      : staticRoot !== undefined
        ? 'static'
        : undefined;
  if (!mode) {
    const script = ['dev', 'start', 'preview', 'serve'].find((s) => repo.scripts[s]);
    if (script) suggestions.push(`app.start: npm run ${script}`);
  }
  if ((kinds.has('cli') || repo.bin) && config.demo.commands.length === 0 && cliFiles.length) {
    suggestions.push('demo.commands: [{ name: help, run: "<your cli> --help" }]');
  }
  const runnable = {
    available: mode !== undefined || config.demo.commands.length > 0,
    mode,
    staticRoot,
    suggestions,
    flows: config.demo.flows.length,
    commands: config.demo.commands.length,
    requests: config.demo.requests.length,
  };

  // Value and recommendation.
  let value: DemonstrationAssessment['value'] = 'none';
  if (
    kinds.has('interaction') ||
    (kinds.has('ui') && uiLines > 12) ||
    (kinds.has('api') && runnable.available) ||
    (kinds.has('cli') && config.demo.commands.length)
  ) {
    value = 'high';
  } else if (
    kinds.has('ui') ||
    kinds.has('visual') ||
    kinds.has('api') ||
    kinds.has('cli') ||
    kinds.has('architecture')
  ) {
    value = 'medium';
  } else if (reviewable.some((f) => f.category === 'config' || f.category === 'build')) {
    value = 'low';
  }

  let recommendation: DemonstrationAssessment['recommendation'] = 'text-only';
  if (value === 'high') recommendation = 'video';
  else if (value === 'medium') {
    const onlyVisual = [...kinds].every((k) => k === 'visual' || k === 'ui') && uiLines <= 12;
    recommendation = onlyVisual ? 'screenshots' : 'video';
  }

  if (value === 'none' || value === 'low') {
    reasons.push(internalOnly ? say('nothingVisible') : say('littleVisible'));
  } else if (!runnable.available && (kinds.has('ui') || kinds.has('visual') || kinds.has('api'))) {
    reasons.push(say('cannotRun'));
  }

  return {
    value,
    kinds: [...kinds],
    recommendation,
    reasons,
    runnable,
    candidates: candidates.slice(0, 12),
  };
}
