import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReview,
  type Demonstration,
  explainHeuristically,
  Git,
  loadRepositoryConfig,
  Redactor,
  renderBrief,
  renderComment,
  renderExplanation,
  renderReview,
  renderSummary,
  resolveChange,
  resolveConfig,
  runRules,
  understandChange,
} from '@covi/core';
import {
  buildCaptions,
  captionOptionsFor,
  chunkCaption,
  draftStoryboard,
  loadTemplates,
  resolveVideoSpec,
  type Storyboard,
  spoken,
} from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { renderDemo } from '../packages/cli/src/workflows.ts';

/**
 * Characterization tests: what Covi writes in English today. Localization must leave every one of
 * these byte-for-byte unchanged, so a diff here is a regression unless the change is intended.
 */

const examples = await listExamples();
const root = mkdtempSync(join(tmpdir(), 'covi-english-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const analyzed = new Map<string, ReturnType<typeof analyzeOnce>>();
const analyze = (name: string) => {
  if (!analyzed.has(name)) analyzed.set(name, analyzeOnce(name));
  return analyzed.get(name)!;
};

async function analyzeOnce(name: string) {
  const example = examples.find((e) => e.name === name)!;
  // A fixed directory name keeps the repository name (shown in reports and videos) stable.
  const dir = await materializeExample(example, join(root, name));
  const loaded = await loadRepositoryConfig(dir, { kind: 'worktree' });
  const { config } = resolveConfig(
    loaded.values ? [{ name: 'repository', values: loaded.values }] : [],
  );
  const git = new Git(dir);
  const change = await resolveChange({ repo: dir, ignore: config.ignore });
  const context = await understandChange(change, { git, config });
  const rules = await runRules(change, context, { git, config });
  const { review } = buildReview({
    ruleFindings: rules.findings,
    checked: rules.checked,
    config,
    context,
    generatedBy: { provider: 'heuristic' },
  });
  const explanation = explainHeuristically(context);
  return { change, context, rules, review, explanation, config };
}

/** Evidence of every kind, so drafts exercise each visual and its narration. */
const DEMO: Demonstration = {
  schemaVersion: 1,
  shots: [
    {
      id: 'home-desktop',
      kind: 'page',
      name: '/',
      viewport: 'desktop',
      before: { path: 'demo/screenshots/home-desktop-before.png', width: 1280, height: 800 },
      after: { path: 'demo/screenshots/home-desktop-after.png', width: 1280, height: 800 },
      diff: { changedRatio: 0.04, bounds: { x: 100, y: 200, width: 400, height: 120 } },
    },
    ...['Type a comment', 'Counter updates as you type', 'Post the comment'].map((label, i) => ({
      id: `flow-${i}`,
      kind: 'flow-step' as const,
      name: label,
      flow: 'compose',
      step: i + 1,
      viewport: 'desktop' as const,
      after: { path: `demo/screenshots/flow-${i}.png`, width: 1280, height: 800 },
      click: { x: 300, y: 400 },
      label,
    })),
  ],
  commands: [
    {
      name: 'slugify',
      command: 'node cli.js "Hello World"',
      before: { exitCode: 1, output: 'Error: bad input\n' },
      after: { exitCode: 0, output: 'hello-world\n' },
      changed: true,
    },
  ],
  requests: [
    {
      name: 'list users',
      method: 'GET',
      path: '/api/users',
      changed: true,
      before: { status: 200, body: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]) },
      after: { status: 200, body: JSON.stringify({ items: [{ id: 1 }], nextCursor: 1 }) },
      shapeChange:
        'the response changed from a JSON array to a JSON object with keys items, nextCursor',
    },
  ],
  skipped: [{ what: 'tablet viewport', reason: 'not configured' }],
  findings: [],
};

/** The parts of a storyboard a person reads or hears. */
function words(storyboard: Storyboard) {
  return {
    title: storyboard.title,
    template: storyboard.template,
    scenes: storyboard.scenes.map((s) => ({
      beat: s.beat,
      eyebrow: s.eyebrow,
      heading: s.heading,
      narration: s.narration,
      say: s.say,
      visual: s.visual,
    })),
  };
}

