import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectEvidence, loadEvidence, writeEvidence } from '../src/evidence/collect.ts';
import { EVIDENCE_LIMITS, EvidenceFileSchema } from '../src/model/evidence.ts';
import { Run } from '../src/run/run.ts';
import { Redactor } from '../src/security/redact.ts';
import { sha256 } from '../src/util/hash.ts';

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

async function newRun(literals: string[] = []): Promise<Run> {
  root = mkdtempSync(join(tmpdir(), 'covi-evidence-'));
  return Run.create({
    root,
    workflow: 'review',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: 'test',
    redactor: new Redactor({ literals }),
  });
}

const PATCH = [
  'diff --git a/src/cart.ts b/src/cart.ts',
  '--- a/src/cart.ts',
  '+++ b/src/cart.ts',
  '@@ -10,3 +10,4 @@',
  ' a',
  '-b',
  '+c',
  '+d',
  ' e',
  '',
].join('\n');

const TOKEN = `ghp_${'R'.repeat(36)}`;

/** Files written as a capture leaves them, before Covi redacts anything it derives. */
function writeRaw(run: Run, rel: string, content: string) {
  mkdirSync(join(run.dir, rel, '..'), { recursive: true });
  writeFileSync(join(run.dir, rel), content);
}

function captures(
  trace: { path: string },
  shot: string,
  extra: { commands?: unknown[]; recordings?: unknown[] } = {},
) {
  return JSON.stringify({
    schemaVersion: 1,
    shots: [
      {
        id: 'home-desktop',
        kind: 'page',
        name: '/',
        viewport: 'desktop',
        after: { path: shot, width: 1, height: 1 },
      },
    ],
    commands: extra.commands ?? [],
    requests: [
      {
        name: 'Token',
        method: 'GET',
        path: `/api?token=${TOKEN}`,
        after: { status: 200, body: '{}' },
        changed: true,
      },
    ],
    skipped: [],
    findings: [],
    traces: [
      {
        id: 'home-desktop-head',
        scenario: 'home-desktop',
        kind: 'page',
        revision: 'head',
        path: trace.path,
      },
    ],
    ...(extra.recordings ? { recordings: extra.recordings } : {}),
  });
}

const TRACE = JSON.stringify({
  schemaVersion: 1,
  id: 'home-desktop-head',
  scenario: 'home-desktop',
  kind: 'page',
  name: '/',
  revision: 'head',
  viewport: 'desktop',
  path: '/',
  durationMs: 1,
  steps: [{ id: 'load', action: 'goto', t: 0, durationMs: 1, status: 'ok' }],
  requests: [],
  console: [],
  mutations: { count: 0, regions: [] },
});

