import { rmSync } from 'node:fs';
import {
  buildEvidence,
  buildReview,
  citeExplanation,
  type Demonstration,
  explainHeuristically,
  Git,
  hunksAt,
  indexEvidence,
  intentSentence,
  loadRepositoryConfig,
  parseConfigInput,
  resolveChange,
  resolveConfig,
  runRules,
  seedFrom,
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
  TRANSITION_MIN,
  TRANSITION_SHARE,
} from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { defaultDirection, entrances } from '../packages/video/src/direction/director.ts';
import { directionProblems } from '../packages/video/src/direction/refs.ts';
import { DirectionSchema } from '../packages/video/src/direction/schema.ts';
import { directionSources } from '../packages/video/src/direction/sources.ts';
import { groundingCheck, sceneEvidence } from '../packages/video/src/grounding.ts';

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
  it('ships the six reference scenarios', () => {
    expect(examples.map((e) => e.name)).toEqual([
      'api-users-pagination',
      'backend-slim-request',
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
          // A cold open: without captures the subject itself (code, a run, a response) comes
          // first; only a change with none of those keeps a title card.
          const subjects = ['code', 'terminal', 'api'];
          const first = storyboard.scenes[0]!.visual.kind;
          if (storyboard.scenes.some((s) => subjects.includes(s.visual.kind)))
            expect(subjects).toContain(first);
          else expect(first).toBe('title');
          expect(storyboard.scenes.filter((s) => s.hero).length).toBeLessThanOrEqual(1);
          expect(storyboard.scenes[0]!.optional).toBeUndefined();
          for (const s of storyboard.scenes) expect(s.narration).not.toMatch(/We'll look at/);
          // The fitter may drop an optional scene, never the hero.
          for (const s of storyboard.scenes.filter((s) => s.hero))
            expect(s.optional).toBeUndefined();
          // Nothing is said or shown twice: the opening sentence, or the same lines of code.
          const lead = intentSentence(context);
          for (const s of storyboard.scenes.slice(1)) expect(s.narration).not.toContain(lead);
          const code = storyboard.scenes
            .filter((s) => s.visual.kind === 'code')
            .map((s) => JSON.stringify(s.visual));
          expect(new Set(code).size).toBe(code.length);
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

      it('directs its drafted storyboards with shots Covi’s own checks accept', async () => {
        const { change, context, review, explanation, config } = await analyzeExample(example.name);
        const templates = await loadTemplates();
        const evidence = indexEvidence(buildEvidence({ diff: change.files }));
        const sources = directionSources({ files: change.files, evidence });
        for (const mode of ['short', 'standard'] as const) {
          const storyboard = draftStoryboard({
            change,
            context,
            explanation,
            review,
            spec: resolveVideoSpec(config, { mode }),
            templates,
          });
          const seed = seedFrom(storyboard.title);
          const plan = defaultDirection({ scenes: storyboard.scenes, evidence, seed, sources });
          expect(plan.shots.map((s) => s.scene)).toEqual(storyboard.scenes.map((s) => s.id));
          expect(DirectionSchema.parse(plan)).toEqual(plan);
          expect(directionProblems(plan, storyboard.scenes, evidence, sources)).toEqual([]);
          expect(defaultDirection({ scenes: storyboard.scenes, evidence, seed, sources })).toEqual(
            plan,
          );
          // A change with nothing to see shows its code changing: the benchmark morphs.
          const morphs = plan.shots.filter((s) => s.elements.some((e) => e.kind === 'morph'));
          if (example.name === 'backend-slim-request')
            expect(morphs.length, mode).toBeGreaterThan(0);
          // No entrance takes more of the story's moves than the transition-variety check allows.
          const moves = [...entrances(plan, storyboard.scenes, evidence, seed).values()];
          if (moves.length >= TRANSITION_MIN)
            for (const kind of new Set(moves))
              expect(
                moves.filter((k) => k === kind).length / moves.length,
                kind,
              ).toBeLessThanOrEqual(TRANSITION_SHARE);
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

describe('the drafted opening and hero', () => {
  it('puts the title over the most-changed capture when a page was captured', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('visual-pricing-cards');
    const image = (path: string) => ({ path, width: 1280, height: 800 });
    const shot = (id: string, changedRatio: number) => ({
      id,
      kind: 'page' as const,
      name: `/${id}`,
      viewport: 'desktop' as const,
      before: image(`demo/screenshots/${id}-before.png`),
      after: image(`demo/screenshots/${id}-after.png`),
      diff: { changedRatio, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    });
    const demo: Demonstration = {
      schemaVersion: 1,
      shots: [shot('faq', 0.01), shot('pricing', 0.2)],
      commands: [],
      requests: [],
      skipped: [],
      findings: [],
    };
    const storyboard = draftStoryboard({
      change,
      context,
      explanation,
      review,
      demo,
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates: await loadTemplates(),
    });
    expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
    const opening = storyboard.scenes[0]!;
    expect(opening.visual).toMatchObject({
      kind: 'title',
      background: { path: 'demo/screenshots/pricing-after.png', label: '/pricing' },
    });
    const heroes = storyboard.scenes.filter((s) => s.hero);
    expect(heroes.map((s) => s.beat)).toEqual(['compare']);
    expect(heroes[0]!.optional).toBeUndefined();
  });

  it('leaves out a hero beat without evidence, and opens on the hero when it is all there is', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('bugfix-cli-slugify');
    for (const mode of ['short', 'standard'] as const) {
      const storyboard = draftStoryboard({
        change,
        context,
        explanation,
        review,
        spec: resolveVideoSpec(config, { mode }),
        templates: await loadTemplates(),
      });
      expect(storyboard.template).toBe('bug-fix');
      // Nothing showed the fixed behavior, so there is no proof scene (and no callout for it).
      expect(storyboard.scenes.some((s) => s.beat === 'proof')).toBe(false);
      // The fix is the only scene that shows the subject: it opens the video, as its hero.
      expect(storyboard.scenes[0]).toMatchObject({ beat: 'fix', hero: true });
      expect(storyboard.scenes[0]!.optional).toBeUndefined();
      expect(storyboard.scenes.filter((s) => s.hero)).toHaveLength(1);
      // The "Before" callout only repeated the opening sentence, so it is gone with it.
      expect(storyboard.scenes.map((s) => s.beat)).toEqual(['fix', 'review', 'summary']);
    }
  });

  it('opens on the hero when the other subject shows the same lines, and never shows them twice', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('api-users-pagination');
    const storyboard = draftStoryboard({
      change,
      context,
      explanation,
      review,
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates: await loadTemplates(),
    });
    // Without a captured response, the exchange and the handler both show app.js.
    expect(storyboard.scenes.map((s) => s.beat)).toEqual(['exchange', 'review', 'summary']);
    expect(storyboard.scenes[0]).toMatchObject({
      hero: true,
      eyebrow: 'Paginate GET /api/users',
      visual: { kind: 'code', path: 'app.js' },
    });
    expect(storyboard.scenes[0]!.narration).toMatch(
      /^Now it paginates GET \/api\/users\. The key change is in app\.js/,
    );
  });

  it('opens on the change itself, never "This change …", and calls the root page the home page', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('ui-comment-composer');
    const image = (path: string) => ({ path, width: 1280, height: 800 });
    const demo: Demonstration = {
      schemaVersion: 1,
      shots: [
        {
          id: 'home',
          kind: 'page',
          name: '/',
          viewport: 'desktop',
          before: image('demo/screenshots/home-before.png'),
          after: image('demo/screenshots/home-after.png'),
          diff: { changedRatio: 0.2, bounds: { x: 0, y: 0, width: 100, height: 100 } },
        },
      ],
      commands: [],
      requests: [],
      skipped: [],
      findings: [],
    };
    for (const mode of ['short', 'standard'] as const) {
      const storyboard = draftStoryboard({
        change,
        context,
        explanation,
        review,
        demo,
        spec: resolveVideoSpec(config, { mode }),
        templates: await loadTemplates(),
      });
      const [opening, ...rest] = storyboard.scenes;
      expect(opening!.narration).not.toMatch(/^This change/);
      expect(opening!.narration).toBe(
        'Now it shows remaining characters and blocks overlong comments.',
      );
      // The browser chrome keeps the URL; what is read and heard names the page.
      expect(opening!.visual).toMatchObject({ background: { label: '/' } });
      for (const scene of rest) {
        expect(scene.heading, scene.beat).not.toBe('/');
        expect(scene.narration, scene.beat).not.toMatch(/(^|\s)\/(?=[\s.,]|$)/);
      }
      expect(rest.map((s) => s.narration).join(' ')).toContain('the home page');
    }
  });

  it('shortens a long title to whole characters, never half of one', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('api-users-pagination');
    const storyboard = draftStoryboard({
      change,
      context,
      explanation: { ...explanation, headline: '𠮷'.repeat(40) },
      review,
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates: await loadTemplates(),
    });
    // 40 characters, 80 UTF-16 units: the cut counts characters, so no surrogate is split.
    expect(storyboard.scenes[0]!.eyebrow).toBe(`${'𠮷'.repeat(31)}…`);
  });

  it('keeps the title card when nothing shows the subject', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('refactor-retry-helper');
    const storyboard = draftStoryboard({
      change: { ...change, files: [] },
      context,
      explanation,
      review,
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates: await loadTemplates(),
    });
    const opening = storyboard.scenes[0]!;
    expect(opening.visual.kind).toBe('title');
    expect((opening.visual as { background?: unknown }).background).toBeUndefined();
    // The opening line is the intent alone: no list of areas, no table of contents.
    expect(opening.narration).toBe(
      'Now it extracts backoff calculation from the retry loop in http.',
    );
  });

  it('never lets text from the change write [[…]] markup into a line', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('api-users-pagination');
    const marked = (text: string) => `[[${text}]] ]] [[`;
    const storyboard = draftStoryboard({
      change,
      context: { ...context, intent: { ...context.intent, summary: marked('Paginate users') } },
      explanation: {
        ...explanation,
        headline: marked(explanation.headline),
        summary: marked(explanation.summary),
        changes: explanation.changes.map((c) => ({ ...c, description: marked(c.description) })),
      },
      review: {
        ...review,
        findings: review.findings.map((f) => ({
          ...f,
          title: marked(f.title),
          explanation: marked(f.explanation),
        })),
      },
      demo: {
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
            before: { status: 200, body: '[]' },
            after: { status: 200, body: '{"items":[]}' },
            shapeChange: marked('the response changed shape'),
          },
        ],
      },
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates: await loadTemplates(),
    });
    expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
    for (const s of storyboard.scenes) {
      expect(s.narration, s.beat).not.toMatch(/\[\[|\]\]/);
      expect(s.say ?? '', s.beat).not.toMatch(/\[\[|\]\]/);
    }
    // The cold open's eyebrow is the headline, shown without the markers; their text stays.
    const opening = storyboard.scenes[0]!;
    expect(opening.eyebrow).not.toMatch(/\[\[|\]\]/);
    expect(opening.narration).toContain('Paginate users');
  });
});

