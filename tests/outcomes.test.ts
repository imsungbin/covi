import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { collectorIdentity } from '../packages/cli/src/outcomes.ts';
import { OutcomeFileSchema } from '../packages/core/src/model/outcome.ts';
import type { OutcomeReport } from '../packages/core/src/outcomes/precision.ts';
import { writeOutcome } from '../packages/core/src/outcomes/store.ts';
import { Redactor } from '../packages/core/src/security/redact.ts';
import { covi, coviAsync } from './helpers/cli.ts';
import { BOT, githubEnv, type MockApi, mockApi, prRepo } from './helpers/mock-api.ts';
import { outcomeFile } from './helpers/outcomes.ts';
import { GIT_ENV } from './helpers/repo.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const examples = await listExamples();
/** An example change in a repository whose remote names it acme/shop. */
async function example(name: string): Promise<string> {
  const dir = await materializeExample(examples.find((e) => e.name === name)!);
  dirs.push(dir);
  git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  return dir;
}
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
/** A file outside the repository: configuration and stand-ins belong to the user. */
function outside(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'covi-outcomes-cli-'));
  dirs.push(dir);
  writeFileSync(join(dir, name), text);
  return join(dir, name);
}

/** Five likely findings with a signal: four fixed after Covi pointed at them, one merged as is. */
const heldUp = (over: { number?: number; repository?: string; runId?: string } = {}) =>
  outcomeFile({
    number: 3,
    ...over,
    findings: [
      { fate: 'addressed' },
      { fate: 'addressed' },
      { fate: 'addressed' },
      { fate: 'addressed' },
      {},
    ],
  });

describe('calibration', () => {
  it('puts how past findings held up in the brief, except from outcomes committed to the repository', async () => {
    const dir = await example('refactor-retry-helper');
    await writeOutcome(dir, heldUp(), new Redactor());
    // Another repository's outcomes say nothing about this one.
    await writeOutcome(dir, heldUp({ number: 4, repository: 'acme/other' }), new Redactor());
    type Analyzed = {
      artifacts: { brief: string };
      data: { calibration: unknown; ruleFindings: unknown };
      warnings: string[];
    };
    const first = covi(['analyze', '--repo', dir, '--json']);
    expect(first.code).toBe(0);
    const result = first.json() as Analyzed;
    expect(result.data.calibration).toEqual({
      changes: 1,
      lines: [{ certainty: 'likely', right: 4, labeled: 5, percent: 80 }],
    });
    expect(readFileSync(result.artifacts.brief, 'utf8')).toContain(
      '- Likely issue: 4 of 5 held up (80%)',
    );

    // Turned off, there is no hint, and the rules report the same findings.
    const off = outside('covi.yml', 'review:\n  calibration: false\n');
    const quiet = covi(['--config', off, 'analyze', '--repo', dir, '--json']).json() as Analyzed;
    expect(quiet.data.calibration).toBeNull();
    expect(quiet.data.ruleFindings).toEqual(result.data.ruleFindings);

    git(dir, 'add', '-f', '.covi/outcomes');
    git(dir, 'commit', '-qm', 'chore: commit outcomes');
    const again = covi(['analyze', '--repo', dir, '--json']).json() as Analyzed;
    expect(again.data.calibration).toBeNull();
    expect(readFileSync(again.artifacts.brief, 'utf8')).not.toContain('How past findings held up');
    expect(again.warnings.join('\n')).toMatch(/committed to the repository/);
  });

  it('reads outcomes before any project command runs, so a demo cannot plant them', async () => {
    const dir = await example('bugfix-cli-slugify');
    const planted = outside('outcome.json', `${JSON.stringify(heldUp(), null, 2)}\n`);
    const target = join(dir, '.covi/outcomes/20261009-120003-ci-aaaaaaa.json');
    const prompts = outside('prompts.txt', '');
    const answer = {
      explanation: {
        depth: 'brief',
        headline: 'Slugify',
        summary: 's',
        intent: { statement: 's', confidence: 'high' },
      },
      review: {
        findings: [
          {
            title: 'Slugs keep a trailing dash',
            certainty: 'likely',
            severity: 'low',
            category: 'correctness',
            location: { path: 'src/slugify.js', line: 1 },
            evidence: 'slugify',
            explanation: 'The trim no longer runs.',
          },
        ],
      },
    };
    // A stand-in for an agent CLI: keeps each prompt, answers with a fixed analysis.
    const model = outside(
      'model.cjs',
      `const fs=require('fs');let s='';process.stdin.on('data',(d)=>{s+=d});process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(prompts)},s+'\\u0000');process.stdout.write(${JSON.stringify(JSON.stringify(answer))})});`,
    );
    // The demo's command is the project's code, and it writes an outcome file.
    const plant = `node -e ${JSON.stringify(`const fs=require('fs');fs.mkdirSync(${JSON.stringify(join(dir, '.covi/outcomes'))},{recursive:true});fs.copyFileSync(${JSON.stringify(planted)},${JSON.stringify(target)})`)}`;
    const config = outside(
      'covi.yml',
      [
        'intelligence:',
        '  provider: command',
        `  command: ${JSON.stringify(`node ${model}`)}`,
        'demo:',
        '  commands:',
        `    - { name: plant, run: ${JSON.stringify(plant)}, compare: false }`,
        '',
      ].join('\n'),
    );
    type Reviewed = { runDir: string };
    const review = () => {
      const run = covi(['--config', config, 'review', '--demo', '--repo', dir, '--json']);
      expect(run.code).toBe(0);
      return (run.json() as Reviewed).runDir;
    };
    const certainties = (runDir: string) =>
      (
        JSON.parse(readFileSync(join(runDir, 'findings.json'), 'utf8')) as {
          findings: Array<{ title: string; certainty: string }>;
        }
      ).findings.map((f) => [f.title, f.certainty]);

    const firstRun = review();
    expect(existsSync(target)).toBe(true);
    const second = review();
    const [before, after] = readFileSync(prompts, 'utf8').split('\u0000');
    // Planted during the first run's demo: that run's model never saw it; the next run's did.
    expect(before).not.toContain('How past findings held up');
    expect(after).toContain('- Likely issue: 4 of 5 held up (80%)');
    // The hint is material, not a verdict: the reported certainties are the same.
    expect(certainties(second)).toEqual(certainties(firstRun));
  });
});

