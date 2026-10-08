import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMENT_MARKER, type PublishRecord, parseLedger, Run, renderLedger } from '@covi/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { covi, coviAsync } from './helpers/cli.ts';
import { canUseBrowser } from './helpers/env.ts';
import {
  githubEnv as githubEnvFor,
  type MockApi,
  mockApi,
  prRepo as prRepoFor,
} from './helpers/mock-api.ts';

const dirs: string[] = [];
let api: MockApi;
beforeAll(async () => {
  api = await mockApi();
});
afterAll(() => {
  api.server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const browser = await canUseBrowser();
const prRepo = (name: string) => prRepoFor(name, dirs);
const githubEnv = (repo: { base: string; head: string }, extra: NodeJS.ProcessEnv = {}) =>
  githubEnvFor(api.url, repo, extra, dirs);

/** The privileged `workflow_run` after a fork's review of `head`: GitHub omits fork pull requests. */
function workflowRun(head: string) {
  const work = mkdtempSync(join(tmpdir(), 'covi-wfr-'));
  dirs.push(work);
  const event = join(work, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({
      workflow_run: {
        event: 'pull_request',
        head_sha: head,
        head_branch: 'design/pricing-refresh',
        head_repository: { owner: { login: 'forker' }, full_name: 'forker/shop' },
        html_url: 'https://github.example/acme/shop/actions/runs/1001',
        pull_requests: [],
      },
    }),
  );
  const env = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_run',
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: 'acme/shop',
    GITHUB_RUN_ID: '2002',
    GITHUB_SERVER_URL: 'https://github.example',
    GITHUB_API_URL: api.url,
    GITHUB_TOKEN: 'write-token',
  };
  return { event, env };
}

describe('GitHub Actions', () => {
  it('reviews the pull request, annotates the diff, and writes step outputs and the job summary', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const gh = githubEnv(repo);
    const result = covi(
      ['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'],
      { env: gh.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^::warning file=pricing\.css,title=Covi · Likely issue%3A Focus outline removed in pricing\.css,line=\d+::/m,
    );
    const outputs = readFileSync(gh.output, 'utf8');
    expect(outputs).toContain('verdict=needs-attention');
    expect(outputs).toContain(`run-dir=${gh.out}`);
    expect(readFileSync(gh.summary, 'utf8')).toContain('# Review:');
    const sarif = JSON.parse(readFileSync(join(gh.out, 'reports/covi.sarif'), 'utf8')) as {
      runs: Array<{ results: unknown[] }>;
    };
    expect(sarif.runs[0]!.results).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(gh.out, 'run.json'), 'utf8')) as {
      entryPoint: string;
      change: { source: { kind: string; number: number } };
    };
    expect(manifest.entryPoint).toBe('github-action');
    expect(manifest.change.source).toMatchObject({ kind: 'pull-request', number: 7 });
  });

  it('fails the gate (exit 1) and still writes every artifact', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const gh = githubEnv(repo);
    const result = covi(
      [
        'ci',
        '--repo',
        repo.dir,
        '--out',
        gh.out,
        '--video',
        'never',
        '--no-comment',
        '--fail-on',
        'medium',
      ],
      { env: gh.env },
    );
    expect(result.code).toBe(1);
    expect(readFileSync(join(gh.out, 'review.md'), 'utf8')).toContain('Focus outline removed');
  });

  it('publishes one comment, updates it on the next run, and escapes untrusted text', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const gh = githubEnv(repo, { GITHUB_TOKEN: 'test-token' });
    covi(['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'], {
      env: gh.env,
    });
    const before = api.comments.length;
    const first = await coviAsync(
      [
        'publish',
        '--repo',
        repo.dir,
        '--run',
        gh.out,
        '--artifact-url',
        'https://github.example/acme/shop/actions/runs/1001/artifacts/9',
        '--json',
      ],
      { env: gh.env },
    );
    expect(first.code).toBe(0);
    expect(api.comments.length).toBe(before + 1);
    const body = api.comments.at(-1)!.body;
    expect(body).toContain('<!-- covi:review -->');
    expect(body).toContain('Needs attention');
    expect(body).toContain(
      '[artifacts](https://github.example/acme/shop/actions/runs/1001/artifacts/9)',
    );
    const post = api.calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/repos/acme/shop/issues/7/comments');
    expect(post.headers.authorization).toBe('Bearer test-token');
    const second = await coviAsync(['publish', '--repo', repo.dir, '--run', gh.out, '--json'], {
      env: gh.env,
    });
    expect((second.json() as { data: { publish: { status: string } } }).data.publish.status).toBe(
      'updated',
    );
    expect(api.comments.length).toBe(before + 1);
  });

  it('refuses to publish a run for a different head commit', async () => {
    const repo = await prRepo('refactor-retry-helper');
    const gh = githubEnv(repo, { GITHUB_TOKEN: 'test-token' });
    covi(['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'], {
      env: gh.env,
    });
    const result = covi(
      [
        'publish',
        '--repo',
        repo.dir,
        '--run',
        gh.out,
        '--number',
        '7',
        '--expect-head',
        'deadbeefdeadbeef',
      ],
      { env: gh.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/refusing to publish/);
  });

  it('runs no project command under pull_request_target, where secrets are present', async () => {
    const repo = await prRepo('bugfix-cli-slugify');
    const marker = join(repo.dir, '..', `${repo.dir.split('/').pop()}-ran.txt`);
    dirs.push(marker);
    const mark = (label: string) =>
      `node -e "require('fs').appendFileSync('${marker}', '${label}\\n')"`;
    // The maintainers' own configuration (base revision) asks for a demo command and tests.
    repo.git('checkout', '-q', 'main');
    writeFileSync(
      join(repo.dir, '.covi/config.yml'),
      [
        'demo:',
        '  commands:',
        '    - name: mark',
        `      run: ${JSON.stringify(mark('demo'))}`,
        'review:',
        '  runTests: true',
        'test:',
        `  command: ${JSON.stringify(mark('test'))}`,
        'intelligence:',
        `  command: ${JSON.stringify(mark('agent'))}`,
        '',
      ].join('\n'),
    );
    repo.git('commit', '-qam', 'chore: demo and test commands');
    repo.git('checkout', '-q', 'fix/slugify-accents');
    repo.git('rebase', '-q', 'main');
    const shas = { base: repo.git('rev-parse', 'main'), head: repo.git('rev-parse', 'HEAD') };
    const ran = () => (existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n') : []);

    const target = githubEnv(shas, { GITHUB_EVENT_NAME: 'pull_request_target' });
    const result = covi(
      ['ci', '--repo', repo.dir, '--out', target.out, '--no-comment', '--video', 'never', '--json'],
      { env: target.env },
    );
    expect(result.code).toBe(0);
    expect(ran()).toEqual([]);
    const captures = JSON.parse(readFileSync(join(target.out, 'demo/captures.json'), 'utf8')) as {
      skipped: Array<{ what: string; reason: string }>;
    };
    expect(captures.skipped).toContainEqual({
      what: 'command "mark"',
      reason: expect.stringMatching(/pull_request_target/),
    });
    const review = JSON.parse(readFileSync(join(target.out, 'review.json'), 'utf8')) as {
      notVerified: string[];
    };
    expect(review.notVerified.join('\n')).toMatch(/Tests were not run: .*pull_request_target/);
    // The agent CLI would read the untrusted diff while holding the job's secrets: not run either.
    const warnings = (result.json() as { warnings: string[] }).warnings.join('\n');
    expect(warnings).toMatch(/intelligence\.command was not run/);

    // The same configuration under pull_request does run them, so the check above is meaningful.
    const plain = githubEnv(shas);
    covi(['ci', '--repo', repo.dir, '--out', plain.out, '--no-comment', '--video', 'never'], {
      env: plain.env,
    });
    expect(ran()).toEqual(expect.arrayContaining(['demo', 'test', 'agent']));
  });

  it('comments on a fork pull request from a workflow_run, trusting only the event', async () => {
    const repo = await prRepo('visual-pricing-cards');
    // 1. The unprivileged pull_request run (from a fork) reviews and uploads its run directory.
    const review = githubEnv(repo);
    covi(['ci', '--repo', repo.dir, '--out', review.out, '--video', 'never', '--no-comment'], {
      env: review.env,
    });
    // 2. The privileged workflow_run: GitHub omits fork pull requests from the payload.
    const { event, env } = workflowRun(repo.head);
    api.comments.length = 0; // a pull request without an earlier Covi comment
    api.pulls.length = 0;
    api.pulls.push(
      { number: 3, owner: 'someone', branch: 'design/pricing-refresh', sha: repo.head },
      { number: 7, owner: 'forker', branch: 'design/pricing-refresh', sha: repo.head },
    );
    const posted = api.comments.length;
    const ok = await coviAsync(['publish', '--repo', repo.dir, '--run', review.out, '--json'], {
      env,
    });
    expect(ok.code).toBe(0);
    expect(api.calls.at(-1)!.url).toBe('/repos/acme/shop/issues/7/comments');
    const body = api.comments.at(-1)!.body;
    expect(api.comments.length).toBe(posted + 1);
    // Links point at the run that reviewed the change, where its artifacts are.
    expect(body).toContain('[run](https://github.example/acme/shop/actions/runs/1001)');

    // The pull request moved on after the review: skip, the newer run will comment.
    api.pulls[1]!.sha = 'f'.repeat(40);
    const publish = async () =>
      (
        (
          await coviAsync(['publish', '--repo', repo.dir, '--run', review.out, '--json'], { env })
        ).json() as { data: { publish: { status: string; reason: string } } }
      ).data.publish;
    expect(await publish()).toMatchObject({
      status: 'skipped',
      reason: expect.stringMatching(/no open pull request has head/),
    });
    // Same for a pull request the event names directly (branches in the same repository).
    const named = JSON.parse(readFileSync(event, 'utf8')) as {
      workflow_run: { pull_requests: Array<{ number: number }> };
    };
    named.workflow_run.pull_requests = [{ number: 7 }];
    writeFileSync(event, JSON.stringify(named));
    expect(await publish()).toMatchObject({
      status: 'skipped',
      reason: expect.stringMatching(/#7 now points at fffffff/),
    });
    expect(api.comments.length).toBe(posted + 1);

    // An artifact that reviewed some other commit is refused outright.
    writeFileSync(
      event,
      JSON.stringify({
        workflow_run: {
          head_sha: 'e'.repeat(40),
          head_branch: 'design/pricing-refresh',
          head_repository: { owner: { login: 'forker' } },
          pull_requests: [],
        },
      }),
    );
    const forged = covi(['publish', '--repo', repo.dir, '--run', review.out], { env });
    expect(forged.code).toBe(2);
    expect(forged.stderr).toMatch(/refusing to publish/);
  });

  it('skips the comment gracefully without a token', async () => {
    const repo = await prRepo('refactor-retry-helper');
    const gh = githubEnv(repo);
    const result = covi(
      ['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--comment', '--json'],
      { env: { ...gh.env, GITHUB_TOKEN: '' } },
    );
    expect(result.code).toBe(0);
    expect(
      (result.json() as { data: { publish: { status: string; reason: string } } }).data.publish,
    ).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/no GitHub token/) });
  });

  it('reads configuration from the base revision so a change cannot disable its own gate', async () => {
    const repo = await prRepo('visual-pricing-cards');
    // The base requires a gate; the pull request tries to switch it off.
    repo.git('checkout', '-q', 'main');
    writeFileSync(
      join(repo.dir, '.covi/config.yml'),
      'app:\n  static: .\nreview:\n  failOn: medium\n',
    );
    repo.git('commit', '-qam', 'chore: require review gate');
    repo.git('checkout', '-q', 'design/pricing-refresh');
    repo.git('rebase', '-q', 'main');
    writeFileSync(
      join(repo.dir, '.covi/config.yml'),
      'app:\n  static: .\nreview:\n  failOn: none\n',
    );
    repo.git('commit', '-qam', 'chore: relax review');
    const gh = githubEnv({
      base: repo.git('rev-parse', 'main'),
      head: repo.git('rev-parse', 'HEAD'),
    });
    const result = covi(
      ['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'],
      { env: gh.env },
    );
    expect(result.code).toBe(1);
    const manifest = JSON.parse(readFileSync(join(gh.out, 'run.json'), 'utf8')) as {
      config: { provenance: Record<string, string> };
    };
    expect(manifest.config.provenance['review.failOn']).toMatch(
      /^repository \(\.covi\/config\.yml@\w{7} \(base\)\)$/,
    );
  });
  it.skipIf(!browser)(
    'demonstrates with the subject model, and keeps what it saw in the run, never in the checkout',
    async () => {
      const repo = await prRepo('visual-pricing-cards');
      const gh = githubEnv(repo);
      const result = covi(
        ['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment', '--json'],
        { env: gh.env },
      );
      // Annotations go to stdout first in GitHub Actions; the result follows them.
      const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('\n{') + 1)) as {
        artifacts: Record<string, string>;
      };
      expect(json.artifacts.subject).toBe(join(gh.out, 'demo/subject.json'));
      const snapshot = JSON.parse(readFileSync(join(gh.out, 'demo/subject.json'), 'utf8')) as {
        store: string;
        model: { screens: Array<{ key: string }> };
      };
      expect(snapshot.store).toBe('repo');
      expect(snapshot.model.screens.map((s) => s.key)).toContain('home');
      // In CI the repository's model is read from base and never written: the checkout is thrown away.
      expect(existsSync(join(repo.dir, '.covi/subject/subject.json'))).toBe(false);
    },
  );

  it('reads an explicit --config inside the repository from the base revision too', async () => {
    const repo = await prRepo('visual-pricing-cards');
    repo.git('checkout', '-q', 'main');
    writeFileSync(join(repo.dir, 'covi-ci.yml'), 'app:\n  static: .\nreview:\n  failOn: medium\n');
    repo.git('add', 'covi-ci.yml');
    repo.git('commit', '-qm', 'chore: CI review settings');
    repo.git('checkout', '-q', 'design/pricing-refresh');
    repo.git('rebase', '-q', 'main');
    writeFileSync(join(repo.dir, 'covi-ci.yml'), 'review:\n  failOn: none\n');
    repo.git('commit', '-qam', 'chore: relax CI review');
    const gh = githubEnv({
      base: repo.git('rev-parse', 'main'),
      head: repo.git('rev-parse', 'HEAD'),
    });
    const gated = covi(
      [
        '--config',
        join(repo.dir, 'covi-ci.yml'),
        'ci',
        '--repo',
        repo.dir,
        '--out',
        gh.out,
        '--video',
        'never',
        '--no-comment',
      ],
      { env: gh.env },
    );
    expect(gated.code).toBe(1);

    // A file outside the checkout belongs to the workflow, not the change: read it from disk.
    const outside = join(mkdtempSync(join(tmpdir(), 'covi-cfg-')), 'covi.yml');
    dirs.push(outside);
    writeFileSync(outside, 'review:\n  failOn: none\n');
    const other = githubEnv({
      base: repo.git('rev-parse', 'main'),
      head: repo.git('rev-parse', 'HEAD'),
    });
    const relaxed = covi(
      [
        '--config',
        outside,
        'ci',
        '--repo',
        repo.dir,
        '--out',
        other.out,
        '--video',
        'never',
        '--no-comment',
      ],
      { env: other.env },
    );
    expect(relaxed.code).toBe(0);
  });

  it('carries the outcome ledger across pushes and records where it published', async () => {
    // Earlier tests left marker comments; this one needs a pull request of its own.
    api.comments.splice(0);
    const repo = await prRepo('visual-pricing-cards');
    // Anyone can paste the marker and a ledger: only Covi's own comment carries history.
    const forged = renderLedger({
      v: 1,
      run: '20260101-000000-ci-0000000',
      head: '0000000',
      findings: [
        { k: 'f'.repeat(12), c: 'confirmed', a: 'f'.repeat(8), f: '0000000', l: '0000000' },
      ],
    });
    api.comments.push({
      id: 1,
      body: `${COMMENT_MARKER}\npasted\n${forged}`,
      user: { login: 'mallory', id: 666, type: 'User' },
      author: { id: 666, username: 'mallory' },
      created_at: '2026-10-01T08:00:00Z',
      reactions: { '+1': 0, '-1': 0 },
    });
    const gh = githubEnv(repo, { GITHUB_TOKEN: 'test-token' });
    covi(['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'], {
      env: gh.env,
    });
    const first = await coviAsync(['publish', '--repo', repo.dir, '--run', gh.out, '--json'], {
      env: gh.env,
    });
    expect(first.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(gh.out, 'run.json'), 'utf8')) as {
      runId: string;
      publish: PublishRecord;
    };
    expect(manifest.publish).toMatchObject({
      platform: 'github',
      repository: 'acme/shop',
      number: 7,
    });
    expect(manifest.publish.comment.id).not.toBe('1');
    expect(api.comments[0]!.body).toContain(forged);
    const comment = api.comments.find((c) => String(c.id) === manifest.publish.comment.id)!;
    expect(comment.body).toContain('Was this useful? 👍 👎 (react to this comment)');
    const ledger = parseLedger(comment.body)!;
    expect(ledger).toMatchObject({ run: manifest.runId, head: repo.head.slice(0, 7) });
    expect(ledger.findings.map((e) => e.k)).not.toContain('f'.repeat(12));
    // The focus outline rule's likely finding, at least.
    expect(ledger.findings.some((e) => e.c === 'likely')).toBe(true);

    // A push: the next run's comment keeps the history, so first sightings stay put.
    repo.git('commit', '--allow-empty', '-qm', 'chore: nudge');
    const pushed = githubEnv(
      { base: repo.base, head: repo.git('rev-parse', 'HEAD') },
      { GITHUB_TOKEN: 'test-token' },
    );
    covi(['ci', '--repo', repo.dir, '--out', pushed.out, '--video', 'never', '--no-comment'], {
      env: pushed.env,
    });
    await coviAsync(['publish', '--repo', repo.dir, '--run', pushed.out, '--json'], {
      env: pushed.env,
    });
    const next = parseLedger(comment.body)!;
    expect(next.head).not.toBe(ledger.head);
    expect(next.findings.map((e) => [e.k, e.f])).toEqual(ledger.findings.map((e) => [e.k, e.f]));
    api.comments.splice(0);
  });

  it('posts finding anchors once, and only when asked to', async () => {
    api.comments.splice(0);
    api.reviewComments.splice(0);
    const repo = await prRepo('visual-pricing-cards');
    const gh = githubEnv(repo, { GITHUB_TOKEN: 'test-token' });
    covi(['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'], {
      env: gh.env,
    });
    await coviAsync(['publish', '--repo', repo.dir, '--run', gh.out, '--json'], { env: gh.env });
    expect(api.reviewComments).toHaveLength(0);

    const asked = githubEnv(repo, { GITHUB_TOKEN: 'test-token' });
    covi(
      [
        'ci',
        '--repo',
        repo.dir,
        '--out',
        asked.out,
        '--video',
        'never',
        '--no-comment',
        '--anchors',
      ],
      { env: asked.env },
    );
    const first = await coviAsync(['publish', '--repo', repo.dir, '--run', asked.out, '--json'], {
      env: asked.env,
    });
    const anchors = (first.json() as { data: { publish: { anchors: { posted: unknown[] } } } }).data
      .publish.anchors;
    expect(anchors.posted.length).toBeGreaterThan(0);
    expect(api.reviewComments).toHaveLength(anchors.posted.length);
    expect(api.reviewComments[0]).toMatchObject({ commit_id: repo.head, side: 'RIGHT' });
    expect(api.reviewComments[0]!.body).toMatch(/^<!-- covi:finding [0-9a-f]{12} -->/);
    await coviAsync(['publish', '--repo', repo.dir, '--run', asked.out, '--json'], {
      env: asked.env,
    });
    expect(api.reviewComments).toHaveLength(anchors.posted.length);
    api.comments.splice(0);
    api.reviewComments.splice(0);
  });

  it("recognizes its comment by the base revision's bot login", async () => {
    const repo = await prRepo('visual-pricing-cards');
    repo.git('checkout', '-q', 'main');
    writeFileSync(
      join(repo.dir, '.covi/config.yml'),
      'app:\n  static: .\npublish:\n  botLogin: covi-app[bot]\n',
    );
    repo.git('commit', '-qam', 'chore: Covi comments as its own app');
    repo.git('checkout', '-q', 'design/pricing-refresh');
    repo.git('rebase', '-q', 'main');
    api.comments.splice(0);
    api.comments.push({
      id: 1,
      body: `${COMMENT_MARKER}\nan earlier review`,
      user: { login: 'covi-app[bot]', id: 77, type: 'Bot' },
      author: { id: 77, username: 'covi-app' },
      created_at: '2026-10-01T08:00:00Z',
      reactions: { '+1': 0, '-1': 0 },
    });
    const gh = githubEnv(
      { base: repo.git('rev-parse', 'main'), head: repo.git('rev-parse', 'HEAD') },
      { GITHUB_TOKEN: 'app-token' },
    );
    const status = (result: { json: () => unknown }) =>
      (result.json() as { data: { publish: { status: string; id: string } } }).data.publish;
    const ci = await coviAsync(
      [
        'ci',
        '--repo',
        repo.dir,
        '--out',
        gh.out,
        '--video',
        'never',
        '--no-annotations',
        '--comment',
        '--json',
      ],
      { env: gh.env },
    );
    expect(status(ci)).toMatchObject({ status: 'updated', id: '1' });
    const published = await coviAsync(['publish', '--repo', repo.dir, '--run', gh.out, '--json'], {
      env: gh.env,
    });
    expect(status(published)).toMatchObject({ status: 'updated', id: '1' });
    expect(api.comments).toHaveLength(1);
    api.comments.splice(0);
  });

  it('takes nothing but the review from a workflow_run artifact: no ledger, no anchors, no bot', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const review = githubEnv(repo);
    covi(['ci', '--repo', repo.dir, '--out', review.out, '--video', 'never', '--no-comment'], {
      env: review.env,
    });
    // The fork controls everything in its artifact, run.json's configuration included.
    const manifestPath = join(review.out, 'run.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      config: { values: { publish: Record<string, unknown> } };
    };
    Object.assign(manifest.config.values.publish, {
      anchors: true,
      rating: false,
      botLogin: 'evil[bot]',
    });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const { env } = workflowRun(repo.head);
    api.comments.splice(0);
    api.reviewComments.splice(0);
    api.pulls.splice(0);
    api.pulls.push({
      number: 7,
      owner: 'forker',
      branch: 'design/pricing-refresh',
      sha: repo.head,
    });
    api.comments.push({
      id: 1,
      body: `${COMMENT_MARKER}\nwhat evil[bot] says`,
      user: { login: 'evil[bot]', id: 13, type: 'Bot' },
      author: { id: 13, username: 'evil' },
      created_at: '2026-10-01T08:00:00Z',
      reactions: { '+1': 0, '-1': 0 },
    });
    const publish = async (...flags: string[]) =>
      (
        (
          await coviAsync(
            ['publish', '--repo', repo.dir, '--run', review.out, '--json', ...flags],
            {
              env,
            },
          )
        ).json() as { data: { publish: { status: string; id: string; anchors?: unknown } } }
      ).data.publish;

    const first = await publish();
    expect(first).toMatchObject({ status: 'created', id: '2' });
    expect(first.anchors).toBeUndefined();
    expect(api.comments[0]!.body).toBe(`${COMMENT_MARKER}\nwhat evil[bot] says`);
    const body = api.comments[1]!.body;
    // The collector skips a change without a ledger; an artifact's review must not write one.
    expect(parseLedger(body)).toBeUndefined();
    expect(body).not.toContain('covi:ledger');
    expect(body).toContain('Was this useful? 👍 👎 (react to this comment)');
    expect(api.reviewComments).toHaveLength(0);

    // The workflow's own flags still apply.
    const flagged = await publish('--anchors', '--no-rating');
    expect(flagged).toMatchObject({ status: 'updated', id: '2' });
    expect(api.reviewComments.length).toBeGreaterThan(0);
    expect(api.comments[1]!.body).not.toContain('Was this useful?');
    expect(api.comments[1]!.body).not.toContain('covi:ledger');

    // What a trusted run (a branch in this repository) wrote stays exactly as it was.
    const trusted = renderLedger({
      v: 1,
      run: '20261001-090000-ci-abcdef1',
      head: 'abcdef1',
      findings: [{ k: 'a'.repeat(12), c: 'likely', a: 'a'.repeat(8), f: 'abcdef1', l: 'abcdef1' }],
    });
    api.comments[1]!.body += `\n${trusted}`;
    expect(await publish()).toMatchObject({ status: 'updated', id: '2' });
    expect(api.comments[1]!.body.trimEnd().endsWith(trusted)).toBe(true);
    api.comments.splice(0);
    api.reviewComments.splice(0);
  });
});

