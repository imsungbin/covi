import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';
import { covi } from './helpers/cli.ts';

const root = join(import.meta.dirname, '..');
/** The exact flags a command accepts, from its help (global options included). */
function flagsOf(...command: string[]): Set<string> {
  const help = `${covi([...command, '--help']).stdout}\n${covi(['--help']).stdout}`;
  return new Set(help.match(/--[a-z][a-z-]*/g));
}
const ciFlags = flagsOf('ci');
const publishFlags = flagsOf('publish');

interface Action {
  inputs: Record<string, { description: string; default?: string }>;
  outputs: Record<string, { value: string }>;
  runs: {
    using: string;
    steps: Array<{
      id?: string;
      name: string;
      run?: string;
      uses?: string;
      env?: Record<string, string>;
      with?: Record<string, string>;
    }>;
  };
}

describe('GitHub Action', () => {
  const action = parse(
    readFileSync(join(root, 'integrations/github-action/action.yml'), 'utf8'),
  ) as Action;
  const text = readFileSync(join(root, 'integrations/github-action/action.yml'), 'utf8');

  it('is a composite action that runs the CLI', () => {
    expect(action.runs.using).toBe('composite');
    expect(text).toContain('"$COVI_BIN" "${args[@]}"');
  });

  it('uses every input and documents it', () => {
    for (const [name, input] of Object.entries(action.inputs)) {
      expect(input.description, name).toBeTruthy();
      expect(text, `input ${name} is never used`).toContain(`inputs.${name}`);
    }
  });

  it('exposes outputs that come from real steps', () => {
    const ids = new Set(action.runs.steps.map((s) => s.id).filter(Boolean));
    for (const [name, output] of Object.entries(action.outputs)) {
      const step = /steps\.([\w-]+)\.outputs/.exec(output.value)?.[1];
      expect(ids.has(step), `output ${name} references missing step ${step}`).toBe(true);
    }
  });

  it('never interpolates expressions into shell scripts (script-injection safe)', () => {
    for (const step of action.runs.steps) {
      if (step.run) expect(step.run, step.name).not.toMatch(/\$\{\{/);
    }
  });

  it('only passes flags the CLI accepts', () => {
    const flags = new Set(
      [...text.matchAll(/\((?:ci|publish) ([^)]*)\)|args\+=\(([^)]*)\)/g)].flatMap(
        (m) => (m[1] ?? m[2] ?? '').match(/--[a-z-]+/g) ?? [],
      ),
    );
    expect(flags.size).toBeGreaterThan(5);
    for (const flag of flags)
      expect(ciFlags.has(flag) || publishFlags.has(flag), `${flag} is not a covi flag`).toBe(true);
  });

  it('gives the token only to the steps that comment', () => {
    for (const step of action.runs.steps) {
      const env = JSON.stringify(step.env ?? {});
      if (/github-token/.test(env))
        expect(['Comment', 'Publish comment for an earlier run']).toContain(step.name);
    }
  });

  it('ships example workflows that use least privilege', () => {
    const pr = parse(
      readFileSync(join(root, 'integrations/github-action/examples/pull-request.yml'), 'utf8'),
    ) as { on: Record<string, unknown>; permissions: Record<string, string> };
    expect(Object.keys(pr.on)).toEqual(['pull_request']);
    expect(pr.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    const fork = readFileSync(
      join(root, 'integrations/github-action/examples/fork-safe-comment.yml'),
      'utf8',
    );
    expect(fork).toContain('workflow_run');
    expect(fork).not.toContain('actions/checkout');
    // GitHub leaves pull_requests empty for forks; the target must come from Covi's lookup.
    expect(fork).not.toMatch(/pull_requests\[0\]|pr-number/);
  });

  it('leaves settings to the repository unless an input is set', () => {
    for (const name of [
      'fail-on',
      'video',
      'video-mode',
      'duration',
      'narration',
      'captions',
      'annotations',
      'provider',
    ])
      expect(action.inputs[name]?.default, name).toBe('');
  });

  it('never installs Covi by a package name it does not control', () => {
    const install = action.runs.steps.find((s) => s.name === 'Install Covi')!.run!;
    expect(install).not.toMatch(/npm install[^\n]*\bcovi\b(?!_)/);
    expect(install).toContain('"$COVI_PACKAGE"');
    expect(action.inputs['covi-package']!.default).toBe('');
  });
});

describe('GitLab CI component', () => {
  const [specDoc, jobDoc] = parseAllDocuments(
    readFileSync(join(root, 'integrations/gitlab-ci/covi.yml'), 'utf8'),
  ).map((d) => d.toJS()) as [
    { spec: { inputs: Record<string, { default?: unknown; options?: unknown[] }> } },
    Record<
      string,
      {
        script: string[];
        before_script: string[];
        rules: unknown[];
        artifacts: { reports: Record<string, string>; paths: string[] };
        variables: Record<string, string>;
      }
    >,
  ];
  const job = jobDoc['covi-review']!;
  const text = readFileSync(join(root, 'integrations/gitlab-ci/covi.yml'), 'utf8');

  it('declares inputs with defaults and uses each one', () => {
    for (const [name, input] of Object.entries(specDoc.spec.inputs)) {
      expect(input.default, name).not.toBeUndefined();
      expect(text, `input ${name} is never used`).toContain(`inputs.${name} ]]`);
    }
    for (const m of text.matchAll(/\$\[\[ inputs\.([\w-]+) \]\]/g))
      expect(specDoc.spec.inputs, m[1]).toHaveProperty(m[1]!);
  });

  it('runs on merge request pipelines with full history', () => {
    expect(JSON.stringify(job.rules)).toContain('merge_request_event');
    expect(job.variables.GIT_DEPTH).toBe('0');
  });

  it('publishes artifacts and native reports', () => {
    expect(job.artifacts.paths).toEqual(['.covi-run/']);
    expect(job.artifacts.reports).toEqual({
      codequality: '.covi-run/reports/gl-code-quality-report.json',
      dotenv: '.covi-run/reports/covi.env',
    });
  });

  it('only passes flags the CLI accepts', () => {
    const flags = new Set(job.script.join('\n').match(/--[a-z-]+/g));
    for (const flag of flags) expect(ciFlags.has(flag), `${flag} is not a covi ci flag`).toBe(true);
    const doctorFlags = flagsOf('doctor');
    const doctorLines = job.before_script.filter((l) => /\$COVI_BIN"? doctor/.test(l));
    expect(doctorLines).toHaveLength(1);
    for (const line of doctorLines)
      for (const flag of line.match(/--[a-z-]+/g) ?? [])
        expect(doctorFlags.has(flag), `${flag} is not a covi doctor flag`).toBe(true);
  });

  it('leaves settings to the repository unless an input is set', () => {
    for (const name of [
      'fail-on',
      'video',
      'video-mode',
      'duration',
      'narration',
      'comment',
      'provider',
    ])
      expect(specDoc.spec.inputs[name]?.default, name).toBe('');
    for (const [name, input] of Object.entries(specDoc.spec.inputs))
      if (input.options) expect(input.options, name).toContain(input.default);
  });

  it('installs Covi from source or a package the user names, never by a name it does not control', () => {
    const install = job.before_script.join('\n');
    expect(install).not.toMatch(/npm install[^\n]*\bcovi\b(?!_)/);
    expect(install).toContain('"$COVI_PACKAGE"');
    expect(install).toContain('gitlab-ci-token:${CI_JOB_TOKEN}');
    expect(specDoc.spec.inputs['covi-package']!.default).toBe('');
  });

  it('renders with default inputs into strings, never nulls (empty inputs stay empty)', () => {
    const body = text
      .split('\n---\n')[1]!
      .replace(/\$\[\[ inputs\.([\w-]+) \]\]/g, (_m, key: string) =>
        String(specDoc.spec.inputs[key]!.default),
      );
    const rendered = (parse(body) as Record<string, { variables: Record<string, unknown> }>)[
      'covi-review'
    ]!;
    for (const [name, value] of Object.entries(rendered.variables))
      expect(typeof value, name).toBe('string');
  });

  it('uses the browser image that matches the pinned Playwright version', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.playwright).toMatch(/^\d+\.\d+\.\d+$/);
    expect(String(specDoc.spec.inputs.image!.default)).toBe(
      `mcr.microsoft.com/playwright:v${pkg.dependencies.playwright}-noble`,
    );
  });
});

describe('Claude Code plugin', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const plugin = read('.claude-plugin/plugin.json') as { name: string; version: string };
  const marketplace = read('.claude-plugin/marketplace.json') as {
    plugins: Array<{ name: string; source: string }>;
  };
  const pkg = read('package.json') as { version: string };

  it('offers this repository as the plugin, at the package version', () => {
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: plugin.name, source: './' }),
    ]);
    expect(plugin.version).toBe(pkg.version);
  });

  it('ships an executable bin/covi, which the plugin puts on PATH', () => {
    const bin = join(root, 'bin', 'covi');
    expect(statSync(bin).mode & 0o111, 'bin/covi must be executable').not.toBe(0);
    const result = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(pkg.version);
  });
});
