import { rmSync } from 'node:fs';
import {
  buildReview,
  type Demonstration,
  explainHeuristically,
  Git,
  loadRepositoryConfig,
  parseConfigInput,
  resolveChange,
  resolveConfig,
  runRules,
  understandChange,
} from '@covi/core';
import {
  decideVideo,
  draftStoryboard,
  loadTemplates,
  resolveVideoSpec,
  type Storyboard,
  StoryboardSchema,
  selectTemplate,
} from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';

const examples = await listExamples();
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function analyzeExample(name: string) {
  const example = examples.find((e) => e.name === name)!;
  const dir = await materializeExample(example);
  dirs.push(dir);
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
  return { example, dir, config, change, context, rules, review, explanation };
}

describe('example changes', () => {
  it('ships the five reference scenarios', () => {
    expect(examples.map((e) => e.name)).toEqual([
      'api-users-pagination',
      'bugfix-cli-slugify',
      'refactor-retry-helper',
      'ui-comment-composer',
      'visual-pricing-cards',
    ]);
  });

  for (const example of examples) {
    describe(example.name, () => {
      it('is understood, reviewed, and judged as expected', async () => {
        const { context, rules, review, config } = await analyzeExample(example.name);
        const expect_ = example.expect;
        expect(context.intent.kind).toBe(expect_.intent);
        expect(context.demonstration.value).toBe(expect_.demonstration);
        expect(decideVideo(context, { when: config.video.when }).render).toBe(expect_.video);
        expect(rules.findings.map((f) => f.source.id).sort()).toEqual([...expect_.rules].sort());
        if (expect_.verdict && expect_.demoFindings.length === 0)
          expect(review.verdict).toBe(expect_.verdict);
        if (expect_.template) {
          const evidence = { hasScreenshots: false, hasTerminal: false, hasApi: false };
          expect(selectTemplate(context, evidence).id).toBe(expect_.template);
        }
      });

      it('drafts valid storyboards for short and standard videos', async () => {
        const { change, context, review, explanation, config } = await analyzeExample(example.name);
        const templates = await loadTemplates();
        for (const mode of ['short', 'standard'] as const) {
          const spec = resolveVideoSpec(config, { mode });
          const storyboard = draftStoryboard({
            change,
            context,
            explanation,
            review,
            spec,
            templates,
          });
          expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
          expect(storyboard.scenes[0]!.visual.kind).toBe('title');
          expect(storyboard.scenes.at(-1)!.visual.kind).toBe('summary');
          expect(storyboard.scenes.length).toBeGreaterThanOrEqual(3);
          const words = storyboard.scenes.reduce(
            (n, s) => n + s.narration.split(/\s+/).filter(Boolean).length,
            0,
          );
          // Narration stays within the speech budget of the target duration (about 2.5 words per second).
          expect(words).toBeLessThanOrEqual(spec.duration.target * 2.5 + 15);
          for (const scene of storyboard.scenes) {
            expect(scene.narration).not.toMatch(/…|\.\./);
            expect(scene.narration).not.toMatch(/`/);
          }
        }
      });
    });
  }
});

describe('templates', () => {
  it('load and validate, with short-form beats drawn from each template', async () => {
    const templates = await loadTemplates();
    expect([...templates.keys()].sort()).toEqual([
      'api-change',
      'architecture-explainer',
      'before-after',
      'bug-fix',
      'cli-change',
      'feature-demo',
      'quick-review',
    ]);
    for (const t of templates.values()) {
      expect(t.beats[0]!.visuals).toContain('title');
      expect(t.beats.at(-1)!.visuals).toContain('summary');
    }
  });

  it('can be forced for any change', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('refactor-retry-helper');
    const templates = await loadTemplates();
    for (const id of templates.keys()) {
      const storyboard = draftStoryboard({
        change,
        context,
        explanation,
        review,
        spec: resolveVideoSpec(config, { mode: 'standard' }),
        templates,
        templateId: id,
      });
      expect(storyboard.template).toBe(id);
      expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
    }
  });
});

describe('standard-length narration', () => {
  it('goes deeper than a short video, using only what was observed', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('api-users-pagination');
    const templates = await loadTemplates();
    const demo: Demonstration = {
      schemaVersion: 1,
      shots: [],
      commands: [],
      skipped: [],
      findings: [],
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
    };
    const draft = (mode: 'short' | 'standard') =>
      draftStoryboard({
        change,
        context,
        explanation,
        review,
        demo,
        spec: resolveVideoSpec(config, { mode }),
        templates,
      });
    const words = (s: Storyboard) =>
      s.scenes.reduce((n, scene) => n + scene.narration.split(/\s+/).length, 0);
    const standard = draft('standard');
    expect(words(standard)).toBeGreaterThan(words(draft('short')) * 1.5);

    const scene = (kind: string) => standard.scenes.find((s) => s.visual.kind === kind)!;
    expect(scene('title').narration).toContain(
      "We'll look at the response before and after, the code behind it, and what to check before merging.",
    );
    expect(scene('api').narration).toContain(
      'The old response listed 3 entries; the new items array holds 1.',
    );
    // Identifiers survive Markdown stripping on screen and are spoken as words.
    expect(scene('code').narration).toContain('USERS_PAGE_SIZE');
    expect(scene('code').say).toContain('users page size');
    // Risks alone do not block, so the close points at where to start reading.
    expect(review.verdict).toBe('looks-good');
    expect(scene('summary').narration).toContain('If you read the diff, start with app.js.');
    // The number of findings it announces is the number it names.
    const findings = scene('findings').narration;
    const announced = /^(Two|Three) things/.exec(findings)?.[1];
    expect(announced).toBeDefined();
    expect(findings.includes('Third,')).toBe(announced === 'Three');

    // With a blocking finding, the close names the suggested next step instead.
    const blocking = {
      ...review,
      verdict: 'needs-changes' as const,
      findings: [
        {
          ...review.findings[0]!,
          certainty: 'confirmed' as const,
          severity: 'high' as const,
          suggestion: 'Version the endpoint.',
        },
      ],
    };
    const closing = draftStoryboard({
      change,
      context,
      explanation,
      review: blocking,
      demo,
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates,
    }).scenes.at(-1)!;
    expect(closing.narration).toBe(
      'This needs changes before it can merge. Suggested next step: version the endpoint.',
    );
  });
});

describe('repository configuration in examples', () => {
  it('parses every example config', async () => {
    for (const example of examples) {
      const dir = await materializeExample(example);
      dirs.push(dir);
      const loaded = await loadRepositoryConfig(dir, { kind: 'worktree' });
      if (loaded.values) expect(() => parseConfigInput(loaded.values, example.name)).not.toThrow();
    }
  });
});