describe('covi outcomes', () => {
  let api: MockApi;
  let repo: Awaited<ReturnType<typeof prRepo>>;
  let gh: ReturnType<typeof githubEnv>;
  let runId: string;
  type Report = { data: OutcomeReport & { summary: string }; warnings: string[] };
  type Collected = {
    data: {
      repository: string;
      collected: Array<{ number: number }>;
      skipped: Array<{ number: number; reason: string }>;
    };
    warnings: string[];
  };
  const outcomeOf = () =>
    OutcomeFileSchema.parse(
      JSON.parse(readFileSync(join(repo.dir, '.covi/outcomes', `${runId}.json`), 'utf8')),
    );

  beforeAll(async () => {
    api = await mockApi();
    repo = await prRepo('visual-pricing-cards', dirs);
    gh = githubEnv(api.url, repo, { GITHUB_TOKEN: 'test-token' }, dirs);
    covi(['ci', '--repo', repo.dir, '--out', gh.out, '--video', 'never', '--no-comment'], {
      env: gh.env,
    });
    const published = await coviAsync(['publish', '--repo', repo.dir, '--run', gh.out], {
      env: gh.env,
    });
    expect(published.code).toBe(0);
    runId = (JSON.parse(readFileSync(join(gh.out, 'run.json'), 'utf8')) as { runId: string }).runId;
    api.pulls.push({
      number: 7,
      owner: 'acme',
      branch: 'design/pricing-refresh',
      sha: repo.head,
      state: 'closed',
      merged_at: '2026-10-02T09:00:00Z',
      closed_at: '2026-10-02T09:00:00Z',
      merge_commit_sha: '1'.repeat(40),
    });
    // The report is about the repository it runs in: the one its remote names.
    repo.git('remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  });
  afterAll(() => api.server.close());

  it('collects what became of a published review and reports how its findings held up', async () => {
    api.comments[0]!.reactions['+1'] = 2;
    // In the pull_request event's environment, the event names the pull request.
    const collect = await coviAsync(['outcomes', 'collect', '--repo', repo.dir, '--json'], {
      env: gh.env,
    });
    expect(collect.code).toBe(0);
    const collected = (collect.json() as { data: { collected: unknown[] } }).data.collected;
    expect(collected).toMatchObject([{ number: 7, runId, state: 'merged' }]);
    expect(outcomeOf().comment.rating).toEqual({ up: 2, down: 0 });

    const report = (
      await coviAsync(['outcomes', 'report', '--repo', repo.dir, '--json'])
    ).json() as Report;
    const shop = report.data.repositories[0]!;
    expect(shop).toMatchObject({
      repository: 'acme/shop',
      changes: 1,
      merged: 1,
      rating: { up: 2, down: 0 },
    });
    // The focus outline finding was merged as it was: for a likely finding, that counts against it.
    expect(shop.certainty.likely.wrong).toBeGreaterThan(0);
    expect(shop.certainty.likely.precision).toBe(0);
    expect(report.data.summary).toMatch(/Likely issue: 0 of \d+ held up \(0%\)/);

    // Reverted later: the merge no longer speaks against the finding.
    api.commits.push({
      sha: '2'.repeat(40),
      message: `Revert "style(pricing): refresh plan cards"\n\nThis reverts commit ${'1'.repeat(40)}.`,
    });
    await coviAsync(['outcomes', 'collect', '--repo', repo.dir, '--json'], { env: gh.env });
    const again = (
      await coviAsync(['outcomes', 'report', '--repo', repo.dir, '--json'])
    ).json() as Report;
    expect(again.data.repositories[0]).toMatchObject({ reverted: 1 });
    expect(again.data.repositories[0]!.certainty.likely).toMatchObject({
      wrong: 0,
      precision: null,
    });
    expect(
      readdirSync(join(repo.dir, '.covi/outcomes')).filter((f) => f.endsWith('.json')),
    ).toEqual([`${runId}.json`]);
    const text = await coviAsync(['outcomes', 'report', '--repo', repo.dir]);
    expect(text.stdout.trim()).toBe(again.data.summary);
  });

  it('counts the votes on anchors of the pull request it collects, not of another', async () => {
    const key = outcomeOf().findings.find((f) => f.certainty === 'likely')!.key;
    const anchor = (id: number, pull: number, reactions: { '+1': number; '-1': number }) => ({
      id,
      pull,
      body: `<!-- covi:finding ${key} -->\n**Focus outline removed**`,
      user: BOT,
      author: { id: 50, username: 'project_5_bot' },
      created_at: '2026-10-01T09:00:00Z',
      reactions,
      path: 'src/pricing.css',
      line: 1,
    });
    api.reviewComments.push(
      anchor(900, 8, { '+1': 0, '-1': 4 }),
      anchor(901, 7, { '+1': 3, '-1': 0 }),
    );
    try {
      const result = await coviAsync(
        ['outcomes', 'collect', '--repo', repo.dir, '--number', '7', '--json'],
        { env: gh.env },
      );
      expect(result.code).toBe(0);
      expect(outcomeOf().findings.find((f) => f.key === key)).toMatchObject({
        thumbs: { up: 3, down: 0 },
      });
    } finally {
      api.reviewComments.splice(0);
    }
  });

  it('passes on what the collector could not read, on stderr and in --json warnings', async () => {
    api.endless.add('/repos/acme/shop/pulls/7/comments');
    try {
      const args = ['outcomes', 'collect', '--repo', repo.dir, '--number', '7'];
      const json = await coviAsync([...args, '--json'], { env: gh.env });
      expect(json.code).toBe(0);
      expect((json.json() as Collected).warnings.join('\n')).toMatch(
        /#7: review comments: only the first 10 pages were read/,
      );
      const human = await coviAsync(args, { env: gh.env });
      expect(human.stderr).toMatch(/#7: review comments: only the first 10 pages were read/);
      expect(human.stdout).not.toMatch(/only the first/);
    } finally {
      api.endless.clear();
    }
  });

  it('stops at a rate limit, keeps what it collected, and says when it resets', async () => {
    api.pulls.push({
      number: 8,
      owner: 'acme',
      branch: 'other',
      sha: repo.head,
      state: 'closed',
      closed_at: '2026-10-03T09:00:00Z',
    });
    api.limited.add('/repos/acme/shop/pulls/8');
    rmSync(join(repo.dir, '.covi/outcomes'), { recursive: true, force: true });
    const result = await coviAsync(
      ['outcomes', 'collect', '--repo', repo.dir, '--recent', '5', '--json'],
      { env: gh.env },
    );
    expect(result.code).toBe(0);
    const json = result.json() as {
      data: {
        collected: Array<{ number: number }>;
        incomplete: { reason: string; resetAt?: string };
      };
      warnings: string[];
    };
    expect(json.data.collected.map((c) => c.number)).toEqual([7]);
    expect(json.data.incomplete).toMatchObject({ resetAt: '2026-01-01T00:00:00.000Z' });
    expect(json.data.incomplete.reason).toMatch(/rate limit/);
    expect(json.warnings.join('\n')).toMatch(/Stopped early/);
    expect(existsSync(join(repo.dir, '.covi/outcomes', `${runId}.json`))).toBe(true);
    api.limited.clear();
  });

  it('needs a token, and outside CI a repository to ask about', async () => {
    const noToken = await coviAsync(
      ['outcomes', 'collect', '--repo', repo.dir, '--number', '7', '--json'],
      { env: { ...gh.env, GITHUB_TOKEN: '', GH_TOKEN: '', COVI_GITHUB_TOKEN: '' } },
    );
    expect(noToken.code).toBe(3);
    const nowhere = await coviAsync(['outcomes', 'collect', '--repo', repo.dir, '--number', '7'], {
      env: { GITHUB_ACTIONS: '', GITLAB_CI: '', GITHUB_REPOSITORY: '', GITHUB_TOKEN: 't' },
    });
    expect(nowhere.code).toBe(2);
    expect(nowhere.stderr).toMatch(/--repository/);
    const both = await coviAsync(
      ['outcomes', 'collect', '--repo', repo.dir, '--number', '7', '--recent', '3'],
      { env: gh.env },
    );
    expect(both.code).toBe(2);
  });

  it("takes Covi's bot from the base revision's configuration, never from the change", async () => {
    api.comments[0]!.user = { login: 'covi-app[bot]', id: 77, type: 'Bot' };
    try {
      // The change under review names the bot: in CI, that counts for nothing.
      mkdirSync(join(repo.dir, '.covi'), { recursive: true });
      writeFileSync(join(repo.dir, '.covi/config.yml'), 'publish:\n  botLogin: covi-app[bot]\n');
      const args = ['outcomes', 'collect', '--repo', repo.dir, '--number', '7', '--json'];
      const untrusted = (await coviAsync(args, { env: gh.env })).json() as Collected;
      expect(untrusted.data.collected).toEqual([]);
      expect(untrusted.data.skipped).toMatchObject([
        { number: 7, reason: expect.stringMatching(/not commented/) },
      ]);

      // On the base branch, it does.
      repo.git('checkout', '-q', 'main');
      repo.git('add', '.covi/config.yml');
      repo.git('commit', '-qm', 'chore: name the bot Covi comments as');
      const base = repo.git('rev-parse', 'HEAD');
      repo.git('checkout', '-q', '-');
      const trusted = githubEnv(api.url, { base, head: repo.head }, { GITHUB_TOKEN: 't' }, dirs);
      const result = (await coviAsync(args, { env: trusted.env })).json() as Collected;
      expect(result.data.collected).toMatchObject([{ number: 7 }]);
    } finally {
      api.comments[0]!.user = BOT;
    }
  });

  it('reads the bot names from the base revision in CI, and from the worktree locally', async () => {
    const dir = await example('refactor-retry-helper');
    mkdirSync(join(dir, '.covi'), { recursive: true });
    writeFileSync(join(dir, '.covi/config.yml'), 'publish:\n  gitlabBotUser: covi_bot\n');
    git(dir, 'add', '.covi/config.yml');
    git(dir, 'commit', '-qm', 'chore: name the bot');
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(dir, '.covi/config.yml'), 'publish:\n  gitlabBotUser: someone_else\n');
    expect(await collectorIdentity(dir, { ci: true, base })).toEqual({ gitlabBotUser: 'covi_bot' });
    // Without a base revision, CI reads nothing from the checkout.
    expect(await collectorIdentity(dir, { ci: true })).toEqual({});
    expect(await collectorIdentity(dir, { ci: false })).toEqual({ gitlabBotUser: 'someone_else' });
    const own = outside('covi.yml', 'publish:\n  botLogin: covi-app[bot]\n');
    expect(await collectorIdentity(dir, { ci: true, base, configPath: own })).toEqual({
      botLogin: 'covi-app[bot]',
    });
  });

  it('skips a run that recorded a GitLab project by its id, and goes on with the rest', async () => {
    const dir = await example('refactor-retry-helper');
    const record = (id: string, repository: string, number: number) => {
      mkdirSync(join(dir, '.covi/runs', id), { recursive: true });
      writeFileSync(
        join(dir, '.covi/runs', id, 'run.json'),
        JSON.stringify({
          runId: id,
          workflow: 'ci',
          startedAt: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T09:00:00.000Z`,
          publish: {
            platform: 'gitlab',
            repository,
            number,
            comment: { id: String(number) },
            at: '2026-10-01T09:00:00.000Z',
          },
        }),
      );
    };
    record('20261001-090000-ci-aaaaaaa', '4242', 3);
    record('20261002-090000-ci-bbbbbbb', 'acme/shop', 5);
    const result = await coviAsync(
      [
        'outcomes',
        'collect',
        '--repo',
        dir,
        '--platform',
        'gitlab',
        '--api-url',
        `${api.url}/api/v4`,
        '--json',
      ],
      { env: { GITHUB_ACTIONS: '', GITLAB_CI: '', COVI_GITLAB_TOKEN: 't' } },
    );
    expect(result.code).toBe(0);
    const json = result.json() as Collected;
    expect(json.data.repository).toBe('acme/shop');
    // !3 cannot be placed; !5 was asked about (the mock knows no merge requests).
    expect(json.data.skipped).toMatchObject([
      { number: 3, reason: expect.stringMatching(/project id 4242/) },
      { number: 5, reason: expect.stringMatching(/404/) },
    ]);
    expect(json.warnings.join('\n')).toMatch(/!3/);
  });

  it('reports only on this repository, and never from outcomes it cannot trust', async () => {
    const dir = await example('refactor-retry-helper');
    await writeOutcome(dir, outcomeFile({ number: 11 }), new Redactor());
    await writeOutcome(dir, outcomeFile({ number: 12, repository: 'acme/other' }), new Redactor());
    const report = async (...args: string[]) =>
      (await coviAsync(['outcomes', 'report', '--repo', dir, '--json', ...args])).json() as Report;
    const names = (r: Report) => r.data.repositories.map((x) => x.repository);
    expect(names(await report())).toEqual(['acme/shop']);
    expect(names(await report('--repository', 'acme/other'))).toEqual(['acme/other']);
    git(dir, 'remote', 'remove', 'origin');
    const unnamed = await report();
    expect(names(unnamed)).toEqual([]);
    expect(unnamed.warnings.join('\n')).toMatch(/--repository/);

    // Committed to the repository: anyone's to write, so not read.
    git(dir, 'add', '-f', '.covi/outcomes');
    git(dir, 'commit', '-qm', 'chore: commit outcomes');
    const tracked = await report('--repository', 'acme/shop');
    expect(names(tracked)).toEqual([]);
    expect(tracked.warnings.join('\n')).toMatch(/committed to the repository/);

    // A link pointing elsewhere: not files Covi collected.
    git(dir, 'rm', '-rq', '--cached', '.covi/outcomes');
    git(dir, 'commit', '-qm', 'chore: stop tracking outcomes');
    const elsewhere = mkdtempSync(join(tmpdir(), 'covi-outcomes-elsewhere-'));
    dirs.push(elsewhere);
    await writeOutcome(elsewhere, outcomeFile({ number: 13 }), new Redactor());
    rmSync(join(dir, '.covi/outcomes'), { recursive: true, force: true });
    symlinkSync(join(elsewhere, '.covi/outcomes'), join(dir, '.covi/outcomes'));
    const linked = await report('--repository', 'acme/shop');
    expect(names(linked)).toEqual([]);
    expect(linked.warnings.join('\n')).toMatch(/symbolic link/);
  });

  it('says there is nothing yet, and prints the outcome schema', async () => {
    const dir = await example('refactor-retry-helper');
    const empty = await coviAsync(['outcomes', 'report', '--repo', dir]);
    expect(empty.code).toBe(0);
    expect(empty.stdout).toMatch(/^No outcomes yet\./);
    const schema = covi(['schema', 'outcome']).json() as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['schemaVersion', 'runId', 'change', 'comment', 'findings']),
    );
    expect(covi(['schema', '--help']).stdout).toMatch(/files agents author or read/);
  });
});
