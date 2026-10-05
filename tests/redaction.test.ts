import { mkdtempSync, rmSync } from 'node:fs';
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
import { produceVideo, resolveVideoSpec } from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze } from './helpers/analyze.ts';

// Assembled at runtime so this file itself never contains a token-shaped string.
const TOKEN = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
const cleanup: Array<() => void> = [];
afterAll(() => {
  for (const c of cleanup) c();
});

describe('redaction in videos', () => {
  it('keeps a secret in the diff out of the storyboard every later stage draws from', async () => {
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
    const explanation = explainHeuristically(a.context);
    const { review } = buildReview({
      ruleFindings: a.findings,
      checked: [],
      config: DEFAULT_CONFIG,
      context: a.context,
      generatedBy: { provider: 'heuristic' },
    });
    const result = await produceVideo({
      run,
      change: a.change,
      context: a.context,
      explanation,
      review,
      spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
      template: 'quick-review',
      cacheDir: join(root, 'cache'),
      logger: silentLogger,
      draftOnly: true,
    });
    const text = JSON.stringify(result.storyboard);
    // The code scene shows the changed file, so the token line is on screen unless redacted.
    expect(result.storyboard.scenes.some((s) => s.visual.kind === 'code')).toBe(true);
    expect(text).not.toContain(TOKEN);
    expect(text).toMatch(/ghp_\S*(redacted|•|\*)/i);
  });
});
