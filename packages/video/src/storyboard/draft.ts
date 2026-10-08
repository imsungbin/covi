import {
  type ChangedFile,
  type CodeChange,
  type Demonstration,
  type DemoRequestResult,
  type DemoShot,
  type Explanation,
  endSentence,
  ensurePeriod,
  type Finding,
  humanizeIdentifier,
  intentSentence,
  isImperativeVerb,
  joinSentences,
  type Language,
  listOf,
  lowerFirst,
  type Params,
  type Review,
  type ReviewContext,
  sentenceCase,
  t,
  truncate,
} from '@covi/core';
import type { VideoSpec } from '../spec.ts';
import { type Beat, heroScene, type StoryTemplate, selectTemplate } from '../templates.ts';
import { SPEECH_RATE, segments, speechUnits } from '../text.ts';
import { stripEmphasis } from './grammar.ts';
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
  /** The language to narrate in (the run's language). Default: English. */
  language?: Language;
}

/** Natural speech for narration: ~2.5 words per second (see SPEECH_RATE for other languages). */
export const WORDS_PER_SECOND = 2.5;

/** Seconds of speech, in a language's units (English: words). */
function units(seconds: number, language: Language): number {
  return Math.round(seconds * SPEECH_RATE[language]);
}

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
  const language = input.language ?? 'en';
  const ctx: BeatContext = {
    ...input,
    short,
    used,
    vertical: input.spec.height > input.spec.width,
    language,
    say: (key, params) => t(language, `narration.${key}`, params),
    heroBeats: new Set(template.hero),
  };

  const scenes: Scene[] = [];
  const budgets: number[] = [];
  beats.forEach((beat, i) => {
    const budget = Math.max(
      units(2.4, language),
      Math.round((speechSeconds * SPEECH_RATE[language] * weights[i]!) / totalWeight),
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
          eyebrows: { ko: '요약', ja: 'まとめ', zh: '总结' },
          goal: '',
          visuals: ['summary'],
          expression: 'success',
          optional: false,
        },
        units(8, language),
        ctx,
      )!,
    );
  }
  openCold(scenes, budgets, ctx);
  markHero(scenes, template);
  return {
    schemaVersion: 1,
    language,
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
  language: Language;
  /** A drafted sentence in the narration language (`narration.<key>` in the catalogs). */
  say: (key: string, params?: Params) => string;
  /** The template's payoff beats: a callout never stands in for one. */
  heroBeats: ReadonlySet<string>;
}

function eyebrowOf(beat: Beat, language: Language): string {
  return language === 'en' ? beat.eyebrow : beat.eyebrows[language];
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
    const text = fitWords(stripEmphasis(narration.text), budget, ctx.language);
    return {
      beat: beat.id,
      eyebrow: eyebrowOf(beat, ctx.language),
      heading: narration.heading,
      narration: text,
      say: narration.say
        ? fitWords(stripEmphasis(narration.say), budget + units(2.4, ctx.language), ctx.language)
        : spoken(text, ctx.language),
      visual,
      expression: expressionFor(beat, ctx),
      optional: beat.optional || undefined,
    };
  }
  // A callout is never the payoff: a hero beat without evidence is left out instead.
  return beat.optional || ctx.heroBeats.has(beat.id) ? undefined : fallbackScene(beat, budget, ctx);
}

