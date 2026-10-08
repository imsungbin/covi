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
const collectFlags = flagsOf('outcomes', 'collect');
const reportFlags = flagsOf('outcomes', 'report');

interface Action {
  inputs: Record<string, { description: string; default?: string }>;
  outputs: Record<string, { value: string }>;
  runs: {
    using: string;
    steps: Array<{
      id?: string;
      name: string;
      if?: string;
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
    // Each line of an outcomes step that builds Covi's arguments, global flags such as a
    // prepended --config included.
    for (const step of action.runs.steps.filter((s) => s.run?.includes('outcomes collect')))
      for (const line of step.run!.split('\n').filter((l) => /\$COVI_BIN|args=/.test(l))) {
        const command = line.includes('outcomes report') ? 'report' : 'collect';
        for (const flag of line.match(/--[a-z-]+/g) ?? [])
          expect(
            (command === 'collect' ? collectFlags : reportFlags).has(flag),
            `${flag} is not a covi outcomes ${command} flag`,
          ).toBe(true);
      }
  });

  it('passes finding-anchors as a flag to the review and to publishing an earlier run', () => {
    for (const name of ['Review', 'Publish comment for an earlier run']) {
      const step = action.runs.steps.find((s) => s.name === name)!;
      expect(step.env, name).toMatchObject({ FINDING_ANCHORS: '${{ inputs.finding-anchors }}' });
      expect(step.run, name).toContain(
        'if [ "$FINDING_ANCHORS" = "true" ]; then args+=(--anchors); fi',
      );
      expect(step.run, name).toContain(
        'if [ "$FINDING_ANCHORS" = "false" ]; then args+=(--no-anchors); fi',
      );
    }
  });

