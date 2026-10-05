import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { covi } from './helpers/cli.ts';
import { createChangeRepo } from './helpers/repo.ts';

const repos: Array<{ cleanup(): void }> = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

/** A command that appends `label` to a marker file outside the repository. */
function marking(marker: string, label: string): string {
  return `node -e "require('fs').appendFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, '${label}\\\\n')"`;
}

function configWith(marker: string, demoLabel = 'demo'): string {
  return [
    'demo:',
    '  commands:',
    `    - name: mark`,
    `      run: ${JSON.stringify(marking(marker, demoLabel))}`,
    'test:',
    `  command: ${JSON.stringify(marking(marker, 'test'))}`,
    'intelligence:',
    `  command: ${JSON.stringify(marking(marker, 'agent'))}`,
    '',
  ].join('\n');
}

function ran(marker: string): string[] {
  return existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n') : [];
}

describe('commands from repository configuration', () => {
  // About nine CLI runs in a row: allow for a busy machine.
  it('stay withheld until the user trusts them, and again after they change', {
    timeout: 180_000,
  }, () => {
    const repo = createChangeRepo(
      { 'cli.js': 'console.log("v1")\n' },
      { 'cli.js': 'console.log("v2")\n' },
      { message: 'fix: print v2' },
    );
    repos.push(repo);
    const marker = join(repo.root, '..', `${repo.root.split('/').pop()}-marker.txt`);
    repos.push({ cleanup: () => rmSync(marker, { force: true }) });
    repo.write({ '.covi/config.yml': configWith(marker) });

    // Untrusted: nothing runs, and every result says how to allow it.
    const demo = covi(['demo', '--repo', repo.root, '--json']);
    expect(demo.code).toBe(0);
    const skipped = (demo.json().data as { demo: { skipped: Array<{ reason: string }> } }).demo
      .skipped;
    expect(skipped.some((s) => /covi trust/.test(s.reason))).toBe(true);
    const review = covi(['review', '--repo', repo.root, '--run-tests', '--json']);
    expect(review.code).toBe(0);
    expect(JSON.stringify(review.json().warnings)).toMatch(/intelligence\.command.*covi trust/);
    const notVerified = (review.json().data as { review: { notVerified: string[] } }).review
      .notVerified;
    expect(notVerified.join('\n')).toMatch(/test\.command is not trusted/);
    expect(ran(marker)).toEqual([]);

    // Trusting needs confirmation when nobody can be asked.
    const refused = covi(['trust', '--repo', repo.root]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('demo.commands.mark');
    // Agents get the same list as JSON, to show the user before asking.
    const asJson = covi(['trust', '--repo', repo.root, '--json']);
    expect(asJson.code).toBe(2);
    expect(asJson.json()).toMatchObject({
      trusted: false,
      commands: expect.arrayContaining([expect.stringMatching(/^demo\.commands\.mark: /)]),
    });
    expect(ran(marker)).toEqual([]);

    const trusted = covi(['trust', '--repo', repo.root, '--yes', '--json']);
    expect(trusted.code).toBe(0);
    expect(trusted.json()).toMatchObject({ trusted: true });
    expect(covi(['demo', '--repo', repo.root, '--json']).code).toBe(0);
    expect(ran(marker)).toEqual(['demo', 'demo']); // base and head

    // Any change to the set withholds it again; --trust-commands overrides for one run.
    repo.write({ '.covi/config.yml': configWith(marker, 'changed') });
    covi(['demo', '--repo', repo.root, '--json']);
    expect(ran(marker)).toEqual(['demo', 'demo']);
    covi(['demo', '--repo', repo.root, '--trust-commands', '--json']);
    expect(ran(marker)).toEqual(['demo', 'demo', 'changed', 'changed']);

    expect(covi(['trust', '--repo', repo.root, '--revoke', '--json']).json()).toMatchObject({
      revoked: true,
    });
    covi(['demo', '--repo', repo.root, '--json']);
    expect(ran(marker)).toHaveLength(4);
  });

  it('are trusted when Covi generated them with covi init', () => {
    const repo = createChangeRepo(
      {
        'package.json': JSON.stringify({ scripts: { test: 'node test.js', start: 'node s.js' } }),
      },
      { 'test.js': 'console.log("ok")\n' },
      { message: 'test: add a test' },
    );
    repos.push(repo);
    const init = covi(['init', '--repo', repo.root, '--json']);
    expect(init.code).toBe(0);
    expect((init.json() as { trusted: string[] }).trusted).toContain('test.command: npm test');
    const trust = covi(['trust', '--repo', repo.root, '--json']);
    expect(trust.code).toBe(0); // already trusted: nothing to confirm
  });
});
