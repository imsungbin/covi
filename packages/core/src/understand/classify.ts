import type { FileCategory, Surface } from '../model/change.ts';
import { matchesAny } from '../util/glob.ts';

export interface Classification {
  category: FileCategory;
  language?: string;
  surfaces: Surface[];
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  scala: 'scala',
  ex: 'elixir',
  exs: 'elixir',
  dart: 'dart',
  lua: 'lua',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  prisma: 'prisma',
  tf: 'terraform',
};

const SOURCE_EXT = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'rb',
  'java',
  'kt',
  'kts',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'scala',
  'ex',
  'exs',
  'dart',
  'lua',
  'sh',
  'bash',
  'zsh',
  'sql',
  'graphql',
  'gql',
  'proto',
  'prisma',
]);
const MARKUP_EXT = new Set([
  'html',
  'htm',
  'vue',
  'svelte',
  'astro',
  'hbs',
  'ejs',
  'erb',
  'njk',
  'twig',
  'liquid',
  'pug',
]);
const STYLE_EXT = new Set(['css', 'scss', 'sass', 'less', 'styl', 'pcss']);
const ASSET_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'ico',
  'bmp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp4',
  'webm',
  'mov',
  'mp3',
  'wav',
  'ogg',
  'pdf',
  'zip',
]);
const DOC_EXT = new Set(['md', 'mdx', 'rst', 'adoc', 'txt']);
const CONFIG_EXT = new Set(['yaml', 'yml', 'toml', 'ini', 'properties', 'conf', 'cfg', 'env']);

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'Cargo.lock',
  'go.sum',
  'composer.lock',
  'mix.lock',
  'Podfile.lock',
  'packages.lock.json',
  'gradle.lockfile',
  'pubspec.lock',
  'flake.lock',
]);
const MANIFESTS = new Set([
  'package.json',
  'requirements.txt',
  'requirements-dev.txt',
  'pyproject.toml',
  'Pipfile',
  'setup.py',
  'setup.cfg',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'mix.exs',
  'pubspec.yaml',
  'Package.swift',
]);
const BUILD_FILES =
  /^(tsconfig[\w.-]*\.json|jsconfig\.json|vite\.config\.\w+|vitest\.config\.\w+|webpack\.config\.\w+|rollup\.config\.\w+|esbuild\.\w+|babel\.config\.\w+|\.babelrc|\.eslintrc(\.\w+)?|eslint\.config\.\w+|biome\.jsonc?|\.prettierrc(\.\w+)?|prettier\.config\.\w+|turbo\.json|nx\.json|lerna\.json|Makefile|.*\.mk|CMakeLists\.txt|next\.config\.\w+|nuxt\.config\.\w+|svelte\.config\.\w+|astro\.config\.\w+|postcss\.config\.\w+|jest\.config\.\w+|playwright\.config\.\w+|karma\.conf\.\w+)$/;
const INFRA_FILES =
  /^(Dockerfile(\.\w+)?|.*\.dockerfile|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Procfile|fly\.toml|vercel\.json|netlify\.toml|render\.yaml|app\.yaml|serverless\.ya?ml|.*\.tf|.*\.tfvars)$/;

/** Paths Covi always treats as non-reviewable (still counted in stats). */
export const BUILTIN_IGNORES: ReadonlyArray<{ pattern: string; reason: 'generated' | 'vendored' }> =
  [
    { pattern: '**/node_modules/**', reason: 'vendored' },
    { pattern: '**/vendor/**', reason: 'vendored' },
    { pattern: '**/third_party/**', reason: 'vendored' },
    { pattern: '**/*.min.js', reason: 'generated' },
    { pattern: '**/*.min.css', reason: 'generated' },
    { pattern: '**/*.map', reason: 'generated' },
    { pattern: '**/__snapshots__/**', reason: 'generated' },
    { pattern: '**/*.snap', reason: 'generated' },
    { pattern: '**/*_pb2.py', reason: 'generated' },
    { pattern: '**/*.pb.go', reason: 'generated' },
    { pattern: '**/*.generated.*', reason: 'generated' },
    { pattern: '**/*.gen.*', reason: 'generated' },
    { pattern: 'dist/**', reason: 'generated' },
    { pattern: 'build/**', reason: 'generated' },
    { pattern: 'coverage/**', reason: 'generated' },
    { pattern: '.next/**', reason: 'generated' },
    { pattern: '.nuxt/**', reason: 'generated' },
    { pattern: '.covi/runs/**', reason: 'generated' },
    { pattern: '.covi/cache/**', reason: 'generated' },
  ];

function ext(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

const seg = (names: string) => new RegExp(`(^|/)(${names})(/|$)`, 'i');

const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright-tests)\/|\.(test|spec|e2e|cy)\.[cm]?[jt]sx?$|_test\.(go|py|rb|exs)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|swift|cs)$|_spec\.rb$/i;
const DOC_PATH = /(^|\/)(docs?|documentation|adr|rfcs?)\//i;
const MIGRATION_PATH =
  /(^|\/)(migrations?|migrate|db\/migrate|alembic\/versions|prisma\/migrations|liquibase|flyway)\//i;
const SCHEMA_FILES = /(^|\/)(schema\.prisma|schema\.rb|structure\.sql|schema\.sql)$/i;
const CI_PATH =
  /^(\.github\/workflows\/|\.gitlab-ci\.yml$|\.gitlab\/ci\/|\.circleci\/|\.buildkite\/|Jenkinsfile$|azure-pipelines\.ya?ml$|bitbucket-pipelines\.yml$|\.travis\.yml$|\.drone\.yml$)/;