function fallbackScene(beat: Beat, budget: number, ctx: BeatContext): Scene | undefined {
  if (beat.id === 'context' || beat.id === 'summary') return undefined;
  const text = fitWords(
    stripEmphasis(stripMarkdown(firstSentence(ctx.explanation.summary, ctx.language))),
    budget,
    ctx.language,
  );
  return {
    beat: beat.id,
    eyebrow: eyebrowOf(beat, ctx.language),
    narration: text,
    say: spoken(text, ctx.language),
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
        ctx.say('meta', {
          files: t(ctx.language, 'count.files', { count: context.size.files }),
          additions: stats.additions,
          deletions: stats.deletions,
        }),
      ];
      if (change.metadata.number)
        meta.unshift(
          `${change.metadata.platform === 'gitlab' ? '!' : '#'}${change.metadata.number}`,
        );
      return {
        kind: 'title',
        title: truncate(explanation.headline, 80),
        eyebrow: eyebrowOf(beat, ctx.language),
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
        labels: {
          before: t(ctx.language, 'video.label.before'),
          after: t(ctx.language, 'video.label.after'),
        },
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
        output: clipLines(cmd.after.output, ctx.short ? 8 : 12, ctx.language),
        before:
          cmd.before && cmd.changed
            ? clipLines(cmd.before.output, ctx.short ? 6 : 10, ctx.language)
            : undefined,
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
                body: clipLines(prettyJson(req.before.body), ctx.short ? 9 : 14, ctx.language),
              }
            : undefined,
        after: {
          status: req.after.status,
          body: clipLines(prettyJson(req.after.body), ctx.short ? 9 : 14, ctx.language),
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
          note: truncate(firstSentence(f.explanation, ctx.language), 120),
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
          body: truncate(firstSentence(f.explanation, ctx.language), 160),
        };
      }
      const start = explanation.readingOrder[0];
      return {
        kind: 'callout',
        tone: 'success',
        title: ctx.say('callout.noBlocking'),
        body: start ? ctx.say('callout.startWith', { path: start.path }) : ctx.say('callout.sound'),
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
      ctx.say('summary.pointLine', {
        label: ctx.say(`summary.point.${f.certainty}`),
        title: truncate(f.title, 70),
      }),
    );
  for (const c of ctx.explanation.changes) {
    if (points.length >= 3) break;
    points.push(
      ctx.say('summary.pointLine', {
        label: c.area,
        title: truncate(stripMarkdown(c.description), 70),
      }),
    );
  }
  if (ctx.context.tests.addedTestCases > 0 && points.length < 4)
    points.push(ctx.say('summary.newTests', { count: ctx.context.tests.addedTestCases }));
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
  const { context, review, say, language } = ctx;
  const en = language === 'en';
  const list = (items: string[]) => listOf(language, items);
  switch (visual.kind) {
    case 'title':
      return { text: stripMarkdown(intentSentence(context, language)) };
    case 'change-map':
      return {
        text: say('changeMap.text', {
          areas: t(language, 'count.areas', { count: context.areas.length }),
          names: list(context.areas.slice(0, 2).map((a) => a.name)),
        }),
        heading: say('changeMap.heading', {
          files: t(language, 'count.files', { count: context.size.files }),
        }),
      };
    case 'code': {
      const file = visual.path.split('/').pop() ?? visual.path;
      const named = keySymbols(context, visual.path, visual.lines.map((l) => l.text).join('\n'));
      const verb = say(named.every((s) => s.change === 'added') ? 'code.adds' : 'code.updates');
      const lead = beat.id === 'fix' ? 'fix' : beat.id === 'styles' ? 'styles' : 'key';
      const description = ctx.short ? undefined : areaDescription(ctx, visual.path);
      const heard = spokenFile(file, language);
      if (description)
        return {
          text: joinSentences(language, [say(`code.${lead}`, { file }), description]),
          say: joinSentences(language, [
            say(`code.${lead}`, { file: heard }),
            spoken(description, language),
          ]),
          heading: visual.path,
        };
      if (!named.length)
        return {
          text: say(`code.${lead}`, { file }),
          say: say(`code.${lead}`, { file: heard }),
          heading: visual.path,
        };
      return {
        text: say(`code.${lead}What`, { file, verb, names: list(named.map((s) => s.name)) }),
        say: say(`code.${lead}What`, {
          file: heard,
          verb,
          names: list(named.map((s) => humanizeIdentifier(s.name))),
        }),
        heading: visual.path,
      };
    }
    case 'screenshot': {
      const thePage = say('screenshot.thePage');
      return visual.image.path.includes('before')
        ? {
            text: say('screenshot.before', { label: visual.label ?? thePage }),
            heading: visual.label,
          }
        : {
            text: say('screenshot.after', {
              label: visual.label === '/' ? thePage : (visual.label ?? thePage),
              highlighted: visual.focus ? say('screenshot.highlighted') : '',
            }),
            heading: visual.label,
          };
    }
    case 'before-after': {
      const order = say(visual.layout === 'stack' ? 'beforeAfter.stack' : 'beforeAfter.split');
      const page =
        visual.after.label && visual.after.label !== '/'
          ? say('beforeAfter.pageOf', { page: visual.after.label })
          : '';
      return {
        text: joinSentences(language, [
          ctx.context.intent.kind === 'bug-fix'
            ? say('beforeAfter.fix')
            : say('beforeAfter.page', { page }),
          order,
        ]),
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
            ? say('interaction.steps', {
                steps: en
                  ? sentenceCase(list(labels.map(asClause)))
                  : list(labels.map((l) => l.replace(/[.!。！]$/, ''))),
              })
            : say('interaction.plain'),
      };
    }
    case 'terminal': {
      const first = visual.output.split('\n').find((l) => l.trim()) ?? '';
      // The terminal shows the exact command; narration describes it instead of reading it out.
      const output = first.trim();
      const cmd = ctx.demo?.commands.find((c) => c.name === visual.title);
      const none = say('terminal.none');
      const exit =
        !ctx.short && cmd?.before && cmd.before.exitCode !== cmd.after.exitCode
          ? say('terminal.exits', {
              after: cmd.after.exitCode ?? none,
              before: cmd.before.exitCode ?? none,
            })
          : '';
      const text = visual.before
        ? `${say('terminal.compared')}${output && output.length <= 40 ? say('terminal.prints', { output }) : ''}${exit}`
        : say('terminal.output');
      return { text, say: spoken(text, language), heading: visual.title };
    }
    case 'api': {
      const req = ctx.demo?.requests.find((r) => r.path === visual.path);
      const shape = req?.shapeChange
        ? endSentence(language, en ? sentenceCase(req.shapeChange) : req.shapeChange)
        : '';
      const detail = req && !ctx.short && visual.before ? exchangeDetail(req, ctx) : '';
      const more = joinSentences(language, [shape, detail]);
      return {
        text: joinSentences(language, [
          say(visual.before ? 'api.callCompared' : 'api.call', {
            method: visual.method,
            path: visual.path,
          }),
          more,
        ]),
        say: joinSentences(language, [
          say(visual.before ? 'api.sayCompared' : 'api.call', {
            method: visual.method,
            path: spokenPath(visual.path, language),
          }),
          more ? spoken(more, language) : '',
        ]),
        heading: `${visual.method} ${visual.path}`,
      };
    }
    case 'findings': {
      if (!ctx.short)
        return {
          text: findingsNarration(review.findings, budget, ctx),
          heading: headingForFindings(review.findings, ctx),
        };
      const n = review.findings.length;
      const title = lowerFirstWord(stripMarkdown(review.findings[0]!.title), language);
      const text = say(n === 1 ? 'findings.one' : n === 2 ? 'findings.two' : 'findings.few', {
        title,
      });
      // CJK narration needs more syllables per idea; when the lead does not fit, keep the finding.
      const compact = say('callout.check', { title });
      return {
        text: !en && speechUnits(text, language) > budget ? compact : text,
        heading: headingForFindings(review.findings, ctx),
      };
    }
    case 'callout':
      return visual.tone === 'success'
        ? { text: joinSentences(language, [say('callout.clean'), visual.body ?? '']) }
        : { text: say('callout.check', { title: lowerFirstWord(visual.title, language) }) };
    case 'diagram':
      return { text: say('diagram.text'), heading: say('diagram.heading') };
    case 'summary': {
      const verdict =
        review.verdict === 'looks-good'
          ? say('summary.looksGood')
          : review.verdict === 'needs-changes'
            ? say('summary.needsChanges')
            : say('summary.needsAttention', {
                spots: say('summary.spots', { count: review.findings.length }),
              });
      const tests =
        context.tests.addedTestCases > 0
          ? say('summary.tests', {
              tests: say('summary.newTests', { count: context.tests.addedTestCases }),
            })
          : '';
      if (ctx.short) return { text: verdict };
      const suggestion =
        review.verdict !== 'looks-good' ? review.findings[0]?.suggestion : undefined;
      const start = ctx.explanation.readingOrder[0]?.path;
      const next = suggestion
        ? say('summary.next', {
            step: lowerFirstWord(endSentence(language, stripMarkdown(suggestion)), language),
          })
        : review.verdict === 'looks-good' && start
          ? say('summary.start', { path: start })
          : '';
      return { text: verdict + tests + next };
    }
  }
}

