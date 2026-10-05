import type { FindingInput } from '../../model/finding.ts';
import { code, joinList, plural } from '../../util/text.ts';
import type { Rule } from './types.ts';

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
  async run({ context, files, reader }) {
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
        title: `${manifest} changed but ${present} did not`,
        certainty: 'likely',
        severity: 'medium',
        category: 'dependency',
        location: { path: manifest },
        evidence: `Dependency changes (${joinList(deps.slice(0, 4).map((d) => code(`${d.name}${d.to ? `@${d.to}` : ''}`)))}) with no update to ${present}.`,
        explanation:
          'Reproducible installs (npm ci, cargo build --locked, …) will fail or resolve versions different from the ones that were tested.',
        suggestion: `Run the package manager's install and commit the updated ${present}.`,
      });
    }
    return out;
  },
};

export const majorDependencyUpgrade: Rule = {
  id: 'major-dependency-upgrade',
  checks: 'major-version dependency upgrades',
  run({ context }) {
    const majors = context.dependencies.filter((d) => d.major && !d.dev);
    if (majors.length === 0) return [];
    return [
      {
        title:
          majors.length === 1
            ? `Major upgrade of ${majors[0]!.name}`
            : `${majors.length} major dependency upgrades`,
        certainty: 'risk',
        severity: 'low',
        category: 'dependency',
        location: { path: majors[0]!.manifest },
        evidence: majors
          .slice(0, 5)
          .map((d) => `${d.name}: ${d.from} → ${d.to}`)
          .join('\n'),
        explanation:
          'Major versions are where libraries make breaking changes; behavior can change even when the code compiles.',
        suggestion:
          'Skim the release notes for breaking changes that affect how this project uses the package.',
      },
    ];
  },
};

export const envVarUndocumented: Rule = {
  id: 'env-var-undocumented',
  checks: 'new environment variables missing from env examples',
  async run({ context, reader }) {
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
            ? `New environment variable ${first.name} is not documented`
            : `${missing.length} new environment variables are not documented`,
        certainty: 'risk',
        severity: 'low',
        category: 'configuration',
        location: { path: first.path, line: first.line },
        evidence: `${joinList(missing.map((e) => code(e.name)))} ${missing.length === 1 ? 'is' : 'are'} read by the code but missing from ${examples[0]!.path}.`,
        explanation:
          'Deployments and teammates rely on the example file to know what to set; a missing variable usually surfaces as a runtime failure.',
        suggestion: `Add ${missing.length === 1 ? 'it' : 'them'} to ${examples[0]!.path} with a safe placeholder value.`,
      },
    ];
  },
};

export const missingTests: Rule = {
  id: 'missing-tests',
  checks: 'behavior changes without accompanying tests',
  run({ context, files }) {
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
        title: bugFix ? 'Bug fix without a regression test' : 'Behavior change without tests',
        certainty: 'risk',
        severity: bugFix ? 'medium' : 'low',
        category: 'testing',
        location: { path: untested[0]!.path },
        evidence: `${plural(untested.length, 'source file')} changed (${lines} added lines) and no test files changed: ${joinList(untested.slice(0, 3).map((f) => code(f.path)))}.`,
        explanation: bugFix
          ? 'Without a test that fails before the fix, the bug can quietly return.'
          : 'New behavior without tests is easy to break in later changes.',
        suggestion: bugFix
          ? 'Add a test that reproduces the original bug.'
          : 'Add tests for the main paths of the new behavior.',
      },
    ];
  },
};

export const intentMismatch: Rule = {
  id: 'intent-mismatch',
  checks: 'mismatch between the stated intent and what the change does',
  run({ context }) {
    const ambiguity = context.intent.ambiguity;
    if (!ambiguity?.startsWith('Described as')) return [];
    return [
      {
        title: `Change is described as ${context.intent.kind.replace('-', ' ')} but changes behavior`,
        certainty: 'question',
        severity: 'low',
        category: 'intent-mismatch',
        evidence: [ambiguity, ...context.intent.evidence.slice(0, 2)].join('\n'),
        explanation:
          'Reviewers calibrate how closely they read based on the description; an unannounced behavior change is easy to miss.',
        suggestion: 'Confirm the behavior change is intended and mention it in the description.',
      },
    ];
  },
};