describe('run evidence', () => {
  it('builds evidence from the diff, captures, traces, and test output in the run', async () => {
    const run = await newRun();
    await run.writeText('diff.patch', PATCH, 'diff');
    writeRaw(
      run,
      'demo/captures.json',
      captures(
        { path: 'demo/traces/home-desktop-head.json' },
        'demo/screenshots/home-desktop-after.png',
      ),
    );
    writeRaw(run, 'demo/traces/home-desktop-head.json', TRACE);
    writeRaw(run, 'demo/screenshots/home-desktop-after.png', 'png');
    writeRaw(run, 'tests.log', '$ npm test\nok\n');
    const evidence = await writeEvidence(run);
    expect(evidence.items.map((i) => i.id)).toEqual([
      'diff-hunk:src/cart.ts:10',
      'screenshot:home-desktop-after',
      'trace:home-desktop-head',
      'http:1',
      'test-run:tests',
    ]);
    expect(evidence.items.find((i) => i.id === 'trace:home-desktop-head')!.refs).toEqual([
      'trace:home-desktop-head#load',
    ]);
    // Labels pass through the redactor like every other artifact.
    expect(evidence.items.find((i) => i.id === 'http:1')!.label).not.toContain(TOKEN);
    expect(run.manifest.artifacts.find((a) => a.path === 'evidence.json')).toMatchObject({
      kind: 'evidence',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await run.readJson('evidence.json')).toEqual(evidence);
  });

  it('never reads a file a capture places outside the run', async () => {
    const run = await newRun();
    // Both files exist next to the run, so only the path guard keeps them out.
    writeFileSync(join(run.dir, '..', 'outside.json'), TRACE);
    writeFileSync(join(run.dir, '..', 'outside.png'), 'png');
    writeRaw(run, 'demo/captures.json', captures({ path: '../outside.json' }, '../outside.png'));
    const evidence = await collectEvidence(run);
    expect(evidence.items.map((i) => i.id)).toEqual(['http:1']);
  });

  it('rebuilds evidence for a run without evidence.json and writes nothing', async () => {
    const run = await newRun();
    await run.writeText('diff.patch', PATCH, 'diff');
    const rebuilt = await loadEvidence(run);
    expect(rebuilt.source).toBe('rebuilt');
    expect(rebuilt.evidence.items.map((i) => i.id)).toEqual(['diff-hunk:src/cart.ts:10']);
    expect(existsSync(run.path('evidence.json'))).toBe(false);
    await writeEvidence(run);
    expect((await loadEvidence(run)).source).toBe('file');
  });

  it('rebuilds exactly what it would write: same digests, same redacted labels', async () => {
    const secret = 'tok123';
    const run = await newRun([secret]);
    // Redaction lengthens this command past the label limit, so it must be cut afterwards.
    const command = `${secret} `.repeat(28).trim();
    writeRaw(
      run,
      'demo/captures.json',
      captures({ path: 'demo/traces/home-desktop-head.json' }, 'demo/screenshots/x.png', {
        commands: [{ name: 'cli', command, after: { exitCode: 0, output: secret }, changed: true }],
      }),
    );
    const rebuilt = await loadEvidence(run);
    const written = await writeEvidence(run);
    expect(rebuilt.evidence).toEqual(written);
    // The same registry again once captures.json is redacted, as Covi writes it.
    await run.writeJson('demo/captures.json', await run.readJson('demo/captures.json'), 'capture');
    await run.discard('evidence.json');
    expect((await loadEvidence(run)).evidence).toEqual(written);
    expect(written.items.map((i) => i.id)).toEqual(['http:1', 'terminal:1']);
    const terminal = written.items.find((i) => i.id === 'terminal:1')!;
    expect(terminal.label).toHaveLength(EVIDENCE_LIMITS.label);
    expect(JSON.stringify(written)).not.toContain(secret);
    expect(JSON.stringify(written)).not.toContain(TOKEN);
  });

  it('never writes an evidence.json its own loader rejects', async () => {
    const png = sha256('png');
    // A short secret that redaction lengthens past the id limit, and one that hides in a digest.
    const secret = 'qq7788';
    const run = await newRun([secret, png.slice(0, 12)]);
    const long = `${secret}-${'r'.repeat(EVIDENCE_LIMITS.id - 'recording:'.length - 7)}`;
    expect(`recording:${long}`.length).toBe(EVIDENCE_LIMITS.id);
    writeRaw(
      run,
      'demo/captures.json',
      captures({ path: 'demo/traces/none.json' }, 'demo/screenshots/home-desktop-after.png', {
        recordings: [
          {
            id: long,
            scenario: long,
            flow: 'post',
            revision: 'head',
            viewport: 'desktop',
            path: 'demo/recordings/r.mp4',
            format: 'mp4',
            width: 1,
            height: 1,
            seconds: 1,
          },
        ],
      }),
    );
    writeRaw(run, 'demo/screenshots/home-desktop-after.png', 'png');
    writeRaw(run, 'demo/recordings/r.mp4', 'mp4');
    const written = await writeEvidence(run);
    expect(written.items.map((i) => i.id)).toEqual(['http:1']);
    expect(EvidenceFileSchema.safeParse(await run.readJson('evidence.json')).success).toBe(true);
    expect((await loadEvidence(run)).evidence).toEqual(written);
  });

  it('rejects an evidence.json that is not one', async () => {
    const run = await newRun();
    writeRaw(run, 'evidence.json', JSON.stringify({ schemaVersion: 1, items: [{ id: 'nope' }] }));
    await expect(loadEvidence(run)).rejects.toThrow(/evidence\.json is invalid/);
  });
});