/** Visuals that are the subject itself when nothing was captured. */
const SUBJECT = new Set<Visual['kind']>(['code', 'terminal', 'api']);

/**
 * Opens cold instead of on a title card: the title over the change's main capture; without one,
 * the first scene showing code, a command, or a response (the payoff only when nothing else
 * does) moves to the front with a short form of the title as its eyebrow and the opening line
 * before its own. A change with neither keeps its title card.
 */
function openCold(scenes: Scene[], budgets: number[], ctx: BeatContext): void {
  const opening = scenes[0];
  if (opening?.visual.kind !== 'title') return;
  const title = opening.visual.title;
  const shot = primaryShot(ctx, 'after');
  if (shot?.after) {
    opening.visual = { ...opening.visual, background: { path: shot.after.path, label: shot.name } };
    return;
  }
  const hero = heroScene(scenes, [...ctx.heroBeats]);
  const subjects = scenes.flatMap((s, i) => (i > 0 && SUBJECT.has(s.visual.kind) ? [i] : []));
  const index = subjects.find((i) => i !== hero) ?? subjects[0];
  if (index === undefined) return;
  // The opening is never dropped to fit the length, so the moved scene loses `optional`.
  const { heading: _heading, optional: _optional, ...subject } = scenes[index]!;
  const { language } = ctx;
  const budget = (budgets[0] ?? 0) + (budgets[index] ?? 0);
  scenes.splice(index, 1);
  scenes[0] = {
    ...subject,
    eyebrow: shortTitle(title),
    narration: fitWords(
      joinSentences(language, [opening.narration, subject.narration]),
      budget,
      language,
    ),
    say: fitWords(
      joinSentences(language, [
        opening.say ?? spoken(opening.narration, language),
        subject.say ?? spoken(subject.narration, language),
      ]),
      budget + units(2.4, language),
      language,
    ),
  };
}