const UI_PATH = seg(
  'components?|pages?|views?|screens?|layouts?|templates?|ui|widgets?|frontend|client|web|public|static|styles?|theme|assets',
);
const API_PATH = seg(
  'api|apis|routes?|routers?|controllers?|handlers?|endpoints?|resolvers?|rpc|graphql|server|services',
);
const CLI_PATH = seg('bin|cli|cmd|commands?');
const DATA_PATH = seg(
  'models?|entities|entity|db|database|repositories|repository|dao|schemas?|migrations?',
);
const STATE_PATH = seg(
  'store|stores|state|redux|reducers?|slices?|atoms?|signals|context|contexts|hooks?',
);
const SECURITY_PATH = seg(
  'auth|authn|authz|authentication|authorization|security|permissions?|acl|rbac|crypto|sessions?|oauth|jwt|login|passwords?|secrets?|policies',
);

export function classifyFile(path: string): Classification {
  const e = ext(path);
  const base = basename(path);
  const language = LANGUAGES[e];
  const surfaces = new Set<Surface>();

  let category: FileCategory;
  if (LOCKFILES.has(base)) category = 'lockfile';
  else if (
    MANIFESTS.has(base) ||
    base.endsWith('.gemspec') ||
    base.endsWith('.csproj') ||
    /^requirements[\w.-]*\.txt$/.test(base)
  )
    category = 'manifest';
  else if (CI_PATH.test(path)) category = 'ci';
  else if (TEST_PATH.test(path)) category = 'test';
  else if (MIGRATION_PATH.test(path)) category = 'migration';
  else if (SCHEMA_FILES.test(path)) category = 'schema';
  else if (
    INFRA_FILES.test(base) ||
    seg('k8s|kubernetes|helm|terraform|deploy|infra|charts').test(path)
  )
    category = 'infra';
  else if (BUILD_FILES.test(base)) category = 'build';
  else if (STYLE_EXT.has(e) || /tailwind\.config\.\w+$/.test(base)) category = 'style';
  else if (MARKUP_EXT.has(e)) category = 'markup';
  else if (SOURCE_EXT.has(e)) category = 'source';
  else if (ASSET_EXT.has(e)) category = 'asset';
  else if (
    DOC_EXT.has(e) ||
    DOC_PATH.test(path) ||
    /^(README|CHANGELOG|CONTRIBUTING|LICENSE|NOTICE|AUTHORS|SECURITY)(\.|$)/i.test(base)
  )
    category = 'docs';
  else if (
    CONFIG_EXT.has(e) ||
    /^\.env(\.|$)/.test(base) ||
    base.startsWith('.') ||
    /config/i.test(base)
  )
    category = 'config';
  else if (e === 'json') category = /config|settings/i.test(path) ? 'config' : 'other';
  else category = 'other';

  // Surfaces describe which parts of the system a file can affect.
  const isUiFile =
    ['tsx', 'jsx', 'vue', 'svelte', 'astro'].includes(e) ||
    category === 'markup' ||
    category === 'style';
  if (category === 'test') surfaces.add('test');
  if (category === 'docs') surfaces.add('docs');
  if (category === 'ci') surfaces.add('ci');
  if (category === 'manifest' || category === 'lockfile') surfaces.add('dependency');
  if (category === 'build' || category === 'infra') surfaces.add('build');
  if (category === 'config') surfaces.add('config');
  if (category === 'migration' || category === 'schema') surfaces.add('data');

  if (category === 'source' || category === 'markup' || category === 'style') {
    if (isUiFile) surfaces.add('ui');
    else if (UI_PATH.test(path) && !API_PATH.test(path)) surfaces.add('ui');
    if (
      API_PATH.test(path) ||
      /(^|\/)app\/.*\/route\.[jt]s$|(^|\/)pages\/api\//.test(path) ||
      ['graphql', 'gql', 'proto'].includes(e)
    )
      surfaces.add('api');
    if (CLI_PATH.test(path)) surfaces.add('cli');
    if (DATA_PATH.test(path) || e === 'sql' || e === 'prisma') surfaces.add('data');
    if (STATE_PATH.test(path) || /(^|\/)use[A-Z][\w]*\.[jt]sx?$/.test(path)) surfaces.add('state');
    if (/(^|\/)(config|settings|env)(\.[\w]+)?\.[cm]?[jt]s$|(^|\/)config\//.test(path))
      surfaces.add('config');
  }
  if (category !== 'docs' && category !== 'test' && SECURITY_PATH.test(path))
    surfaces.add('security');

  return { category, language, surfaces: [...surfaces] };
}

export function ignoreReason(path: string, userIgnores: readonly string[]): string | undefined {
  for (const rule of BUILTIN_IGNORES) {
    if (matchesAny(path, [rule.pattern])) return rule.reason;
  }
  if (userIgnores.length && matchesAny(path, userIgnores)) return 'config';
  return undefined;
}

/** True when the text looks like it was produced by a tool rather than written by hand. */
export function looksGenerated(firstLines: readonly string[]): boolean {
  return firstLines
    .slice(0, 5)
    .some((l) => /@generated|DO NOT EDIT|auto-?generated|Code generated by/i.test(l));
}
