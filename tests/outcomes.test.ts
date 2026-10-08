import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { writeOutcome } from '../packages/core/src/outcomes/store.ts';
import { Redactor } from '../packages/core/src/security/redact.ts';
import { covi } from './helpers/cli.ts';
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
