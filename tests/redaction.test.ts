import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReview,
  DEFAULT_CONFIG,
  explainHeuristically,
  Redactor,
  Run,
  silentLogger,
} from '@covi/core';
import { type DirectionInput, produceVideo, resolveVideoSpec } from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze } from './helpers/analyze.ts';

// Assembled at runtime so this file itself never contains a token-shaped string.
const TOKEN = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
const MASKED = /ghp_\S*(redacted|•|\*)/i;
const cleanup: Array<() => void> = [];
afterAll(() => {
  for (const c of cleanup) c();
});

/** A change whose diff holds the token, reviewed, and a fresh run to draft its video in. */
async function setup() {
  const a = await analyze(
    { 'src/client.js': 'export const client = () => fetch("/api");\n' },
    {
      'src/client.js': [
        `const TOKEN = "${TOKEN}";`,
        'export const client = () =>',
        '  fetch("/api", { headers: { authorization: `Bearer ${TOKEN}` } });',
        '',
      ].join('\n'),
    },
    { message: 'feat(api): authenticate requests' },
  );
  cleanup.push(() => a.repo.cleanup());
  const root = mkdtempSync(join(tmpdir(), 'covi-redact-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const run = await Run.create({
    root,
    workflow: 'video',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: '0.0.0-test',
    redactor: new Redactor(),
  });
  const { review } = buildReview({
    ruleFindings: a.findings,
    checked: [],
    config: DEFAULT_CONFIG,
    context: a.context,
    generatedBy: { provider: 'heuristic' },
  });
  const input = {
    run,
    change: a.change,
    context: a.context,
    explanation: explainHeuristically(a.context),
    review,
    spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
    template: 'quick-review',
    cacheDir: join(root, 'cache'),
    logger: silentLogger,
    draftOnly: true,
  };
  return { run, input };
}

describe('redaction in videos', () => {
  it('keeps a secret in the diff out of the storyboard every later stage draws from', async () => {
    const { input } = await setup();
    const result = await produceVideo(input);
    const text = JSON.stringify(result.storyboard);
    // The code scene shows the changed file, so the token line is on screen unless redacted.
    expect(result.storyboard.scenes.some((s) => s.visual.kind === 'code')).toBe(true);
    expect(text).not.toContain(TOKEN);
    expect(text).toMatch(MASKED);
  });

  it('keeps a secret in a sync phrase out of the drafted direction', async () => {
    const { run, input } = await setup();
    // The default director zooms a highlighted code scene on the phrase that lights its lines, so
    // the drafted direction quotes that phrase: with the token in it, unless it was redacted.
    await produceVideo({
      ...input,
      storyboard: {
        title: 'Authenticate requests',
        template: 'quick-review',
        scenes: [
          {
            id: 's1',
            beat: 'context',
            narration: 'Every request now says who sent it.',
            visual: { kind: 'title', title: 'Authenticate requests', meta: [] },
          },
          {
            id: 's2',
            beat: 'fix',
            eyebrow: 'The header',
            narration: `It sends ${TOKEN} with every request.`,
            sync: { highlight: `${TOKEN} with every` },
            visual: {
              kind: 'code',
              path: 'src/client.js',
              lines: [
                { type: 'context', text: 'export const client = () =>' },
                { type: 'add', text: '  fetch("/api", { headers: { authorization } });' },
              ],
              highlight: [1],
            },
          },
        ],
      },
    });
    const text = readFileSync(run.path('video/direction.json'), 'utf8');
    const direction = JSON.parse(text) as DirectionInput;
    expect(direction.draft).toBe(true);
    const beat = direction.shots.find((s) => s.scene === 's2')?.beats?.[0];
    expect(beat).toMatchObject({ verb: 'camera', to: 'visual' });
    expect(beat && 'at' in beat ? beat.at : undefined).toMatch(MASKED);
    expect(text).not.toContain(TOKEN);
  });
});