describe('drafted grounding', () => {
  it("grounds every scene Covi drafts in the run's evidence, its verdict callout too", async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('ui-comment-composer');
    expect(review.findings).toEqual([]);
    const evidence = indexEvidence(buildEvidence({ diff: change.files }));
    for (const mode of ['short', 'standard'] as const) {
      const storyboard = draftStoryboard({
        change,
        context,
        explanation,
        review,
        evidence,
        spec: resolveVideoSpec(config, { mode }),
        templates: await loadTemplates(),
      });
      const callout = storyboard.scenes.find((s) => s.visual.kind === 'callout');
      // No findings: the verdict rests on the reviewed hunks, every changed file's (four here).
      const hunks = evidence.items.filter((i) => i.kind === 'diff-hunk').map((i) => i.id);
      expect(hunks).toHaveLength(4);
      expect(callout?.evidenceIds, mode).toEqual(hunks);
      // As the pipeline checks it: what each scene cites and what its visual shows.
      const check = groundingCheck(
        storyboard.scenes.map((s) => ({
          id: s.id!,
          narration: s.narration,
          kind: s.visual.kind,
          evidenceIds: sceneEvidence(s, evidence, review.findings),
        })),
        citeExplanation(explanation, evidence),
      );
      expect(check, mode).toMatchObject({ status: 'pass' });
    }
  });

  it('cites the evidence of the finding a callout shows, else the hunks at its location', async () => {
    const { change, context, review, explanation, config } =
      await analyzeExample('api-users-pagination');
    const evidence = indexEvidence(buildEvidence({ diff: change.files }));
    // Every template shows findings as cards; a template whose review is a callout shows the top one.
    const quick = (await loadTemplates()).get('quick-review')!;
    const beats = quick.beats.map((b) => (b.id === 'review' ? { ...b, visuals: ['callout'] } : b));
    const templates = new Map([['quick-review', { ...quick, beats }]]);
    const callout = (findings: typeof review.findings) =>
      draftStoryboard({
        change,
        context,
        explanation,
        review: { ...review, findings },
        evidence,
        spec: resolveVideoSpec(config, { mode: 'standard' }),
        templates,
        templateId: 'quick-review',
      }).scenes.find((s) => s.visual.kind === 'callout')?.evidenceIds;
    const [top, ...rest] = review.findings;
    expect(top?.location).toBeDefined();
    const at = hunksAt(evidence, top!.location);
    expect(at.length).toBeGreaterThan(0);
    expect(callout(review.findings)).toEqual(at);
    // A cited id the run does not have is left out.
    const other = evidence.items.find((i) => i.kind === 'diff-hunk' && !at.includes(i.id))!.id;
    const cited = { ...top!, evidenceIds: [other, 'screenshot:gone'] };
    expect(callout([cited, ...rest])).toEqual([other]);
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
    // The cold open: no captures here, so the code moves to the front under a short title,
    // and the API exchange (the template's payoff) is the hero.
    const opening = standard.scenes[0]!;
    expect(opening.visual.kind).toBe('code');
    expect(opening.eyebrow).toBe('Paginate GET /api/users');
    expect(opening.heading).toBeUndefined();
    expect(opening.narration).toMatch(
      /^Now it paginates GET \/api\/users\. The key change is in app\.js/,
    );
    expect(standard.scenes.find((s) => s.hero)?.beat).toBe('exchange');
    expect(standard.scenes.some((s) => /We'll look at/.test(s.narration))).toBe(false);
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
