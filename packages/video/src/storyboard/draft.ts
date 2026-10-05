import {
  type ChangedFile,
  type CodeChange,
  type Demonstration,
  type DemoRequestResult,
  type DemoShot,
  type Explanation,
  ensurePeriod,
  type Finding,
  humanizeIdentifier,
  intentSentence,
  isImperativeVerb,
  joinList,
  lowerFirst,
  plural,
  type Review,
  type ReviewContext,
  sentenceCase,
  truncate,
  wordCount,
} from '@covi/core';
import type { VideoSpec } from '../spec.ts';
import { type Beat, type StoryTemplate, selectTemplate } from '../templates.ts';
import type { Scene, Storyboard, Visual } from './schema.ts';

export interface DraftInput {
  change: CodeChange;
  context: ReviewContext;
  explanation: Explanation;
  review: Review;
  demo?: Demonstration;
  spec: VideoSpec;
  templates: Map<string, StoryTemplate>;
  templateId?: string;
}

/** Natural speech for narration: ~2.5 words per second. */
export const WORDS_PER_SECOND = 2.5;

const BEAT_WEIGHT: Record<string, number> = { context: 0.8, summary: 0.8, review: 1.2, scope: 0.7 };

export function draftStoryboard(input: DraftInput): Storyboard {
  const evidence = {
    hasScreenshots: Boolean(input.demo?.shots.some((s) => s.after)),
    hasTerminal: Boolean(input.demo?.commands.length),
    hasApi: Boolean(input.demo?.requests.length),
  };
  const choice = input.templateId
    ? { id: input.templateId, reason: 'requested' }
    : selectTemplate(input.context, evidence);
  const template = input.templates.get(choice.id) ?? input.templates.get('quick-review');
  if (!template) throw new Error(`Unknown story template: ${choice.id}`);

  const short = input.spec.mode === 'short' || input.spec.duration.target <= 45;
  const beats = short
    ? template.short.map((id) => template.beats.find((b) => b.id === id)!)
    : template.beats;

  // Speech budget: leave room for visual holds and transitions. Longer videos carry more of their
  // length in narration; holds that only stretch time make them feel slow.
  const speechSeconds = input.spec.duration.target * (short ? 0.8 : 0.85);
  const weights = beats.map((b) => BEAT_WEIGHT[b.id] ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const used = new Set<string>();
  const ctx: BeatContext = {
    ...input,
    short,
    used,
    vertical: input.spec.height > input.spec.width,
  };

  const scenes: Scene[] = [];
  const budgets: number[] = [];
  beats.forEach((beat, i) => {
    const budget = Math.max(
      6,
      Math.round((speechSeconds * WORDS_PER_SECOND * weights[i]!) / totalWeight),
    );
    const scene = buildScene(beat, budget, ctx);
    if (scene) {
      scenes.push(scene);
      budgets.push(budget);
    }
  });
  if (scenes.length < 2) {
    scenes.push(
      buildScene(
        {
          id: 'summary',
          eyebrow: 'Summary',
          goal: '',
          visuals: ['summary'],
          expression: 'success',
          optional: false,
        },
        20,
        ctx,
      )!,
    );
  }
  if (!short) addRoadmap(scenes, budgets[0] ?? 0);
  return {
    schemaVersion: 1,
    title: truncate(input.explanation.headline, 90),
    template: template.id,
    draft: true,
    scenes: scenes.map((s, i) => ({ ...s, id: `s${i + 1}` })),
  };
}

interface BeatContext extends DraftInput {
  short: boolean;
  vertical: boolean;
  used: Set<string>;
}

function buildScene(beat: Beat, budget: number, ctx: BeatContext): Scene | undefined {
  for (const token of beat.visuals) {
    const [kind, variant] = token.split(':') as [Visual['kind'], 'before' | 'after' | undefined];
    const key = `${kind}:${variant ?? ''}`;
    if (ctx.used.has(key) && kind !== 'code') continue;
    const visual = makeVisual(kind, variant, beat, ctx);
    if (!visual) continue;
    ctx.used.add(key);
    const narration = narrate(beat, visual, ctx, budget);
    const text = fitWords(narration.text, budget);
    return {
      beat: beat.id,
      eyebrow: beat.eyebrow,
      heading: narration.heading,
      narration: text,
      say: narration.say ? fitWords(narration.say, budget + 6) : spoken(text),
      visual,
      expression: expressionFor(beat, ctx),
      optional: beat.optional || undefined,
    };
  }
  return beat.optional ? undefined : fallbackScene(beat, budget, ctx);
}

function fallbackScene(beat: Beat, budget: number, ctx: BeatContext): Scene | undefined {
  if (beat.id === 'context' || beat.id === 'summary') return undefined;
  const text = fitWords(stripMarkdown(firstSentence(ctx.explanation.summary)), budget);
  return {
    beat: beat.id,
    eyebrow: beat.eyebrow,
    narration: text,
    say: spoken(text),
    visual: {
      kind: 'callout',
      tone: 'info',
      title: truncate(ctx.explanation.headline, 90),
      body: truncate(stripMarkdown(ctx.explanation.summary), 220),
    },
    expression: 'explaining',
    optional: true,
  };
}

function expressionFor(beat: Beat, ctx: BeatContext): Scene['expression'] {
  const top = ctx.review.findings[0];
  if ((beat.id === 'review' || beat.id === 'summary') && ctx.review.verdict === 'needs-changes')
    return 'warning';
  if (beat.id === 'review' && top && top.severity === 'high') return 'warning';
  if (beat.id === 'summary' && ctx.review.verdict !== 'looks-good') return 'reviewing';
  return beat.expression;
}

// ---------------------------------------------------------------------------------------------
// Visuals from evidence
// ---------------------------------------------------------------------------------------------

function primaryShot(ctx: BeatContext, need: 'before' | 'after' | 'both'): DemoShot | undefined {
  const shots = (ctx.demo?.shots ?? []).filter((s) => s.kind === 'page');
  const ok = shots.filter((s) => (need === 'both' ? s.before && s.after : s[need]));
  const preferred = ctx.vertical ? 'mobile' : 'desktop';
  return ok.sort(
    (a, b) =>
      (b.diff?.changedRatio ?? 0) - (a.diff?.changedRatio ?? 0) ||
      Number(b.viewport === preferred) - Number(a.viewport === preferred),
  )[0];
}

function makeVisual(
  kind: Visual['kind'],
  variant: 'before' | 'after' | undefined,
  beat: Beat,
  ctx: BeatContext,
): Visual | undefined {
  const { context, explanation, review, change } = ctx;
  switch (kind) {
    case 'title': {
      const stats = change.stats;
      const meta = [
        change.repository.name,
        `${plural(context.size.files, 'file')} · +${stats.additions} −${stats.deletions}`,
      ];
      if (change.metadata.number)
        meta.unshift(
          `${change.metadata.platform === 'gitlab' ? '!' : '#'}${change.metadata.number}`,
        );
      return {
        kind: 'title',
        title: truncate(explanation.headline, 80),
        eyebrow: beat.eyebrow,
        meta,
      };
    }
    case 'change-map': {
      if (context.areas.length < 2) return undefined;
      return {
        kind: 'change-map',
        areas: context.areas.slice(0, 6).map((a) => ({
          name: a.name,
          surface: a.surfaces[0],
          additions: a.additions,
          deletions: a.deletions,
          files: a.files.length,
        })),
      };
    }
    case 'code':
      return codeVisual(beat, ctx);
    case 'screenshot': {
      const shot = primaryShot(ctx, variant ?? 'after');
      const image = shot?.[variant ?? 'after'];
      if (!shot || !image) return undefined;
      const focus = shot.focus ?? shot.diff?.bounds;
      return {
        kind: 'screenshot',
        image: { path: image.path, label: shot.name },
        focus,
        click: shot.click,
        label: shot.name,
        device: shot.viewport === 'mobile' ? 'mobile' : 'desktop',
      };
    }
    case 'before-after': {
      const shot = primaryShot(ctx, 'both');
      if (!shot?.before || !shot.after || (shot.diff && shot.diff.changedRatio < 0.0005))
        return undefined;
      return {
        kind: 'before-after',
        before: { path: shot.before.path, label: shot.name },
        after: { path: shot.after.path, label: shot.name },
        layout: ctx.vertical ? 'stack' : 'split',
        focus: shot.diff?.bounds,
        labels: { before: 'Before', after: 'After' },
      };
    }
    case 'interaction': {
      const steps = (ctx.demo?.shots ?? []).filter((s) => s.kind === 'flow-step' && s.after);
      const flow = steps[0]?.flow;
      const mine = steps.filter((s) => s.flow === flow).slice(0, ctx.short ? 4 : 6);
      if (mine.length < 2) return undefined;
      return {
        kind: 'interaction',
        steps: mine.map((s) => ({
          image: { path: s.after!.path },
          click: s.click,
          focus: s.focus,
          label: s.label,
        })),
      };
    }
    case 'terminal': {
      const cmd = ctx.demo?.commands.find((c) => c.changed) ?? ctx.demo?.commands[0];
      if (!cmd) return undefined;
      return {
        kind: 'terminal',
        title: cmd.name,
        command: cmd.command,
        output: clipLines(cmd.after.output, ctx.short ? 8 : 12),
        before:
          cmd.before && cmd.changed ? clipLines(cmd.before.output, ctx.short ? 6 : 10) : undefined,
      };
    }
    case 'api': {
      const req = ctx.demo?.requests.find((r) => r.changed) ?? ctx.demo?.requests[0];
      if (!req) return undefined;
      return {
        kind: 'api',
        method: req.method,
        path: req.path,
        before:
          req.before && req.changed
            ? {
                status: req.before.status,
                body: clipLines(prettyJson(req.before.body), ctx.short ? 9 : 14),
              }
            : undefined,
        after: {
          status: req.after.status,
          body: clipLines(prettyJson(req.after.body), ctx.short ? 9 : 14),
        },
      };
    }
    case 'findings': {
      if (review.findings.length === 0) return undefined;
      return {
        kind: 'findings',
        findings: review.findings.slice(0, ctx.short ? 2 : 3).map((f) => ({
          title: truncate(f.title, 90),
          certainty: f.certainty,
          severity: f.severity,
          location: f.location
            ? `${f.location.path}${f.location.line ? `:${f.location.line}` : ''}`
            : undefined,
          note: truncate(firstSentence(f.explanation), 120),
        })),
      };
    }
    case 'callout': {
      if (review.findings.length > 0) {
        const f = review.findings[0]!;
        return {
          kind: 'callout',
          tone: f.severity === 'high' ? 'warning' : 'info',
          title: truncate(f.title, 90),
          body: truncate(firstSentence(f.explanation), 160),
        };
      }
      const start = explanation.readingOrder[0];
      return {
        kind: 'callout',
        tone: 'success',
        title: 'No blocking issues found',
        body: start
          ? `Start the review with ${start.path}.`
          : 'The change looks sound in the areas Covi checked.',
      };
    }
    case 'diagram': {
      if (context.areas.length < 2) return undefined;
      const nodes = context.areas.slice(0, 6).map((a, i) => ({
        id: `n${i}`,
        label: a.name,
        changed: true,
        detail: `+${a.additions} −${a.deletions}`,
      }));
      return { kind: 'diagram', nodes, edges: inferEdges(ctx, nodes) };
    }
    case 'summary':
      return {
        kind: 'summary',
        verdict: review.verdict,
        headline: truncate(explanation.headline, 80),
        points: summaryPoints(ctx),
        stats: {
          files: context.size.files,
          additions: change.stats.additions,
          deletions: change.stats.deletions,
        },
      };
    default:
      return undefined;
  }
}

function codeVisual(beat: Beat, ctx: BeatContext): Visual | undefined {
  const order = ctx.context.readingOrder.map((s) => s.path);
  const wantStyles = beat.id === 'styles';
  const candidates = ctx.change.files
    .filter(
      (f) =>
        !f.ignored &&
        !f.binary &&
        f.hunks.length > 0 &&
        f.category !== 'lockfile' &&
        f.category !== 'test',
    )
    .filter((f) => (wantStyles ? f.category === 'style' : f.category !== 'docs'))
    .sort((a, b) => rank(order, a.path) - rank(order, b.path));
  const usedPaths = [...ctx.used].filter((k) => k.startsWith('codefile:')).map((k) => k.slice(9));
  const file = candidates.find((f) => !usedPaths.includes(f.path)) ?? candidates[0];
  if (!file) return undefined;
  ctx.used.add(`codefile:${file.path}`);
  const maxLines = ctx.short ? 11 : 15;
  const { lines, highlight } = excerpt(file, maxLines);
  if (lines.length === 0) return undefined;
  return { kind: 'code', path: file.path, language: file.language, lines, highlight };
}

function rank(order: string[], path: string): number {
  const i = order.indexOf(path);
  return i === -1 ? 999 : i;
}

/** The densest window of changes in a file, trimmed to fit on screen. */
/** Lines worth showing: logic beats boilerplate (lookups, imports, blank lines). */
function lineScore(l: { kind: string; text: string }): number {
  const t = l.text.trim();
  if (!t || /^(import|from|\/\/|#|\*|\/\*)/.test(t)) return 0;
  let score = l.kind === 'context' ? 0.2 : 1;
  if (
    /\b(function|def|func|fn|class|return|if|else|for|while|switch|case|await|throw|catch|=>)\b|=>/.test(
      t,
    )
  )
    score += 1.2;
  if (/getElementById|querySelector|require\(|^const \w+ = document/.test(t)) score -= 0.6;
  return Math.max(0, score);
}

/** The window of a file's changes that best shows the logic, trimmed to fit on screen. */
export function excerpt(
  file: ChangedFile,
  maxLines: number,
): {
  lines: Array<{ type: 'add' | 'del' | 'context'; text: string; number?: number }>;
  highlight: number[];
} {
  let best: { hunk: ChangedFile['hunks'][number]; start: number; score: number } | undefined;
  for (const hunk of file.hunks) {
    const scores = hunk.lines.map(lineScore);
    for (let start = 0; start <= Math.max(0, hunk.lines.length - maxLines); start++) {
      const score = scores.slice(start, start + maxLines).reduce((a, b) => a + b, 0);
      if (!best || score > best.score + 0.01) best = { hunk, start, score };
    }
  }
  if (!best) return { lines: [], highlight: [] };
  // Start the window at a line that reads as a beginning (a declaration or a blank line before one).
  let start = best.start;
  const all = best.hunk.lines;
  for (let i = start; i > Math.max(0, start - 3); i--) {
    if (
      /^\s*(export\s+)?(async\s+)?(function|def|func|class|const|let|fn|pub)\b/.test(all[i]!.text)
    ) {
      start = i;
      break;
    }
  }
  const slice = all.slice(start, start + maxLines);
  const lines = slice.map((l) => ({
    type: l.kind,
    text: l.text.replace(/\t/g, '  ').slice(0, 96),
    number: l.kind === 'del' ? l.oldLine : l.newLine,
  }));
  // Emphasize the strongest added lines (logic over comments and lookups), keeping file order.
  const highlight = lines
    .map((l, i) => ({ i, score: l.type === 'add' ? lineScore({ kind: 'add', text: l.text }) : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.i)
    .sort((a, b) => a - b);
  return { lines, highlight };
}

function inferEdges(
  ctx: BeatContext,
  nodes: Array<{ id: string; label: string }>,
): Array<{ from: string; to: string }> {
  const areaOf = new Map<string, string>();
  ctx.context.areas.slice(0, nodes.length).forEach((a, i) => {
    for (const f of a.files) areaOf.set(f, `n${i}`);
  });
  const edges = new Map<string, { from: string; to: string }>();
  for (const f of ctx.change.files) {
    const from = areaOf.get(f.path);
    if (!from) continue;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.kind !== 'add') continue;
        const m = /(?:from|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/.exec(l.text);
        if (!m) continue;
        const target = resolveRelative(f.path, m[1]!);
        for (const [path, id] of areaOf) {
          if (id !== from && path.startsWith(target)) edges.set(`${from}>${id}`, { from, to: id });
        }
      }
    }
  }
  return [...edges.values()].slice(0, 8);
}

function resolveRelative(from: string, rel: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/').replace(/\.(t|j)sx?$/, '');
}

function summaryPoints(ctx: BeatContext): string[] {
  const points: string[] = [];
  for (const f of ctx.review.findings.slice(0, 2))
    points.push(
      `${sentenceCase(f.certainty === 'question' ? 'Question' : f.certainty)}: ${truncate(f.title, 70)}`,
    );
  for (const c of ctx.explanation.changes) {
    if (points.length >= 3) break;
    points.push(`${c.area}: ${truncate(stripMarkdown(c.description), 70)}`);
  }
  if (ctx.context.tests.addedTestCases > 0 && points.length < 4)
    points.push(`${plural(ctx.context.tests.addedTestCases, 'new test')}`);
  return points.slice(0, ctx.short ? 3 : 4);
}

// ---------------------------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------------------------

interface Narration {
  text: string;
  say?: string;
  heading?: string;
}

function narrate(beat: Beat, visual: Visual, ctx: BeatContext, budget: number): Narration {
  const { context, review } = ctx;
  switch (visual.kind) {
    case 'title': {
      const lead = stripMarkdown(intentSentence(context));
      const where =
        context.areas.length > 1
          ? ` It touches ${joinList(context.areas.slice(0, 2).map((a) => a.name))}.`
          : '';
      return { text: lead + (ctx.short ? '' : where) };
    }
    case 'change-map':
      return {
        text: `The change spans ${plural(context.areas.length, 'area')}, mostly ${joinList(context.areas.slice(0, 2).map((a) => a.name))}.`,
        heading: `${plural(context.size.files, 'file')} changed`,
      };
    case 'code': {
      const file = visual.path.split('/').pop() ?? visual.path;
      const named = keySymbols(context, visual.path, visual.lines.map((l) => l.text).join('\n'));
      const verb = named.every((s) => s.change === 'added') ? 'adds' : 'updates';
      const what = named.length ? `, which ${verb} ${joinList(named.map((s) => s.name))}` : '';
      const lead =
        beat.id === 'fix'
          ? 'The fix lives in'
          : beat.id === 'styles'
            ? 'The styles live in'
            : 'The key change is in';
      const description = ctx.short ? undefined : areaDescription(ctx, visual.path);
      if (description)
        return {
          text: `${lead} ${file}. ${description}`,
          say: `${lead} ${spokenFile(file)}. ${spoken(description)}`,
          heading: visual.path,
        };
      const text = `${lead} ${file}${what}.`;
      const say = `${lead} ${spokenFile(file)}${named.length ? `, which ${verb} ${joinList(named.map((s) => humanizeIdentifier(s.name)))}` : ''}.`;
      return { text, say, heading: visual.path };
    }
    case 'screenshot':
      return visual.image.path.includes('before')
        ? { text: `Here's ${visual.label ?? 'the page'} before the change.`, heading: visual.label }
        : {
            text: `And here's ${visual.label === '/' ? 'the page' : (visual.label ?? 'the page')} after the change${visual.focus ? ', with the changed area highlighted' : ''}.`,
            heading: visual.label,
          };
    case 'before-after': {
      const order =
        visual.layout === 'stack'
          ? 'On top is the old version; below, the new one.'
          : 'On the left is the old version; on the right, the new one.';
      const page =
        visual.after.label && visual.after.label !== '/' ? ` of ${visual.after.label}` : '';
      return {
        text: `${ctx.context.intent.kind === 'bug-fix' ? 'Here is the behavior before and after the fix' : `Here's the before and after${page}`}. ${order}`,
        heading: visual.after.label,
      };
    }
    case 'interaction': {
      const labels = (visual.steps.map((s) => s.label).filter(Boolean) as string[]).slice(
        0,
        ctx.short ? 2 : 3,
      );
      return {
        text:
          labels.length >= 2
            ? `Here's the new flow. ${sentenceCase(joinList(labels.map(asClause)))}.`
            : 'Here is the new flow, step by step.',
      };
    }
    case 'terminal': {
      const first = visual.output.split('\n').find((l) => l.trim()) ?? '';
      // The terminal shows the exact command; narration describes it instead of reading it out.
      const output = first.trim();
      const cmd = ctx.demo?.commands.find((c) => c.name === visual.title);
      const exit =
        !ctx.short && cmd?.before && cmd.before.exitCode !== cmd.after.exitCode
          ? ` It now exits with code ${cmd.after.exitCode ?? 'none'} instead of ${cmd.before.exitCode ?? 'none'}.`
          : '';
      const text = visual.before
        ? `Here's the same command before and after the change.${output && output.length <= 40 ? ` It now prints ${output}.` : ''}${exit}`
        : `Here's the command's output after the change.`;
      return { text, say: spoken(text), heading: visual.title };
    }
    case 'api': {
      const req = ctx.demo?.requests.find((r) => r.path === visual.path);
      const shape = req?.shapeChange ? ` ${sentenceCase(req.shapeChange)}.` : '';
      const detail = req && !ctx.short && visual.before ? exchangeDetail(req) : '';
      const more = `${shape}${detail ? ` ${detail}` : ''}`;
      return {
        text: `Calling ${visual.method} ${visual.path}${visual.before ? ' before and after the change' : ''}.${more}`,
        say: `Calling ${visual.method} ${spokenPath(visual.path)}${visual.before ? ', before and after the change' : ''}.${more ? ` ${spoken(more)}` : ''}`,
        heading: `${visual.method} ${visual.path}`,
      };
    }
    case 'findings': {
      if (!ctx.short)
        return {
          text: findingsNarration(review.findings, budget),
          heading: headingForFindings(review.findings),
        };
      const [first, second] = review.findings;
      const lead =
        review.findings.length === 1
          ? 'One thing worth reviewing'
          : `${review.findings.length === 2 ? 'Two' : 'A few'} things worth a look. First`;
      const firstText = `${lead}: ${lowerFirstWord(stripMarkdown(first!.title))}.`;
      const why = ctx.short ? '' : ` ${firstSentence(first!.explanation)}`;
      const secondText =
        second && !ctx.short ? ` Also, ${lowerFirstWord(stripMarkdown(second.title))}.` : '';
      return { text: firstText + why + secondText, heading: headingForFindings(review.findings) };
    }
    case 'callout':
      return visual.tone === 'success'
        ? { text: `Covi didn't find blocking issues.${visual.body ? ` ${visual.body}` : ''}` }
        : { text: `Worth checking: ${lowerFirstWord(visual.title)}.` };
    case 'diagram':
      return {
        text: `Here's how the moved pieces relate now; every highlighted module changed in this diff.`,
        heading: 'Module map',
      };
    case 'summary': {
      const verdict =
        review.verdict === 'looks-good'
          ? 'Overall, this looks good to merge.'
          : review.verdict === 'needs-changes'
            ? 'This needs changes before it can merge.'
            : `It needs a closer look at ${plural(review.findings.length, 'spot')} before merging.`;
      const tests =
        context.tests.addedTestCases > 0
          ? ` It comes with ${plural(context.tests.addedTestCases, 'new test')}.`
          : '';
      if (ctx.short) return { text: verdict };
      const suggestion =
        review.verdict !== 'looks-good' ? review.findings[0]?.suggestion : undefined;
      const start = ctx.explanation.readingOrder[0]?.path;
      const next = suggestion
        ? ` Suggested next step: ${lowerFirstWord(ensurePeriod(stripMarkdown(suggestion)))}`
        : review.verdict === 'looks-good' && start
          ? ` If you read the diff, start with ${start}.`
          : '';
      return { text: verdict + tests + next };
    }
  }
}

/** Standard videos open with a one-line map of what is coming, taken from the scenes that follow. */
function addRoadmap(scenes: Scene[], budget: number): void {
  const [first, ...rest] = scenes;
  if (first?.visual.kind !== 'title' || rest.length < 3) return;
  const stops = [
    ...new Set(rest.map((s) => roadmapStop(s.visual)).filter((x): x is string => Boolean(x))),
  ];
  if (stops.length < 2) return;
  const text = `${first.narration} We'll look at ${joinList(stops)}.`;
  // A little over budget is fine for one orienting sentence; a long one is not.
  if (wordCount(text) > Math.round(budget * 1.3)) return;
  first.narration = text;
  first.say = spoken(text);
}

function roadmapStop(visual: Visual): string | undefined {
  switch (visual.kind) {
    case 'api':
      return visual.before ? 'the response before and after' : 'the new response';
    case 'terminal':
      return visual.before ? 'the command before and after' : "the command's output";
    case 'before-after':
      return 'the page before and after';
    case 'screenshot':
      return 'what it looks like';
    case 'interaction':
      return 'the new flow';
    case 'code':
      return 'the code behind it';
    case 'diagram':
    case 'change-map':
      return 'how the pieces fit together';
    case 'findings':
      return 'what to check before merging';
    default:
      return undefined;
  }
}

/** The explanation's own words for the area a file belongs to, as a sentence about that file. */
function areaDescription(ctx: BeatContext, path: string): string | undefined {
  const change = ctx.explanation.changes.find((c) => c.files.includes(path));
  if (!change) return undefined;
  const clean = stripMarkdown(change.description).trim();
  const first = (clean.split(/\s+/)[0] ?? '').toLowerCase();
  // "Adds X, changes Y" reads as a clause about the file; anything else is already a sentence.
  const verb =
    first.endsWith('s') &&
    [first.replace(/ies$/, 'y'), first.replace(/es$/, ''), first.slice(0, -1)].some(
      isImperativeVerb,
    );
  return ensurePeriod(verb ? `It ${lowerFirst(clean)}` : clean);
}

/** What the captured responses show beyond their shape: status and size, from the real bodies. */
function exchangeDetail(req: DemoRequestResult): string {
  const parts: string[] = [];
  if (req.before && req.before.status !== req.after.status)
    parts.push(`The status changed from ${req.before.status} to ${req.after.status}.`);
  const before = parseJson(req.before?.body);
  const after = parseJson(req.after.body);
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
    parts.push(
      `It returned ${plural(before.length, 'entry', 'entries')} before and ${after.length} now.`,
    );
  } else if (Array.isArray(before) && isRecord(after)) {
    const lists = Object.entries(after).filter(([, v]) => Array.isArray(v));
    if (lists.length === 1) {
      const [key, list] = lists[0]! as [string, unknown[]];
      parts.push(
        `The old response listed ${plural(before.length, 'entry', 'entries')}; the new ${key} array holds ${list.length}.`,
      );
    }
  } else if (isRecord(before) && isRecord(after)) {
    const added = Object.keys(after).filter((k) => !(k in before));
    if (added.length) parts.push(`The response now also includes ${joinList(added.slice(0, 3))}.`);
  }
  return parts.join(' ');
}

/**
 * Names every finding on screen when the budget allows, with why the first ones matter. When it
 * does not, explanations go first, so the count it announces is always the count it covers.
 */
function findingsNarration(findings: readonly Finding[], budget: number): string {
  const shown = findings.slice(0, 3);
  const title = (f: Finding) => lowerFirstWord(stripMarkdown(f.title));
  const why = (f: Finding) => firstSentence(stripMarkdown(f.explanation));
  if (shown.length === 1)
    return `One thing worth reviewing: ${title(shown[0]!)}. ${why(shown[0]!)}`;
  const count = findings.length === shown.length ? { 2: 'Two', 3: 'Three' }[shown.length] : 'A few';
  const variant = (explained: number) =>
    [
      `${count} things worth a look.`,
      ...shown.flatMap((f, i) => [
        `${['First', 'Second', 'Third'][i]}, ${title(f)}.`,
        ...(i < explained ? [why(f)] : []),
      ]),
    ].join(' ');
  for (const explained of [2, 1, 0]) {
    const text = variant(explained);
    if (wordCount(text) <= budget) return text;
  }
  return variant(0);
}

function parseJson(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The symbols a code scene should name: functions shown on screen first, constants last. */
function keySymbols(context: ReviewContext, path: string, shown: string) {
  const rank = (kind: string) =>
    ['function', 'component', 'hook', 'class', 'route'].includes(kind) ? 0 : 1;
  return context.symbols
    .filter((s) => s.path === path && s.kind !== 'selector' && s.kind !== 'test')
    .sort(
      (a, b) =>
        Number(!shown.includes(a.name)) - Number(!shown.includes(b.name)) ||
        rank(a.kind) - rank(b.kind) ||
        Number(b.change === 'added') - Number(a.change === 'added'),
    )
    .slice(0, 2);
}

/** "Counter updates as you type" stays; "Type a comment" becomes "type a comment". */
function asClause(label: string): string {
  return lowerFirstWord(label.replace(/[.!]$/, ''));
}

function headingForFindings(findings: readonly Finding[]): string {
  const f = findings[0]!;
  const label = {
    confirmed: 'Confirmed issue',
    likely: 'Likely issue',
    risk: 'Risk worth checking',
    question: 'Open question',
  }[f.certainty];
  return findings.length === 1 ? label : `${findings.length} things to check`;
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/** Keeps whole sentences within the word budget (never cuts mid-sentence unless one sentence is too long). */
export function fitWords(text: string, budget: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (wordCount(clean) <= budget) return clean;
  // Sentence boundaries need whitespace after the punctuation, so "app.js" or "v1.2" stay whole.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (wordCount(next) > budget) break;
    out = next;
  }
  if (out) return out;
  // One sentence is already too long. A little over budget beats a broken sentence.
  const first = sentences[0]!;
  if (wordCount(first) <= Math.ceil(budget * 1.6)) return first;
  const words = first.split(' ');
  for (let i = Math.min(words.length - 1, budget); i > budget / 2; i--) {
    if (/[,;:]$/.test(words[i - 1]!) || /^(and|but|so|which|while|because)$/i.test(words[i]!)) {
      return `${words
        .slice(0, i)
        .join(' ')
        .replace(/[,;:]$/, '')}.`;
    }
  }
  return `${words
    .slice(0, budget)
    .join(' ')
    .replace(/[,;:]$/, '')}.`;
}

/** How a file is said aloud: "the app script", "the pricing stylesheet". */
const FILE_NOUN: Record<string, string> = {
  ts: 'module',
  js: 'script',
  mjs: 'script',
  cjs: 'script',
  tsx: 'component',
  jsx: 'component',
  css: 'stylesheet',
  scss: 'stylesheet',
  html: 'page',
  py: 'module',
  go: 'file',
  rs: 'module',
  rb: 'file',
  md: 'doc',
  json: 'config',
  yml: 'config',
  yaml: 'config',
  toml: 'config',
};

export function spoken(text: string): string {
  return (
    stripMarkdown(text)
      .replace(/\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g, (m) => humanizeIdentifier(m))
      // Constants and environment variables: USERS_PAGE_SIZE → "users page size".
      .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (m) => humanizeIdentifier(m))
      // Paths are said by their file: "src/cart/totals.ts" → "the totals module".
      .replace(
        /(?:[\w.-]+\/)*\b([\w-]+)\.(tsx?|jsx?|mjs|cjs|css|scss|py|go|rs|rb|md|json|ya?ml|toml|html)\b/g,
        (_m, name: string, ext: string) =>
          `the ${humanizeIdentifier(name)} ${FILE_NOUN[ext] ?? 'file'}`,
      )
      .replace(/\b(the|in|of) the /g, '$1 the ')
      .replace(/\bthe the\b/g, 'the')
      .replace(/→/g, ' to ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function spokenFile(file: string): string {
  return spoken(file);
}

function spokenPath(path: string): string {
  return path
    .replace(/^\//, '')
    .replace(/\//g, ' slash ')
    .replace(/[{}:[\]]/g, '');
}

function stripMarkdown(text: string): string {
  return (
    text
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      // Only _emphasis_ at word boundaries: USERS_PAGE_SIZE and snake_case names stay whole.
      .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1$2')
  );
}

function firstSentence(text: string): string {
  const m = /^[^.!?]+[.!?]/.exec(text.trim());
  return (m?.[0] ?? text).trim();
}

function lowerFirstWord(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const first = t.split(/\s+/)[0]!;
  if (/^[A-Z]{2,}/.test(first) || /[a-z][A-Z]/.test(first)) return t;
  return t[0]!.toLowerCase() + t.slice(1);
}

function clipLines(text: string, max: number): string {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  if (lines.length <= max) return lines.map((l) => l.slice(0, 90)).join('\n');
  return [
    ...lines.slice(0, max - 1).map((l) => l.slice(0, 90)),
    `… ${lines.length - max + 1} more lines`,
  ].join('\n');
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