  it('gives the token only to the steps that comment or read outcomes', () => {
    for (const step of action.runs.steps) {
      const env = JSON.stringify(step.env ?? {});
      if (/github-token/.test(env))
        expect(['Comment', 'Publish comment for an earlier run', 'Collect outcomes']).toContain(
          step.name,
        );
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
      'language',
      'annotations',
      'provider',
      'finding-anchors',
    ])
      expect(action.inputs[name]?.default, name).toBe('');
  });

  it('never installs Covi by a package name it does not control', () => {
    const install = action.runs.steps.find((s) => s.name === 'Install Covi')!.run!;
    expect(install).not.toMatch(/npm install[^\n]*\bcovi\b(?!_)/);
    expect(install).toContain('"$COVI_PACKAGE"');
    expect(action.inputs['covi-package']!.default).toBe('');
  });

  it('collects outcomes only on a closed pull request from this repository, and keeps them in the Actions cache', () => {
    const step = (name: string) => action.runs.steps.find((s) => s.name === name)!;
    const restore = step('Restore outcomes');
    expect(restore.uses).toBe('actions/cache/restore@v4');
    expect(restore.if).toBe("inputs.outcomes == 'true'");
    expect(restore.with).toMatchObject({ 'restore-keys': 'covi-outcomes-' });
    expect(restore.with!.path).toMatch(/\.covi\/outcomes$/);
    const collect = step('Collect outcomes');
    // A fork's pull request must not feed the cache every later review restores.
    expect(collect.if).toBe(
      "inputs.outcomes == 'true' && github.event.action == 'closed' && github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(collect.run).toContain('outcomes collect --platform github');
    // Best effort: a failed report must not stop Save from keeping what was just collected.
    expect(collect.run).toMatch(
      /outcomes report --repository "\$REPOSITORY" >> "\$GITHUB_STEP_SUMMARY" \|\|\s+echo "::warning::/,
    );
    // The report reads git to ignore committed outcomes: it runs only in a checkout.
    expect(collect.run).toContain('git rev-parse --is-inside-work-tree');
    expect(collect.env).toMatchObject({
      REPOSITORY: '${{ github.repository }}',
      CONFIG: '${{ inputs.config }}',
    });
    const save = step('Save outcomes');
    expect(save.uses).toBe('actions/cache/save@v4');
    expect(save.if).toBe(collect.if);
    expect(save.with).toMatchObject({ key: restore.with!.key, path: restore.with!.path });
    // On a closed pull request nothing is reviewed or installed for a review.
    for (const name of ['Install the browser and video tools', 'Review'])
      expect(step(name).if, name).toContain(
        "!(inputs.outcomes == 'true' && github.event.action == 'closed')",
      );
    expect(action.inputs.outcomes!.default).toBe('false');
    // Collecting at close time cannot see a revert that lands later.
    expect(action.inputs.outcomes!.description).not.toMatch(/\breverted\b/);
    expect(action.inputs.outcomes!.description).toContain('--recent');
  });

  it("ships an author-side workflow: a review on every push, outcomes on close without the pull request's code", () => {
    const authorText = readFileSync(
      join(root, 'integrations/github-action/examples/author-side.yml'),
      'utf8',
    );
    expect(authorText).not.toContain('reverted later');
    expect(authorText).toContain('--recent');
    const author = parse(authorText) as {
      on: Record<string, { types: string[] }>;
      permissions: Record<string, string>;
      concurrency: { 'cancel-in-progress': boolean };
      jobs: Record<
        string,
        {
          if: string;
          permissions?: Record<string, string>;
          steps: Array<{ uses?: string; with?: Record<string, unknown> }>;
        }
      >;
    };
    expect(author.on.pull_request!.types).toContain('synchronize');
    expect(author.on.pull_request_target!.types).toEqual(['closed']);
    expect(author.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(author.concurrency['cancel-in-progress']).toBe(true);
    const review = author.jobs.review!;
    expect(review.if).toBe(
      "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
    );
    const coviStep = (job: (typeof author.jobs)[string]) =>
      job.steps.find((s) => s.uses?.includes('integrations/github-action'))!;
    expect(coviStep(review).with).toMatchObject({ outcomes: true, 'finding-anchors': true });
    const outcomes = author.jobs.outcomes!;
    expect(outcomes.if).toContain("github.event_name == 'pull_request_target'");
    expect(outcomes.if).toContain("github.event.action == 'closed'");
    expect(outcomes.if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(outcomes.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    // pull_request_target has a privileged token: this job checks out only the base commit
    // (for the base's config and the report), never the pull request's code.
    const checkouts = outcomes.steps.filter((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkouts).toEqual([
      {
        uses: 'actions/checkout@v4',
        with: { ref: '${{ github.event.pull_request.base.sha }}', 'persist-credentials': false },
      },
    ]);
    expect(JSON.stringify(outcomes.steps)).not.toMatch(/head|merge_commit|"repository"/);
    expect(coviStep(outcomes).with).toEqual({ outcomes: true });
    for (const job of Object.values(author.jobs))
      for (const key of Object.keys(coviStep(job).with ?? {}))
        expect(action.inputs, `${key} is not an action input`).toHaveProperty(key);
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
      'language',
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

describe('GitLab outcomes component', () => {
  const text = readFileSync(join(root, 'integrations/gitlab-ci/covi-outcomes.yml'), 'utf8');
  type Cache = { key: string; paths: string[]; policy: string; unprotect?: boolean };
  const [specDoc, jobDoc] = parseAllDocuments(text).map((d) => d.toJS()) as [
    { spec: { inputs: Record<string, { default?: unknown }> } },
    Record<
      string,
      {
        rules: Array<{ if: string }>;
        cache: Cache;
        script: string[];
        before_script: string[];
        variables: Record<string, string>;
      }
    >,
  ];
  const job = jobDoc['covi-outcomes']!;
  const reviewText = readFileSync(join(root, 'integrations/gitlab-ci/covi.yml'), 'utf8');
  const review = (
    parseAllDocuments(reviewText)[1]!.toJS() as Record<
      string,
      {
        cache: Cache;
        rules: Array<{ if: string; variables?: Record<string, string> }>;
        variables: Record<string, string>;
        before_script: string[];
      }
    >
  )['covi-review']!;
  const protectedRef = '$CI_COMMIT_REF_PROTECTED == "true"';

  it('runs on a schedule on the protected default branch and fills the protected cache', () => {
    expect(JSON.stringify(job.rules)).toContain('schedule');
    expect(JSON.stringify(job.rules)).not.toContain('merge_request_event');
    for (const rule of job.rules) {
      expect(rule.if).toContain('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH');
      expect(rule.if).toContain(protectedRef);
    }
    expect(job.cache).toEqual({
      key: 'covi-outcomes',
      paths: ['.covi/outcomes/'],
      policy: 'pull-push',
    });
    // GitLab keeps protected and non-protected caches apart unless told otherwise.
    expect(`${text}\n${reviewText}`).not.toMatch(/^\s*unprotect:/m);
  });

  it('collects with its own protected token and leaves COVI_GITLAB_TOKEN to the review', () => {
    // covi-review needs COVI_GITLAB_TOKEN on unprotected merge requests, so it cannot be protected.
    expect(text).toContain('a token with the read_api scope in GITLAB_TOKEN');
    expect(text).toContain('Add it as a masked, protected CI/CD variable');
    const collect = job.script.find((l) => l.includes('outcomes collect'))!;
    expect(collect).toMatch(/^env -u COVI_GITLAB_TOKEN "\$COVI_BIN" outcomes collect /);
    const check = job.script.findIndex((l) => l.includes('[ -n "$GITLAB_TOKEN" ] ||'));
    expect(check).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(job.script.indexOf(collect));
  });

  it('restores outcomes in a review only on a protected ref, and never lets them shape an unprotected checkout', () => {
    // Any branch's pipeline can write the non-protected cache: an unprotected review must not pull it.
    expect(review.cache).toEqual({
      key: job.cache.key,
      paths: job.cache.paths,
      policy: '$COVI_OUTCOMES_CACHE',
    });
    expect(review.variables.COVI_OUTCOMES_CACHE).toBe('push');
    const pulling = review.rules.filter((r) => r.variables?.COVI_OUTCOMES_CACHE);
    expect(pulling).toHaveLength(1);
    expect(pulling[0]!.variables!.COVI_OUTCOMES_CACHE).toBe('pull');
    expect(pulling[0]!.if).toContain(protectedRef);
    // And whatever a cache extracted is gone before Covi is installed or run.
    const guard = review.before_script.findIndex((l) =>
      l.includes('if [ "$CI_COMMIT_REF_PROTECTED" != "true" ]'),
    );
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(review.before_script[guard]).toContain('rm -rf .covi/outcomes');
    expect(review.before_script[guard]).toContain('git reset -q --hard');
    const firstCovi = review.before_script.findIndex((l) => /COVI_PACKAGE|COVI_BIN/.test(l));
    expect(guard).toBeLessThan(firstCovi);
  });

  it('declares inputs with defaults, uses each one, and passes only flags the CLI accepts', () => {
    for (const [name, input] of Object.entries(specDoc.spec.inputs)) {
      expect(input.default, name).not.toBeUndefined();
      expect(text, `input ${name} is never used`).toContain(`inputs.${name} ]]`);
    }
    for (const m of text.matchAll(/\$\[\[ inputs\.([\w-]+) \]\]/g))
      expect(specDoc.spec.inputs, m[1]).toHaveProperty(m[1]!);
    // Best effort: a failed report must not fail the job, or the cache keeps nothing.
    expect(job.script.join('\n')).toContain(
      'outcomes report --repository "$CI_PROJECT_PATH" || echo',
    );
    for (const line of job.script) {
      const flags = line.includes('outcomes collect') ? collectFlags : reportFlags;
      for (const flag of line.match(/--[a-z-]+/g) ?? [])
        expect(flags.has(flag), `${flag} in: ${line}`).toBe(true);
    }
    const install = job.before_script.join('\n');
    expect(install).not.toMatch(/npm install[^\n]*\bcovi\b(?!_)/);
    expect(install).toContain('gitlab-ci-token:${CI_JOB_TOKEN}');
  });

  it('renders with default inputs into strings, never nulls', () => {
    const body = text
      .split('\n---\n')[1]!
      .replace(/\$\[\[ inputs\.([\w-]+) \]\]/g, (_m, key: string) =>
        String(specDoc.spec.inputs[key]!.default),
      );
    const rendered = (parse(body) as Record<string, { variables: Record<string, unknown> }>)[
      'covi-outcomes'
    ]!;
    for (const [name, value] of Object.entries(rendered.variables))
      expect(typeof value, name).toBe('string');
  });
});