/** The template's payoff, the first one present, is the video's hero; a hero is never optional. */
function markHero(scenes: Scene[], template: StoryTemplate): void {
  const index = heroScene(scenes, template.hero);
  if (index === undefined) return;
  const { optional: _optional, ...scene } = scenes[index]!;
  scenes[index] = { ...scene, hero: true };
}

/** A title short enough for an eyebrow: whole words, at most `max` characters. */
function shortTitle(title: string, max = 32): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** The explanation's own words for the area a file belongs to, as a sentence about that file. */
function areaDescription(ctx: BeatContext, path: string): string | undefined {
  const change = ctx.explanation.changes.find((c) => c.files.includes(path));
  if (!change) return undefined;
  const clean = stripMarkdown(change.description).trim();
  if (ctx.language !== 'en') return endSentence(ctx.language, clean);
  const first = (clean.split(/\s+/)[0] ?? '').toLowerCase();
  // "Adds X, changes Y" reads as a clause about the file; anything else is already a sentence.
  const verb =
    first.endsWith('s') &&
    [first.replace(/ies$/, 'y'), first.replace(/es$/, ''), first.slice(0, -1)].some(
      isImperativeVerb,
    );
  return ensurePeriod(
    verb ? ctx.say('code.describedBy', { description: lowerFirst(clean) }) : clean,
  );
}

