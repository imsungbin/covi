import { rmSync } from 'node:fs';
import { type Demonstration, normalizeFinding } from '@covi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { covi } from './helpers/cli.ts';
import { canUseBrowser } from './helpers/env.ts';

const browser = await canUseBrowser();
const examples = await listExamples();
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function demo(name: string, args: string[] = []): Promise<Demonstration> {
  const dir = await materializeExample(examples.find((e) => e.name === name)!);
  dirs.push(dir);
  const result = covi(['demo', '--repo', dir, '--json', ...args]);
  expect(result.code).toBe(0);
  return (result.json() as { data: { demo: Demonstration } }).data.demo;
}

describe('demonstrations', () => {
  it('replays a CLI command at base and head', async () => {
    const result = await demo('bugfix-cli-slugify');
    expect(result.commands[0]).toMatchObject({
      changed: true,
      before: { output: 'h-llo--w-rld---a-va-' },
      after: { output: 'hello-world-ca-va' },
    });
  });

  it.skipIf(!browser)(
    'runs the app at both revisions and turns an observed response change into a confirmed finding',
    async () => {
      const result = await demo('api-users-pagination');
      expect(result.app?.mode).toBe('command');
      expect(result.requests[0]).toMatchObject({
        method: 'GET',
        path: '/api/users',
        changed: true,
        before: { status: 200 },
        after: { status: 200 },
      });
      expect(result.requests[0]!.shapeChange).toMatch(/from a JSON array to a JSON object/);
      expect(result.findings).toEqual([
        expect.objectContaining({
          certainty: 'confirmed',
          severity: 'high',
          category: 'api-compatibility',
        }),
      ]);
      // Written in Korean, the finding keeps its id: SARIF and GitLab track findings by id.
      const korean = await demo('api-users-pagination', ['--language', 'ko']);
      expect(korean.findings[0]!.title).toMatch(/\p{Script=Hangul}/u);
      const ids = (d: Demonstration) =>
        d.findings.map((f) => normalizeFinding(f, { kind: 'demo' }).id);
      expect(ids(korean)).toEqual(ids(result));
    },
  );

  it.skipIf(!browser)('captures a scripted flow step by step on a static site', async () => {
    const result = await demo('ui-comment-composer');
    const steps = result.shots.filter((s) => s.kind === 'flow-step');
    expect(steps.map((s) => s.label)).toEqual([
      'Type a comment',
      'Counter updates as you type',
      'Post the comment',
      'Write a comment',
    ]);
    expect(steps[0]!.click).toBeDefined();
    expect(steps[0]!.focus).toBeDefined();
    const page = result.shots.find((s) => s.kind === 'page')!;
    expect(page.before && page.after).toBeTruthy();
  });

  it.skipIf(!browser)('captures before/after at each viewport and locates the change', async () => {
    const result = await demo('visual-pricing-cards');
    const pages = result.shots.filter((s) => s.kind === 'page');
    expect(pages.map((s) => s.viewport).sort()).toEqual(['desktop', 'mobile']);
    for (const shot of pages) {
      expect(shot.diff!.changedRatio).toBeGreaterThan(0.01);
      expect(shot.focus).toBeDefined();
      expect(shot.after!.width).toBe(shot.viewport === 'mobile' ? 780 : 1280);
    }
  });

  it('says why it skipped when there is nothing to show', async () => {
    const result = await demo('refactor-retry-helper');
    expect(result.shots).toEqual([]);
    expect(result.skipped[0]!.reason).toMatch(/Nothing user-visible changes/);
  });
});