describe('English output (baseline)', () => {
  it('speaks identifiers, constants, and paths as words', () => {
    const inputs = [
      'The key change is in src/cart/totals.ts, which adds useCartTotals.',
      'It reads USERS_PAGE_SIZE and MAX_RETRIES from the environment.',
      'The styles live in styles/pricing.css and app.js → index.html.',
      'Calling `getUsers` in the the api module returns JSON from the API.',
      'Covi adds the c2-delegate CLI and a **bold** _note_ about snake_case_names.',
      'Version v1.47.0 of README.md ships with config.yaml and Cargo.toml.',
    ];
    expect(inputs.map((i) => [i, spoken(i)])).toMatchSnapshot();
  });

  for (const example of examples) {
    describe(example.name, () => {
      it('writes the same rule findings, explanation, and reports', async () => {
        const { change, context, rules, review, explanation } = await analyze(example.name);
        expect({ findings: rules.findings, checked: rules.checked }).toMatchSnapshot('rules');
        expect(explanation).toMatchSnapshot('explanation');
        expect(review.summary).toMatchSnapshot('review summary');
        expect(review.notVerified).toMatchSnapshot('not verified');
        expect(renderExplanation(explanation, context)).toMatchSnapshot('explanation.md');
        expect(renderReview(review, explanation, context)).toMatchSnapshot('review.md');
        expect(renderSummary(explanation, review, context)).toMatchSnapshot('summary.md');
        expect(renderSummary(explanation, review, context, 'text')).toMatchSnapshot('summary.txt');
        expect(
          renderComment(review, explanation, context, {
            video: { url: 'https://example.com/v.mp4', seconds: 31 },
            artifacts: 'https://example.com/artifacts',
            run: 'https://example.com/run',
          }),
        ).toMatchSnapshot('comment.md');
        expect(
          renderBrief(change, context, rules.findings, {
            runDir: '.covi/runs/20260901-090000-analyze-0000000',
            runId: '20260901-090000-analyze-0000000',
            redactor: new Redactor(),
            maxDiffChars: 120_000,
          }),
        ).toMatchSnapshot('brief.md');
      });

      it('drafts the same storyboards and captions', async () => {
        const { change, context, review, explanation, config } = await analyze(example.name);
        const templates = await loadTemplates();
        for (const mode of ['short', 'standard'] as const) {
          for (const demo of [undefined, DEMO]) {
            const spec = resolveVideoSpec(config, { mode });
            const storyboard = draftStoryboard({
              change,
              context,
              explanation,
              review,
              demo,
              spec,
              templates,
            });
            const label = `${mode}${demo ? ' with demo' : ''}`;
            expect(words(storyboard)).toMatchSnapshot(`storyboard ${label}`);
            const orientation = mode === 'short' ? 'vertical' : 'landscape';
            const options = captionOptionsFor(orientation);
            expect(
              storyboard.scenes.map((s) => chunkCaption(s.narration, options)),
            ).toMatchSnapshot(`captions ${label}`);
          }
        }
      });
    });
  }

  it('drafts every template the same way', async () => {
    const { change, context, review, explanation, config } = await analyze('ui-comment-composer');
    const templates = await loadTemplates();
    for (const id of templates.keys()) {
      for (const mode of ['short', 'standard'] as const) {
        const storyboard = draftStoryboard({
          change,
          context,
          explanation,
          review,
          demo: DEMO,
          spec: resolveVideoSpec(config, { mode }),
          templates,
          templateId: id,
        });
        expect(words(storyboard)).toMatchSnapshot(`${id} ${mode}`);
      }
    }
  });

  it('times and wraps captions the same way', () => {
    const text =
      'This change updates the comment flow to use optimistic updates. The comment now appears immediately, while the request runs in the background; failures roll back. Short one. And a much longer sentence that keeps going well past the width of a single caption line, so it must wrap.';
    for (const orientation of ['vertical', 'landscape', 'square'] as const) {
      const options = captionOptionsFor(orientation);
      expect(chunkCaption(text, options)).toMatchSnapshot(`chunks ${orientation}`);
      expect(buildCaptions([{ text, start: 1.2, end: 17.8 }], options)).toMatchSnapshot(
        `cues ${orientation}`,
      );
    }
  });

  it('renders the same demonstration notes', () => {
    expect(renderDemo(DEMO)).toMatchSnapshot();
  });
});
