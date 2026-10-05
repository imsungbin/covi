import { listOf, t } from '../../i18n/catalog.ts';
import type { FindingInput } from '../../model/finding.ts';
import { code } from '../../util/text.ts';
import { messages, type Rule } from './types.ts';

const LOCKFILES: Record<string, string[]> = {
  'package.json': [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
  ],
  'Cargo.toml': ['Cargo.lock'],
  'pyproject.toml': ['poetry.lock', 'uv.lock', 'pdm.lock'],
  Gemfile: ['Gemfile.lock'],
  'go.mod': ['go.sum'],
};

export const lockfileOutOfSync: Rule = {
  id: 'lockfile-out-of-sync',
  checks: 'dependency manifests changed without their lockfile',
  async run({ context, files, reader, language }) {
    const say = messages(language, 'lockfile-out-of-sync');
    const out: FindingInput[] = [];
    const manifests = new Set(
      context.dependencies
        .filter((d) => d.change !== 'changed' || d.from !== d.to)
        .map((d) => d.manifest),
    );
    for (const manifest of manifests) {
      const name = manifest.split('/').pop() ?? manifest;
      const dir = manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/') + 1) : '';
      const candidates = LOCKFILES[name] ?? [];
      const changed = files.some((f) =>
        candidates.some((c) => f.path === `${dir}${c}` || f.path.endsWith(`/${c}`) || f.path === c),
      );
      if (changed) continue;
      // Workspaces keep one lockfile at the repository root.
      let present: string | undefined;
      for (const candidate of candidates) {
        for (const path of [`${dir}${candidate}`, candidate]) {
          if ((await reader.readOne('head', path)) !== undefined) present = path;
          if (present) break;
        }
        if (present) break;
      }
      if (!present) continue;
      const deps = context.dependencies.filter((d) => d.manifest === manifest);
      out.push({
        title: say('title', { manifest, lockfile: present }),
        certainty: 'likely',
        severity: 'medium',
        category: 'dependency',
        location: { path: manifest },
        evidence: say('evidence', {
          dependencies: listOf(
            language ?? 'en',
            deps.slice(0, 4).map((d) => code(`${d.name}${d.to ? `@${d.to}` : ''}`)),
          ),
          lockfile: present,
        }),
        explanation: say('explanation'),
        suggestion: say('suggestion', { lockfile: present }),
      });
    }
    return out;
  },
};

export const majorDependencyUpgrade: Rule = {
  id: 'major-dependency-upgrade',
  checks: 'major-version dependency upgrades',
  run({ context, language }) {
    const say = messages(language, 'major-dependency-upgrade');
    const majors = context.dependencies.filter((d) => d.major && !d.dev);
    if (majors.length === 0) return [];
    return [
      {
        title:
          majors.length === 1
            ? say('title', { name: majors[0]!.name })
            : say('titleMany', { count: majors.length }),
        certainty: 'risk',
        severity: 'low',
        category: 'dependency',
        location: { path: majors[0]!.manifest },
        evidence: majors
          .slice(0, 5)
          .map((d) => `${d.name}: ${d.from} → ${d.to}`)
          .join('\n'),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      },
    ];
  },
};

export const envVarUndocumented: Rule = {
  id: 'env-var-undocumented',
  checks: 'new environment variables missing from env examples',
  async run({ context, reader, language }) {
    const say = messages(language, 'env-var-undocumented');
    const missing = context.envVars.filter((e) => e.change === 'added' && !e.documented);
    if (missing.length === 0) return [];
    // Only meaningful when the repository documents its environment somewhere.
    const examples = await reader.grep('=', {
      at: 'head',
      fixed: true,
      pathspecs: [
        ':(glob)**/.env.example',
        ':(glob)**/.env.sample',
        ':(glob)**/.env.template',
        ':(glob)**/*.env.example',
      ],
      maxHits: 1,
    });
    if (examples.length === 0) return [];
    const first = missing[0]!;
    return [
      {
        title:
          missing.length === 1
            ? say('title', { name: first.name })
            : say('titleMany', { count: missing.length }),
        certainty: 'risk',
        severity: 'low',
        category: 'configuration',
        location: { path: first.path, line: first.line },
        evidence: say('evidence', {
          count: missing.length,
          names: listOf(
            language ?? 'en',
            missing.map((e) => code(e.name)),
          ),
          file: examples[0]!.path,
        }),
        explanation: say('explanation'),
        suggestion: say('suggestion', { count: missing.length, file: examples[0]!.path }),
      },
    ];
  },
};

export const missingTests: Rule = {
  id: 'missing-tests',
  checks: 'behavior changes without accompanying tests',
  run({ context, files, language }) {
    const say = messages(language, 'missing-tests');
    const { tests, intent } = context;
    if (
      !tests.repoHasTests ||
      tests.untestedSourceFiles.length === 0 ||
      tests.changedTestFiles.length > 0
    )
      return [];
    if (!['feature', 'bug-fix', 'performance', 'security', 'mixed'].includes(intent.kind))
      return [];
    const untested = files.filter((f) => tests.untestedSourceFiles.includes(f.path));
    const lines = untested.reduce((n, f) => n + f.additions, 0);
    if (lines < 10 && intent.kind !== 'bug-fix') return [];
    const bugFix = intent.kind === 'bug-fix';
    return [
      {
        title: say(bugFix ? 'titleBugFix' : 'title'),
        certainty: 'risk',
        severity: bugFix ? 'medium' : 'low',
        category: 'testing',
        location: { path: untested[0]!.path },
        evidence: say('evidence', {
          files: say('sourceFiles', { count: untested.length }),
          lines,
          list: listOf(
            language ?? 'en',
            untested.slice(0, 3).map((f) => code(f.path)),
          ),
        }),
        explanation: say(bugFix ? 'explanationBugFix' : 'explanation'),
        suggestion: say(bugFix ? 'suggestionBugFix' : 'suggestion'),
      },
    ];
  },
};

export const intentMismatch: Rule = {
  id: 'intent-mismatch',
  checks: 'mismatch between the stated intent and what the change does',
  run({ context, language }) {
    const say = messages(language, 'intent-mismatch');
    const ambiguity = context.intent.ambiguity;
    const mismatch = context.intent.mismatch ?? ambiguity?.startsWith('Described as');
    if (!ambiguity || !mismatch) return [];
    return [
      {
        title: say('title', { kind: t(language ?? 'en', `intent.kind.${context.intent.kind}`) }),
        certainty: 'question',
        severity: 'low',
        category: 'intent-mismatch',
        evidence: [ambiguity, ...context.intent.evidence.slice(0, 2)].join('\n'),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      },
    ];
  },
};