/** What the captured responses show beyond their shape: status and size, from the real bodies. */
function exchangeDetail(req: DemoRequestResult, ctx: BeatContext): string {
  const parts: string[] = [];
  if (req.before && req.before.status !== req.after.status)
    parts.push(ctx.say('api.status', { before: req.before.status, after: req.after.status }));
  const before = parseJson(req.before?.body);
  const after = parseJson(req.after.body);
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
    parts.push(ctx.say('api.entries', { count: before.length, now: after.length }));
  } else if (Array.isArray(before) && isRecord(after)) {
    const lists = Object.entries(after).filter(([, v]) => Array.isArray(v));
    if (lists.length === 1) {
      const [key, list] = lists[0]! as [string, unknown[]];
      parts.push(ctx.say('api.listed', { count: before.length, key, now: list.length }));
    }
  } else if (isRecord(before) && isRecord(after)) {
    const added = Object.keys(after).filter((k) => !(k in before));
    if (added.length)
      parts.push(ctx.say('api.includes', { keys: listOf(ctx.language, added.slice(0, 3)) }));
  }
  return joinSentences(ctx.language, parts);
}

/**
 * Names every finding on screen when the budget allows, with why the first ones matter. When it
 * does not, explanations go first, so the count it announces is always the count it covers.
 */
