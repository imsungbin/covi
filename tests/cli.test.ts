import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoQuestion } from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { terminalQuestion } from '../packages/cli/src/ui.ts';
import { applyVideoResult, baseResult } from '../packages/cli/src/workflows.ts';
import { covi } from './helpers/cli.ts';
import { createRepo } from './helpers/repo.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const examples = await listExamples();
async function example(name: string): Promise<string> {
  const dir = await materializeExample(examples.find((e) => e.name === name)!);
  dirs.push(dir);
  return dir;
}

describe('covi CLI', () => {
  it('prints help and version', () => {
    const help = covi(['--help']);
    expect(help.code).toBe(0);
    for (const command of [
      'analyze',
      'explain',
      'review',
      'demo',
      'video',
      'summarize',
      'report',
      'render',
      'ci',
      'publish',
    ])
      expect(help.stdout).toContain(command);
    expect(covi(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('uses documented exit codes for usage and environment errors', () => {
    expect(covi(['review', '--repo', '']).code).toBe(2);
    expect(covi(['review', '--frobnicate']).code).toBe(2);
    const outside = mkdtempSync(join(tmpdir(), 'covi-norepo-'));
    dirs.push(outside);
    const result = covi(['review', '--repo', outside, '--json']);
    expect(result.code).toBe(3);
    expect(result.json()).toMatchObject({ ok: false, exitCode: 3 });
  });

  it('reports "no changes" as success', () => {
    const repo = createRepo({ 'a.txt': 'x\n' });
    dirs.push(repo.root);
    const result = covi(['review', '--repo', repo.root, '--json']);
    expect(result.code).toBe(0);
    expect(String(result.json().message)).toMatch(/No changes/);
  });

  it('reviews a change and returns a stable JSON result with artifacts', async () => {
    const dir = await example('refactor-retry-helper');
    const result = covi(['review', '--repo', dir, '--json']);
    expect(result.code).toBe(0);
    const json = result.json() as {
      verdict: string;
      findings: { total: number };
      artifacts: Record<string, string>;
      runDir: string;
    };
    expect(json.verdict).toBe('looks-good');
    expect(json.findings.total).toBe(0);
    for (const key of ['review', 'explanation', 'findings', 'summary', 'context', 'manifest'])
      expect(existsSync(json.artifacts[key]!)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(json.runDir, 'run.json'), 'utf8')) as {
      outcome: { status: string };
      stages: Array<{ name: string }>;
      config: { provenance: Record<string, string> };
    };
    expect(manifest.outcome.status).toBe('success');
    expect(manifest.stages.map((s) => s.name)).toEqual(
      expect.arrayContaining(['understand', 'rules']),
    );
    expect(manifest.config.provenance['video.mode']).toBe('global');
  });

  it('fails the review gate with exit code 1', async () => {
    const dir = await example('visual-pricing-cards');
    expect(covi(['review', '--repo', dir, '--fail-on', 'medium', '--json']).code).toBe(1);
    expect(covi(['review', '--repo', dir, '--fail-on', 'high', '--json']).code).toBe(0);
  });

  it('supports the agent loop: analyze, write explanation and findings, report', async () => {
    const dir = await example('api-users-pagination');
    const analyzed = covi(['analyze', '--repo', dir, '--json']).json() as {
      runId: string;
      runDir: string;
      artifacts: Record<string, string>;
      data: { ruleFindings: Array<{ id: string }> };
    };
    const brief = readFileSync(analyzed.artifacts.brief!, 'utf8');
    expect(brief).toContain('## What Covi determined');
    expect(brief).toContain('## Diff (prioritized)');
    expect(brief).toContain('covi report --run');

    const ruleIds = analyzed.data.ruleFindings.map((f) => f.id);
    writeFileSync(
      join(analyzed.runDir, 'explanation.json'),
      JSON.stringify({
        depth: 'standard',
        headline: 'Paginate GET /api/users',
        summary:
          'The users endpoint now returns a page object with a cursor instead of the full array.',
        intent: {
          statement: 'Large teams made the full list slow.',
          confidence: 'medium',
          evidence: ['commit message'],
        },
      }),
    );
    // A hunk's id comes straight from the diff: its file and the + start of its @@ header.
    const patch = readFileSync(join(analyzed.runDir, 'diff.patch'), 'utf8');
    const start = /\+\+\+ b\/app\.js\n@@ -\d+(?:,\d+)? \+(\d+)/.exec(patch)![1];
    writeFileSync(
      join(analyzed.runDir, 'findings.json'),
      JSON.stringify({
        findings: [
          {
            title: 'GET /api/users changes from an array to an object',
            certainty: 'confirmed',
            severity: 'high',
            category: 'api-compatibility',
            location: { path: 'app.js', line: 24 },
            evidence: 'res.end(JSON.stringify(pageOfUsers(cursor, limit)))',
            evidenceIds: [`diff-hunk:app.js:${start}`],
            explanation: 'Existing clients iterate the array.',
          },
        ],
        dismissed: ruleIds
          .filter((id) => id.includes('env-var'))
          .map((id) => ({ id, reason: 'Documented in the deployment repo.' })),
        checked: ['response contract'],
      }),
    );
    const reported = covi(['report', '--repo', dir, '--run', analyzed.runId, '--json']);
    expect(reported.code).toBe(0);
    const json = reported.json() as { verdict: string; findings: { confirmed: number } };
    expect(json.verdict).toBe('needs-changes');
    expect(json.findings.confirmed).toBe(1);
    const review = readFileSync(join(analyzed.runDir, 'review.md'), 'utf8');
    expect(review).toContain('GET /api/users changes from an array to an object');
    expect(review).toContain('Documented in the deployment repo.');
    // The run's recorded outcome reflects the agent's review, so `covi runs` shows it.
    const manifest = JSON.parse(readFileSync(join(analyzed.runDir, 'run.json'), 'utf8')) as {
      outcome: { verdict: string; findings: { confirmed: number } };
      updatedAt?: string;
    };
    expect(manifest.outcome).toMatchObject({
      verdict: 'needs-changes',
      findings: { confirmed: 1 },
    });
    expect(manifest.updatedAt).toBeDefined();
    const gated = covi(['report', '--repo', dir, '--run', analyzed.runId, '--fail-on', 'high']);
    expect(gated.code).toBe(1);
    expect(
      (
        JSON.parse(readFileSync(join(analyzed.runDir, 'run.json'), 'utf8')) as {
          outcome: { status: string };
        }
      ).outcome.status,
    ).toBe('gated');
  });

  it('rejects invalid agent-authored files with field-level errors (exit 2)', async () => {
    const dir = await example('bugfix-cli-slugify');
    const analyzed = covi(['analyze', '--repo', dir, '--json']).json() as {
      runId: string;
      runDir: string;
    };
    writeFileSync(
      join(analyzed.runDir, 'findings.json'),
      JSON.stringify({
        findings: [
          {
            title: 'Bad',
            certainty: 'maybe',
            severity: 'high',
            category: 'correctness',
            evidence: 'x',
            explanation: 'y',
          },
        ],
      }),
    );
    const result = covi(['report', '--repo', dir, '--run', analyzed.runId]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(
      /findings\.0\.certainty: expected one of "confirmed", "likely", "risk", "question"/,
    );
  });

  it('explains and summarizes', async () => {
    const dir = await example('ui-comment-composer');
    const explained = covi(['explain', '--repo', dir]);
    expect(explained.code).toBe(0);
    expect(explained.stdout).toContain('# Show remaining characters and block overlong comments');
    const summary = covi(['summarize', '--repo', dir, '--format', 'text']);
    expect(summary.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('plans videos and asks only what is missing', async () => {
    const dir = await example('ui-comment-composer');
    const vague = covi([
      'video',
      '--repo',
      dir,
      '--dry-run',
      '--request',
      'make a review video',
      '--json',
    ]).json() as {
      data: {
        questions: Array<{ id: string; options: Array<{ value: string }> }>;
        decision: { render: boolean };
      };
    };
    expect(vague.data.questions.map((q) => q.id)).toEqual(['mode', 'duration', 'music']);
    expect(vague.data.questions[2]!.options.map((o) => o.value)).toEqual([
      'theme',
      'compose',
      'none',
    ]);
    expect(vague.data.decision.render).toBe(true);
    // Flags decide music and effects, so nothing is asked about them.
    const flagged = covi([
      'video',
      '--repo',
      dir,
      '--dry-run',
      '--request',
      'make a review video',
      '--music',
      'none',
      '--no-sound-effects',
      '--json',
    ]).json() as {
      data: {
        questions: Array<{ id: string }>;
        missing: string[];
        spec: { music: { use: string }; soundEffects: boolean };
      };
    };
    expect(flagged.data.questions.map((q) => q.id)).toEqual(['mode', 'duration']);
    expect(flagged.data.missing).not.toContain('music');
    expect(flagged.data.spec).toMatchObject({ music: { use: 'none' }, soundEffects: false });
    expect(covi(['video', '--repo', dir, '--dry-run', '--music', 'jazz', '--json']).code).toBe(2);
    // Where the music plays and the outro are flags too; the music question says where it plays.
    const placed = covi([
      'video',
      '--repo',
      dir,
      '--dry-run',
      '--request',
      'make a review video',
      '--music-placement',
      'continuous',
      '--no-outro',
      '--json',
    ]).json() as {
      data: {
        questions: Array<{ id: string; options: Array<{ description: string }> }>;
        spec: { music: { placement: string; setting: string }; outro: boolean };
      };
    };
    expect(placed.data.spec).toMatchObject({
      music: { placement: 'continuous', setting: 'continuous' },
      outro: false,
    });
    expect(placed.data.questions.find((q) => q.id === 'music')!.options[0]!.description).toMatch(
      /a quiet bed under the narration, louder before the first line and at the end/i,
    );
    expect(
      covi(['video', '--repo', dir, '--dry-run', '--music-placement', 'everywhere', '--json']).code,
    ).toBe(2);
    // --yes: no questions at all.
    const yes = covi([
      'video',
      '--repo',
      dir,
      '--dry-run',
      '--yes',
      '--request',
      'make a review video',
      '--json',
    ]).json() as { data: { questions: unknown[] } };
    expect(yes.data.questions).toEqual([]);
    const specific = covi([
      'video',
      '--repo',
      dir,
      '--dry-run',
      '--request',
      'Make a 30-second vertical review video.',
      '--json',
    ]).json() as {
      data: {
        questions: unknown[];
        spec: { mode: string; width: number; duration: { target: number } };
      };
    };
    expect(specific.data.questions).toEqual([]);
    expect(specific.data.spec).toMatchObject({
      mode: 'short',
      width: 1080,
      duration: { target: 30 },
    });
  });

  it('offers composing at a terminal only when a model can write the score', () => {
    const music = videoQuestion('music');
    const values = (canCompose: boolean) =>
      terminalQuestion(music, { canCompose }).options.map((o) => o.value);
    expect(values(true)).toEqual(['theme', 'compose', 'none']);
    expect(values(false)).toEqual(['theme', 'none']);
    expect(terminalQuestion(videoQuestion('mode'), { canCompose: false })).toEqual(
      videoQuestion('mode'),
    );
  });

  it('says how to change the music only when the default theme plays', async () => {
    const session = {
      run: { id: 'run-1', has: async () => false, path: (rel: string) => rel },
      language: { language: 'en' },
    } as unknown as Parameters<typeof applyVideoResult>[0];
    const music = async (source: 'theme' | 'none', error?: string) => {
      const result = baseResult('video');
      const produced = {
        video: 'video/covi-review.mp4',
        narration: { enabled: true, provider: 'say', voice: 'Samantha', reason: '' },
        audio: {
          music: { use: 'theme', source, reason: '', placement: 'continuous', error },
        },
      } as unknown as Parameters<typeof applyVideoResult>[2];
      await applyVideoResult(session, result, produced, { musicDefault: true });
      return result.video!.music!;
    };
    expect(await music('theme')).toEqual({
      use: 'theme',
      source: 'theme',
      hint: 'Music: Covi theme. To change it, run `covi render --run run-1 --music none` or `--music compose`.',
    });
    // The theme failed to render: the video has no music to describe or change.
    expect(await music('none', 'mixer exploded')).toEqual({ use: 'theme', source: 'none' });
  });

  it('declines a video for an internal change and still produces the review', async () => {
    const dir = await example('refactor-retry-helper');
    const result = covi(['video', '--repo', dir, '--json']);
    expect(result.code).toBe(0);
    const json = result.json() as {
      video: { rendered: boolean; reason: string };
      artifacts: Record<string, string>;
    };
    expect(json.video.rendered).toBe(false);
    expect(json.video.reason).toMatch(/Nothing user-visible changes/);
    expect(existsSync(json.artifacts.review!)).toBe(true);
  });

  it('prints JSON schemas, templates, skills, and examples', () => {
    const schema = covi(['schema', 'findings']).json() as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['findings', 'dismissed', 'checked', 'notVerified']),
    );
    const score = covi(['schema', 'score']).json() as {
      properties: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(Object.keys(score.properties)).toEqual(
      expect.arrayContaining(['schemaVersion', 'draft', 'bpm', 'tracks', 'patterns', 'form']),
    );
    expect(Object.keys(score.properties.form!.properties!)).toEqual(
      expect.arrayContaining(['ending', 'logo']),
    );
    expect(covi(['schema', 'nope']).code).toBe(2);
    expect(covi(['templates', '--json']).json()).toHaveLength(7);
    expect(
      (covi(['skills', '--json']).json() as unknown as Array<{ name: string }>).map((s) => s.name),
    ).toContain('covi-review');
    expect(covi(['examples', '--json']).json()).toHaveLength(6);
    expect(covi(['mascot', '--expression', 'success']).stdout).toMatch(/^<svg/);
    // Files frame the pointing tail; marks step their detail down with size.
    expect(covi(['mascot', '--expression', 'reviewing']).stdout).toContain(
      'viewBox="-20 -12 154 154"',
    );
    expect(covi(['mascot', '--mark', '--size', '16']).stdout).not.toContain('M46.8 15');
    expect(covi(['mascot', '--mark', '--size', '32']).stdout).toContain('M46.8 15');
    expect(covi(['mascot', '--logo', '--size', '128']).stdout).toMatch(/height="64"/);
  });

  it('initializes configuration from what it detects', async () => {
    const dir = await example('ui-comment-composer');
    rmSync(join(dir, '.covi', 'config.yml'));
    const result = covi(['init', '--repo', dir, '--json']).json() as {
      created: boolean;
      content: string;
      detected: string[];
    };
    expect(result.created).toBe(true);
    expect(result.content).toContain('static: .');
    // Video settings stay commented out, so interactive sessions still ask about them.
    expect(result.content).toMatch(/^# video:$/m);
    expect(result.content).not.toMatch(/^video:/m);
    expect(covi(['review', '--repo', dir, '--json']).code).toBe(0);
  });

  it('lists and shows runs', async () => {
    const dir = await example('refactor-retry-helper');
    covi(['review', '--repo', dir, '--json']);
    const runs = covi(['runs', '--repo', dir, '--json']).json() as unknown as Array<{
      id: string;
      workflow: string;
    }>;
    expect(runs[0]!.workflow).toBe('review');
    const show = covi(['runs', 'show', 'latest', '--repo', dir, '--json']).json() as {
      runId: string;
    };
    expect(show.runId).toBe(runs[0]!.id);

    // A configured output.dir is where every command looks.
    writeFileSync(join(dir, '.covi', 'config.yml'), 'output:\n  dir: .reviews\n');
    covi(['review', '--repo', dir, '--json']);
    expect(existsSync(join(dir, '.reviews', 'LATEST'))).toBe(true);
    const moved = covi(['runs', '--repo', dir, '--json']).json() as unknown as Array<{
      id: string;
    }>;
    expect(moved).toHaveLength(1);
    expect(
      (covi(['runs', 'show', 'latest', '--repo', dir, '--json']).json() as { runId: string }).runId,
    ).toBe(moved[0]!.id);
  });

  it('installs skills for agent clients without clobbering foreign directories', () => {
    const dest = mkdtempSync(join(tmpdir(), 'covi-skills-'));
    dirs.push(dest);
    const first = covi(['skills', 'install', '--dest', dest, '--json']).json() as {
      installed: string[];
    };
    expect(first.installed).toContain('covi');
    expect(existsSync(join(dest, 'covi-review', 'references', 'checklists.md'))).toBe(true);
    expect(covi(['skills', 'install', '--dest', dest, '--json']).code).toBe(0);
    rmSync(join(dest, 'covi', '.covi-skill'));
    expect(covi(['skills', 'install', '--dest', dest]).code).toBe(2);
  });
});
