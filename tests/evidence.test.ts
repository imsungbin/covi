import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffHunkEvidence, resolveChange } from '@covi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { covi } from './helpers/cli.ts';
import { createChangeRepo, type FileMap, type TempRepo } from './helpers/repo.ts';

const repos: TempRepo[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A file outside the repository: configuration and stand-ins belong to the user, not the change. */
function outside(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'covi-evidence-'));
  dirs.push(dir);
  writeFileSync(join(dir, name), text);
  return join(dir, name);
}

function change(base: FileMap, head: FileMap): TempRepo {
  const repo = createChangeRepo(base, head, { message: 'Change' });
  repos.push(repo);
  return repo;
}

const read = <T>(dir: string, rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8')) as T;
interface Items {
  items: Array<{
    id: string;
    kind: string;
    label: string;
    revision: string;
    location?: { path: string };
  }>;
}

describe('evidence in reviews', () => {
  it('cites hunks that exist in the run, whatever the path or a redacted key does to the diff', async () => {
    // Assembled at runtime, so no secret scanner flags this file.
    const pem = `${['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')}\n${'MIIB'.repeat(16)}\n${['-----END', 'RSA PRIVATE KEY-----'].join(' ')}\nafter\n`;
    const repo = change(
      { 'src/한글 file.test.ts': "it('a', () => {});\n" },
      {
        'src/한글 file.test.ts': "it('a', () => {});\nit.only('b', () => {});\n",
        'src/a b.test.ts': "it.only('c', () => {});\n",
        'deploy/id_rsa': pem,
      },
    );
    const result = covi(['review', '--repo', repo.root, '--json']);
    expect(result.code).toBe(0);
    const runDir = result.json().runDir as string;
    const items = read<Items>(runDir, 'evidence.json').items;
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'diff-hunk:src/한글 file.test.ts:1',
        'diff-hunk:src/a b.test.ts:1',
        'diff-hunk:deploy/id_rsa:1',
      ]),
    );
    // Rules cite hunks computed from the resolved change; the registry reads the redacted
    // diff.patch. Both must name the same hunks.
    const resolved = await resolveChange({ repo: repo.root });
    expect(diffHunkEvidence(resolved.files).map((i) => i.id)).toEqual(
      items.filter((i) => i.kind === 'diff-hunk').map((i) => i.id),
    );
    const review = read<{
      findings: Array<{ source: { id?: string }; certainty: string; evidenceIds?: string[] }>;
    }>(runDir, 'review.json');
    for (const rule of ['focused-test', 'secret-in-diff']) {
      const found = review.findings.filter((f) => f.source.id === rule);
      expect(found.length, rule).toBeGreaterThan(0);
      for (const f of found) {
        expect(f.certainty, rule).toBe('confirmed');
        expect(f.evidenceIds?.length, rule).toBeGreaterThan(0);
        for (const id of f.evidenceIds!) expect(ids, id).toContain(id);
      }
    }
    // The key really was redacted out of the diff the hunks are read from.
    expect(readFileSync(join(runDir, 'diff.patch'), 'utf8')).not.toContain('MIIBMIIB');
    expect(readFileSync(join(runDir, 'comment.md'), 'utf8')).toContain('`src/a b.test.ts:1`');
    // The findings.json Covi wrote is a valid version 2 file: reporting it again passes.
    expect(read<{ schemaVersion: number }>(runDir, 'findings.json').schemaVersion).toBe(2);
    expect(covi(['report', '--repo', repo.root, '--run', runDir, '--json']).code).toBe(0);
  });

  it("holds agent findings and explanations to the run's evidence", () => {
    const repo = change(
      { 'src/cart.ts': 'export const dec = (q) => q - 1;\n' },
      { 'src/cart.ts': 'export const dec = (q) => Math.max(0, q - 1);\n' },
    );
    const analyzed = covi(['analyze', '--repo', repo.root, '--json']);
    expect(analyzed.code).toBe(0);
    const { runDir, artifacts } = analyzed.json() as {
      runDir: string;
      artifacts: Record<string, string>;
    };
    expect(artifacts.evidence).toBe(join(runDir, 'evidence.json'));
    expect(read<Items>(runDir, 'evidence.json').items.map((i) => i.id)).toContain(
      'diff-hunk:src/cart.ts:1',
    );
    // Covi's own draft cites the hunks of each change, so an agent copying it starts grounded.
    const draft = read<{ changes: Array<{ evidenceIds?: string[] }> }>(
      runDir,
      'explanation.draft.json',
    );
    expect(draft.changes.flatMap((c) => c.evidenceIds ?? [])).toContain('diff-hunk:src/cart.ts:1');
    const finding = {
      title: 'Quantity can no longer go negative',
      certainty: 'confirmed',
      severity: 'low',
      category: 'correctness',
      location: { path: 'src/cart.ts', line: 1 },
      evidence: 'Math.max(0, q - 1)',
      explanation: 'Totals stay at or above zero.',
    };
    const report = (findings: unknown) => {
      writeFileSync(join(runDir, 'findings.json'), JSON.stringify(findings));
      const out = covi(['report', '--repo', repo.root, '--run', runDir, '--json']);
      return { ...out, text: out.stdout + out.stderr };
    };

    const missing = report({ findings: [finding] });
    expect(missing.code).toBe(2);
    expect(missing.text).toMatch(
      /findings\.0\.evidenceIds: a confirmed finding cites at least one evidence id/,
    );

    for (const wrong of ['flow-load-items-head#n2', 'line 1', 'trace:flow-cart-head#n2']) {
      const unknown = report({ findings: [{ ...finding, evidenceIds: [wrong] }] });
      expect(unknown.code, wrong).toBe(2);
      expect(unknown.text).toContain(
        `findings.json findings[0] (Quantity can no longer go negative): ${wrong}`,
      );
      expect(unknown.text).toContain('covi evidence --run');
      expect(unknown.text).toContain('diff-hunk:src/app.ts:40');
    }

    const v1 = report({ schemaVersion: 1, findings: [finding] });
    expect(v1.code).toBe(0);
    expect((v1.json() as { warnings: string[] }).warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/schemaVersion 1, so 1 confirmed or likely finding/),
      ]),
    );

    writeFileSync(
      join(runDir, 'explanation.json'),
      JSON.stringify({
        depth: 'brief',
        headline: 'Clamp quantities at zero',
        summary: 'Decrementing stops at zero.',
        intent: { statement: 'Totals went negative.', confidence: 'high' },
        changes: [{ area: 'Cart', description: 'dec() clamps at zero.', files: ['src/cart.ts'] }],
      }),
    );
    const cited = report({ findings: [{ ...finding, evidenceIds: ['diff-hunk:src/cart.ts:1'] }] });
    expect(cited.code).toBe(0);
    expect(readFileSync(join(runDir, 'review.md'), 'utf8')).toContain(
      'Cited evidence: `src/cart.ts:1`',
    );
    expect((cited.json() as { warnings: string[] }).warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /explanation\.json: \d+ statement\(s\) cite no evidence: .*changes\[0\] \(Cart\)/,
        ),
      ]),
    );

    writeFileSync(
      join(runDir, 'explanation.json'),
      JSON.stringify({
        depth: 'brief',
        headline: 'Clamp quantities at zero',
        summary: 'Decrementing stops at zero.',
        intent: { statement: 'Totals went negative.', confidence: 'high' },
        changes: [
          { area: 'Cart', description: 'd', files: ['src/cart.ts'], evidenceIds: ['http:7'] },
        ],
      }),
    );
    const badExplanation = report({ findings: [] });
    expect(badExplanation.code).toBe(2);
    expect(badExplanation.text).toContain('explanation.json changes[0] (Cart): http:7');
  });

  it("grounds a model's findings and explanation and writes them, so the run reports again", () => {
    const repo = change(
      { 'src/cart.ts': 'export const dec = (q) => q - 1;\n' },
      { 'src/cart.ts': 'export const dec = (q) => Math.max(0, q - 1);\n' },
    );
    const finding = {
      title: 'Quantity can no longer go negative',
      certainty: 'confirmed',
      severity: 'low',
      category: 'correctness',
      location: { path: 'src/cart.ts', line: 1 },
      evidence: 'Math.max(0, q - 1)',
      explanation: 'Totals stay at or above zero.',
    };
    const answer = {
      explanation: {
        depth: 'brief',
        headline: 'Clamp quantities at zero',
        summary: 'Decrementing stops at zero.',
        intent: {
          statement: 'Totals went negative.',
          confidence: 'high',
          evidenceIds: ['trace:made-up'],
        },
        changes: [
          {
            area: 'Cart',
            description: 'dec() clamps at zero.',
            files: ['src/cart.ts'],
            evidenceIds: ['http:9'],
          },
        ],
      },
      review: {
        findings: [
          { ...finding, evidenceIds: ['trace:made-up'] },
          {
            ...finding,
            title: 'Somewhere else',
            certainty: 'likely',
            location: { path: 'src/other.ts', line: 3 },
          },
        ],
      },
    };
    // A stand-in for an agent CLI: reads the prompt, answers with a fixed analysis.
    const model = outside(
      'model.cjs',
      `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(answer))}));`,
    );
    const config = outside(
      'covi.yml',
      `intelligence:\n  provider: command\n  command: ${JSON.stringify(`node ${model}`)}\n`,
    );
    const reviewed = covi(['--config', config, 'review', '--repo', repo.root, '--json']);
    expect(reviewed.code).toBe(0);
    const { runDir, warnings } = reviewed.json() as { runDir: string; warnings: string[] };
    const explained = [
      'Model explanation intent cited evidence the run does not have (trace:made-up); those ids were dropped.',
      'Model explanation changes[0] (Cart) cited evidence the run does not have (http:9); those ids were dropped.',
    ];
    expect(warnings).toEqual(
      expect.arrayContaining([
        ...explained,
        'Model finding "Quantity can no longer go negative" cited evidence the run does not have (trace:made-up), so it cites the diff at its location (diff-hunk:src/cart.ts:1).',
        'Model finding "Somewhere else" cited no evidence, so it is reported as a risk rather than likely.',
      ]),
    );
    // One note per finding grounding changed.
    expect(warnings.filter((w) => w.includes('"Quantity can no longer go negative"'))).toHaveLength(
      1,
    );
    const written = read<{
      schemaVersion: number;
      findings: Array<{ title: string; certainty: string; evidenceIds?: string[] }>;
    }>(runDir, 'findings.json');
    expect(written.schemaVersion).toBe(2);
    expect(written.findings.map((f) => [f.title, f.certainty, f.evidenceIds])).toEqual([
      ['Quantity can no longer go negative', 'confirmed', ['diff-hunk:src/cart.ts:1']],
      ['Somewhere else', 'risk', undefined],
    ]);
    const explanation = read<{
      intent: { evidenceIds?: string[] };
      changes: Array<{ evidenceIds?: string[] }>;
    }>(runDir, 'explanation.json');
    expect(explanation.intent.evidenceIds).toBeUndefined();
    // The made-up id is gone, so the change cites its file's hunk instead.
    expect(explanation.changes[0]!.evidenceIds).toEqual(['diff-hunk:src/cart.ts:1']);
    const reported = covi(['report', '--repo', repo.root, '--run', runDir, '--json']);
    expect(reported.code).toBe(0);
    expect((reported.json() as { artifacts: Record<string, string> }).artifacts.evidence).toBe(
      join(runDir, 'evidence.json'),
    );

    // `covi explain` grounds the same explanation the same way.
    const explainedRun = covi(['--config', config, 'explain', '--repo', repo.root, '--json']);
    expect(explainedRun.code).toBe(0);
    expect((explainedRun.json() as { warnings: string[] }).warnings).toEqual(
      expect.arrayContaining(explained),
    );
    const explainDir = explainedRun.json().runDir as string;
    expect(
      read<{ changes: Array<{ evidenceIds?: string[] }> }>(explainDir, 'explanation.json')
        .changes[0]!.evidenceIds,
    ).toEqual(['diff-hunk:src/cart.ts:1']);
  });

  it('lists the evidence among the artifacts of a video run, even when no video is made', () => {
    const repo = change({ 'a.js': 'a\n' }, { 'a.js': 'b\n' });
    const video = covi(['video', '--repo', repo.root, '--json']);
    expect(video.code).toBe(0);
    const {
      runDir,
      artifacts,
      video: made,
    } = video.json() as {
      runDir: string;
      artifacts: Record<string, string>;
      video: { rendered: boolean };
    };
    expect(made.rendered).toBe(false);
    expect(artifacts.evidence).toBe(join(runDir, 'evidence.json'));
  });

  it('keeps the test output a run cites', () => {
    const repo = change({ 'a.js': 'a\n' }, { 'a.js': 'b\n' });
    const config = outside(
      'covi.yml',
      `test:\n  command: ${JSON.stringify('node -e "console.log(42)"')}\n`,
    );
    const reviewed = covi([
      '--config',
      config,
      'review',
      '--repo',
      repo.root,
      '--run-tests',
      '--json',
    ]);
    expect(reviewed.code).toBe(0);
    const runDir = reviewed.json().runDir as string;
    expect(readFileSync(join(runDir, 'tests.log'), 'utf8')).toBe(
      '$ node -e "console.log(42)"\n42\n',
    );
    expect(read<Items>(runDir, 'evidence.json').items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'test-run:tests', path: 'tests.log', revision: 'head' }),
      ]),
    );
  });
});