function findingsNarration(findings: readonly Finding[], budget: number, ctx: BeatContext): string {
  const { language, say } = ctx;
  const shown = findings.slice(0, 3);
  const title = (f: Finding) => lowerFirstWord(stripMarkdown(f.title), language);
  const why = (f: Finding) => firstSentence(stripMarkdown(f.explanation), language);
  if (shown.length === 1)
    return say('findings.oneWhy', { title: title(shown[0]!), why: why(shown[0]!) });
  const count =
    findings.length === shown.length ? ({ 2: 'two', 3: 'three' } as const)[shown.length] : 'few';
  const variant = (explained: number) =>
    joinSentences(language, [
      say(`findings.count.${count ?? 'few'}`),
      ...shown.flatMap((f, i) => [
        say(`findings.ordinal.${['first', 'second', 'third'][i]}`, { title: title(f) }),
        ...(i < explained ? [why(f)] : []),
      ]),
    ]);
  for (const explained of [2, 1, 0]) {
    const text = variant(explained);
    if (speechUnits(text, language) <= budget) return text;
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

function headingForFindings(findings: readonly Finding[], ctx: BeatContext): string {
  const f = findings[0]!;
  return findings.length === 1
    ? ctx.say(`findings.heading.${f.certainty}`)
    : ctx.say('findings.heading.many', { count: findings.length });
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/**
 * Keeps whole sentences within the budget, in the language's speech units (English: words). Never
 * cuts mid-sentence unless one sentence is too long.
 */
export function fitWords(text: string, budget: number, language: Language = 'en'): string {
  if (language !== 'en') return fitUnits(text, budget, language);
  const wordCount = (s: string) => speechUnits(s, 'en');
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

/** fitWords for Korean, Japanese, and Chinese: sentences from Intl.Segmenter, clauses at commas. */
function fitUnits(text: string, budget: number, language: Language): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (speechUnits(clean, language) <= budget) return clean;
  const sentences = segments(clean, language, 'sentence')
    .map((s) => s.trim())
    .filter(Boolean);
  let out = '';
  for (const s of sentences) {
    const next = joinSentences(language, [out, s]);
    if (speechUnits(next, language) > budget) break;
    out = next;
  }
  if (out) return out;
  // One sentence is too long. A sentence that carries text from the change (an English commit
  // title in Chinese narration) costs more units than its time; narration-first timing absorbs
  // a long sentence better than a broken one.
  const first = sentences[0] ?? clean;
  if (speechUnits(first, language) <= Math.ceil(budget * 2.5)) return first;
  // End it at the last clause that fits, else at the last word that fits (never inside one).
  const clauses = first.split(/(?<=[,，、;；])\s*/);
  const gap = language === 'ko' ? ' ' : '';
  let cut = '';
  for (const clause of clauses) {
    const next = cut ? `${cut}${gap}${clause}` : clause;
    if (speechUnits(next, language) > budget) break;
    cut = next;
  }
  if (!cut) {
    for (const word of segments(first, language, 'word')) {
      if (speechUnits(cut + word, language) > budget) break;
      cut += word;
    }
  }
  return endSentence(language, (cut || first).replace(/[,，、;；\s]+$/, ''));
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

const SPOKEN_PATH =
  /(?:[\w.-]+\/)*\b([\w-]+)\.(tsx?|jsx?|mjs|cjs|css|scss|py|go|rs|rb|md|json|ya?ml|toml|html)\b/g;

/**
 * The spoken form of narration: identifiers as words, paths as "the totals module". English is
 * the reference; other languages say file kinds in their own words ("totals 모듈"). Acronyms are
 * left for speech normalization at render time.
 */
export function spoken(text: string, language: Language = 'en'): string {
  if (language !== 'en')
    return (
      stripMarkdown(text)
        .replace(/\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g, (m) => humanizeIdentifier(m))
        .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (m) => humanizeIdentifier(m))
        .replace(SPOKEN_PATH, (_m, name: string, ext: string) =>
          t(language, 'narration.file.phrase', {
            name: humanizeIdentifier(name),
            noun: t(language, `narration.file.${FILE_NOUN[ext] ?? 'file'}`),
          }),
        )
        // Routes are said segment by segment: "/api/users" → "API 슬래시 users".
        .replace(/(?<![\w./])\/[A-Za-z][\w\-/:{}.]*/g, (route) => spokenPath(route, language))
        .replace(/→/g, t(language, 'narration.to'))
        .replace(/\s+/g, ' ')
        .trim()
    );
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

function spokenFile(file: string, language: Language): string {
  return spoken(file, language);
}

/** Path segments that are acronyms; non-English voices get them in capitals so they are spelled. */
const PATH_ACRONYMS = /^(api|cli|ui|db|sdk|url|http|https|rpc|ws|v\d+)$/i;

function spokenPath(path: string, language: Language): string {
  const segments = path.replace(/^\//, '').split('/');
  const said =
    language === 'en'
      ? segments
      : segments.map((s) => (PATH_ACRONYMS.test(s) ? s.toUpperCase() : s));
  return said.join(t(language, 'narration.slash')).replace(/[{}:[\]]/g, '');
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

function firstSentence(text: string, language: Language = 'en'): string {
  if (language !== 'en') return (segments(text.trim(), language, 'sentence')[0] ?? text).trim();
  const m = /^[^.!?]+[.!?]/.exec(text.trim());
  return (m?.[0] ?? text).trim();
}

/** Lowercases an English sentence's first word for use mid-sentence; other languages keep case. */
function lowerFirstWord(text: string, language: Language = 'en'): string {
  const trimmed = text.trim();
  if (!trimmed || language !== 'en') return trimmed;
  const first = trimmed.split(/\s+/)[0]!;
  if (/^[A-Z]{2,}/.test(first) || /[a-z][A-Z]/.test(first)) return trimmed;
  return trimmed[0]!.toLowerCase() + trimmed.slice(1);
}

function clipLines(text: string, max: number, language: Language = 'en'): string {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  if (lines.length <= max) return lines.map((l) => l.slice(0, 90)).join('\n');
  return [
    ...lines.slice(0, max - 1).map((l) => l.slice(0, 90)),
    t(language, 'video.moreLines', { count: lines.length - max + 1 }),
  ].join('\n');
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
