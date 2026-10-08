import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Run } from '@covi/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { covi, coviAsync } from './helpers/cli.ts';
import { canUseBrowser } from './helpers/env.ts';
import { GIT_ENV } from './helpers/repo.ts';

interface Recorded {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** A local stand-in for the GitHub and GitLab REST APIs. */
function mockApi(): Promise<{
  url: string;
  calls: Recorded[];
  server: Server;
  comments: Array<{ id: number; body: string }>;
  pulls: Array<{ number: number; owner: string; branch: string; sha: string }>;
}> {
  const calls: Recorded[] = [];
  const comments: Array<{ id: number; body: string }> = [];
  const pulls: Array<{ number: number; owner: string; branch: string; sha: string }> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, body, headers: req.headers });
      const json = (status: number, value: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      const url = new URL(req.url!, 'http://api');
      const pull = /^\/repos\/acme\/shop\/pulls(?:\/(\d+))?$/.exec(url.pathname);
      if (req.method === 'GET' && pull) {
        const shape = (p: (typeof pulls)[number]) => ({ number: p.number, head: { sha: p.sha } });
        if (pull[1]) {
          const found = pulls.find((p) => p.number === Number(pull[1]));
          return found ? json(200, shape(found)) : json(404, { message: 'not found' });
        }
        const head = url.searchParams.get('head');
        return json(
          200,
          pulls.filter((p) => !head || head === `${p.owner}:${p.branch}`).map(shape),
        );
      }
      if (req.method === 'GET' && /\/(comments|notes)/.test(req.url!))
        return json(
          200,
          comments.map((c) => ({
            ...c,
            html_url: `https://example.test/c/${c.id}`,
            system: false,
          })),
        );
      if (req.method === 'POST' && /\/(comments|notes)/.test(req.url!)) {
        const id = comments.length + 1;
        comments.push({ id, body: (JSON.parse(body) as { body: string }).body });
        return json(201, { id, html_url: `https://example.test/c/${id}` });
      }
      if (
        (req.method === 'PATCH' || req.method === 'PUT') &&
        /\/(comments|notes)\/\d+/.test(req.url!)
      ) {
        const id = Number(/(\d+)$/.exec(req.url!)![1]);
        comments[id - 1]!.body = (JSON.parse(body) as { body: string }).body;
        return json(200, { id, html_url: `https://example.test/c/${id}` });
      }
      json(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        calls,
        server,
        comments,
        pulls,
      }),
    ),
  );
}

const dirs: string[] = [];
let api: Awaited<ReturnType<typeof mockApi>>;
beforeAll(async () => {
  api = await mockApi();
});
afterAll(() => {
  api.server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const examples = await listExamples();
const browser = await canUseBrowser();
async function prRepo(name: string) {
  const dir = await materializeExample(examples.find((e) => e.name === name)!);
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
  return { dir, base: git('rev-parse', 'main'), head: git('rev-parse', 'HEAD'), git };
}

function githubEnv(repo: { base: string; head: string }, extra: NodeJS.ProcessEnv = {}) {
  const work = mkdtempSync(join(tmpdir(), 'covi-gha-'));
  dirs.push(work);
  const event = join(work, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: {
        number: 7,
        title: 'style(pricing): refresh plan cards and highlight the popular plan',
        body: 'Adds a popular badge. @everyone <script>alert(1)</script>',
        html_url: 'https://github.example/acme/shop/pull/7',
        base: { sha: repo.base, ref: 'main', repo: { full_name: 'acme/shop' } },
        head: { sha: repo.head, ref: 'design/pricing-refresh', repo: { full_name: 'acme/shop' } },
      },
    }),
  );
  const output = join(work, 'output');
  const summary = join(work, 'summary.md');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  return {
    env: {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_RUN_ID: '1001',
      GITHUB_SERVER_URL: 'https://github.example',
      GITHUB_API_URL: api.url,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...extra,
    },
    output,
    summary,
    out: join(work, 'run'),
  };
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
    const work = mkdtempSync(join(tmpdir(), 'covi-wfr-'));
    dirs.push(work);
    const event = join(work, 'event.json');
    writeFileSync(
      event,
      JSON.stringify({
        workflow_run: {
          event: 'pull_request',
          head_sha: repo.head,
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