function gitlabEnv(repo: { base: string; head: string }): NodeJS.ProcessEnv {
  return {
    CI: 'true',
    GITLAB_CI: 'true',
    CI_PIPELINE_SOURCE: 'merge_request_event',
    CI_MERGE_REQUEST_IID: '12',
    CI_MERGE_REQUEST_DIFF_BASE_SHA: repo.base,
    CI_COMMIT_SHA: repo.head,
    CI_MERGE_REQUEST_TITLE: 'Refresh the pricing cards',
    CI_MERGE_REQUEST_PROJECT_ID: '5',
    CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '5',
    CI_PROJECT_ID: '5',
    CI_API_V4_URL: `${api.url}/api/v4`,
    CI_JOB_URL: 'https://gitlab.example/acme/shop/-/jobs/9',
    COVI_GITLAB_TOKEN: `glpat-test-token-${'0'.repeat(10)}`,
  };
}

describe('GitLab CI', () => {
  it('reviews the merge request, writes Code Quality and dotenv reports, and posts a note', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const out = join(mkdtempSync(join(tmpdir(), 'covi-gl-')), 'run');
    dirs.push(out);
    const env = gitlabEnv(repo);
    api.comments.length = 0; // a fresh merge request: no earlier Covi note
    const before = api.comments.length;
    const result = await coviAsync(
      ['ci', '--repo', repo.dir, '--out', out, '--video', 'never', '--comment', '--json'],
      { env },
    );
    expect(result.code).toBe(0);
    const quality = JSON.parse(
      readFileSync(join(out, 'reports/gl-code-quality-report.json'), 'utf8'),
    ) as Array<{ check_name: string; location: { path: string } }>;
    expect(quality).toEqual([
      expect.objectContaining({
        check_name: 'focus-outline-removed',
        location: expect.objectContaining({ path: 'pricing.css' }),
      }),
    ]);
    expect(readFileSync(join(out, 'reports/covi.env'), 'utf8')).toContain(
      'COVI_VERDICT=needs-attention',
    );
    expect(api.comments.length).toBe(before + 1);
    const note = api.calls.filter((c) => c.method === 'POST').at(-1)!;
    expect(note.url).toBe('/api/v4/projects/5/merge_requests/12/notes');
    expect(note.headers['private-token']).toBe(`glpat-test-token-${'0'.repeat(10)}`);
    expect(readFileSync(join(out, 'run.json'), 'utf8')).not.toContain('glpat-test-token');
  });
  it('links the video and cited captures to the job artifacts of a run inside the project', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const reviewed = covi(['review', '--repo', repo.dir, '--json']);
    expect(reviewed.code).toBe(0);
    const runDir = reviewed.json().runDir as string;
    // A rendered video and a captured screenshot, as a CI run with a demonstration leaves them.
    // Both are synthetic (no browser or ffmpeg needed); the item's sha256 is a placeholder.
    const run = await Run.open(runDir, { root: repo.dir });
    await run.writeText('video/covi-review.mp4', 'mp4', 'video');
    await run.writeText('demo/screenshots/pricing-desktop-after.png', 'png', 'capture');
    await run.save();
    const evidence = JSON.parse(readFileSync(join(runDir, 'evidence.json'), 'utf8')) as {
      items: unknown[];
    };
    evidence.items.push({
      id: 'screenshot:pricing-desktop-after',
      kind: 'screenshot',
      path: 'demo/screenshots/pricing-desktop-after.png',
      revision: 'head',
      sha256: '0'.repeat(64),
      label: 'pricing (desktop) · head',
    });
    writeFileSync(join(runDir, 'evidence.json'), JSON.stringify(evidence));
    const review = JSON.parse(readFileSync(join(runDir, 'review.json'), 'utf8')) as {
      findings: Array<{ evidenceIds?: string[] }>;
    };
    review.findings[0]!.evidenceIds = [
      ...(review.findings[0]!.evidenceIds ?? []),
      'screenshot:pricing-desktop-after',
    ];
    writeFileSync(join(runDir, 'review.json'), JSON.stringify(review));

    api.comments.length = 0;
    const published = await coviAsync(
      ['publish', '--repo', repo.dir, '--run', runDir, '--platform', 'gitlab', '--json'],
      // The project directory as the run sees it (temporary directories may be symlinked).
      { env: { ...gitlabEnv(repo), CI_PROJECT_DIR: join(runDir, '..', '..', '..') } },
    );
    expect(published.code).toBe(0);
    const files = `https://gitlab.example/acme/shop/-/jobs/9/artifacts/file/.covi/runs/${run.id}/`;
    const body = api.comments.at(-1)!.body;
    expect(body).toContain(`(${files}video/covi-review.mp4)`);
    expect(body).toContain(
      `[\`pricing-desktop-after.png\`](${files}demo/screenshots/pricing-desktop-after.png)`,
    );
    // Hunks are named, not linked: the comment sits next to the diff.
    expect(body).toMatch(/Cited evidence: `pricing\.css:\d+(-\d+)?`/);
  });
  it('leaves the Code Quality report empty with --no-annotations', async () => {
    const repo = await prRepo('visual-pricing-cards');
    const out = join(mkdtempSync(join(tmpdir(), 'covi-gl-')), 'run');
    dirs.push(out);
    const result = await coviAsync(
      [
        'ci',
        '--repo',
        repo.dir,
        '--out',
        out,
        '--video',
        'never',
        '--no-comment',
        '--no-annotations',
      ],
      { env: { ...gitlabEnv(repo), COVI_GITLAB_TOKEN: '' } },
    );
    expect(result.code).toBe(0);
    expect(
      JSON.parse(readFileSync(join(out, 'reports/gl-code-quality-report.json'), 'utf8')),
    ).toEqual([]);
  });
});
