import { motion } from '@covi/brand';
import { DEFAULT_CONFIG, parseConfigInput, resolveConfig } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec, type VideoRequest } from '../src/spec.ts';
import { type Scene, type Storyboard, TRANSITION_KINDS } from '../src/storyboard/schema.ts';
import {
  buildTimeline,
  cutStart,
  fitToDuration,
  HERO_HOLD,
  type Layout,
  LINE_GAP,
  layoutScenes,
  minSecondsFor,
  OUTRO_ID,
  OUTRO_SECONDS,
  pacingFor,
  storyScenes,
  TIGHT,
  TRANSITION,
} from '../src/timeline/build.ts';
import { outroSettle } from '../src/timeline/cues.ts';

const scene = (
  id: string,
  beat: string,
  kind: 'title' | 'callout' | 'summary',
  extra: Partial<Scene> = {},
): Scene =>
  ({
    id,
    beat,
    narration: 'x',
    visual:
      kind === 'title'
        ? { kind: 'title', title: 'T', meta: [] }
        : kind === 'summary'
          ? { kind: 'summary', verdict: 'needs-attention', headline: 'H', points: [] }
          : { kind: 'callout', tone: 'info', title: 'C' },
    ...extra,
  }) as Scene;

/** A narration-dense bug fix: every scene talks for longer than its visual needs. */
const story = [
  scene('s1', 'context', 'title'),
  scene('s2', 'problem', 'callout'),
  scene('s3', 'fix', 'callout'),
  scene('s4', 'review', 'callout'),
  scene('s5', 'summary', 'summary'),
];
const talk = new Map([
  ['s1', 9],
  ['s2', 11],
  ['s3', 12],
  ['s4', 10],
  ['s5', 8],
]);
const HERO = ['proof', 'fix'];

const spec = (request: VideoRequest) => resolveVideoSpec(DEFAULT_CONFIG, request);
const standard = spec({ mode: 'standard' });

/** Seconds between one line's end and the next line's start. */
const gaps = (layout: Layout) =>
  layout.scenes.slice(1).map((s, i) => s.speechStart - layout.scenes[i]!.speechEnd);

describe('pacing', () => {
  it('breathes in narrated standard reviews and keeps short-form tight', () => {
    expect(pacingFor(standard, HERO)).toEqual({
      firstLead: 0.3,
      heroBreath: 1.4,
      breath: 1.25,
      chapter: 24,
      hero: HERO,
      outro: OUTRO_SECONDS.standard,
    });
    expect(pacingFor(spec({ mode: 'short' }), HERO)).toEqual({
      ...TIGHT,
      outro: OUTRO_SECONDS.short,
    });
    // Captions-only standard reviews and custom feed sizes keep tight timing too.
    expect(pacingFor(spec({ mode: 'standard', narration: false }), HERO)).toEqual({
      ...TIGHT,
      outro: OUTRO_SECONDS.standard,
    });
    expect(pacingFor(spec({ mode: 'custom', width: 1080, height: 1080 }), HERO)).toEqual({
      ...TIGHT,
      outro: OUTRO_SECONDS.short,
    });
    // A custom landscape video is a walkthrough: it breathes like a standard review.
    expect(pacingFor(spec({ mode: 'custom', width: 1280, height: 720 }), HERO).heroBreath).toBe(
      1.4,
    );
    expect(pacingFor(spec({ mode: 'standard', outro: false })).outro).toBeUndefined();
    // Narration asked for but not synthesized: paced as captions only.
    expect(pacingFor(standard, HERO, false)).toEqual({ ...TIGHT, outro: OUTRO_SECONDS.standard });
  });

  it('never depends on the music or the effects', () => {
    const sounds: VideoRequest[] = [
      { music: 'theme' },
      { music: 'none' },
      { music: 'compose', musicPlacement: 'continuous' },
      { musicPlacement: 'bookends', soundEffects: false },
    ];
    for (const mode of ['short', 'standard'] as const) {
      const layouts = sounds.map((sound) =>
        layoutScenes(story, talk, new Map(), 'en', pacingFor(spec({ mode, ...sound }), HERO)),
      );
      for (const layout of layouts) expect(layout).toEqual(layouts[0]);
    }
  });

  it('starts the hook by 0.3 s, lets the hero settle before its line, and breathes around it', () => {
    const layout = layoutScenes(story, talk, new Map(), 'en', pacingFor(standard, HERO));
    const [s1, s2, s3, s4] = layout.scenes;
    expect(s1!.speechStart).toBe(0.3);
    // The hero (the fix) settles as its transition ends, then 1.4 s pass before its line.
    expect(s3!.speechStart - (s3!.start + TRANSITION)).toBeCloseTo(1.4, 6);
    expect(s3!.speechStart - s2!.speechEnd).toBeGreaterThanOrEqual(1.5);
    // The breaths after the hook and after the hero, where bookends music is heard.
    expect(s2!.speechStart - s1!.speechEnd).toBeCloseTo(LINE_GAP + 1.25, 6);
    expect(s4!.speechStart - s3!.speechEnd).toBeCloseTo(LINE_GAP + 1.25, 6);
    // A breath belongs to the scene after it: the old picture leaves as at any scene change.
    expect(s1!.end - s1!.speechEnd).toBeLessThanOrEqual(0.6);
  });

  it('lets the verdict land before the summary speaks', () => {
    const layout = layoutScenes(story, talk, new Map(), 'en', pacingFor(standard, HERO));
    const summary = layout.scenes.at(-1)!;
    expect(summary.speechStart - summary.start).toBeCloseTo(0.6 * TRANSITION + 1.25, 6);
    expect(gaps(layout).at(-1)).toBeGreaterThanOrEqual(1.5);
  });

  it('pauses at a scene change after a long stretch of talk', () => {
    const long = [
      scene('s1', 'context', 'title'),
      ...['s2', 's3', 's4', 's5', 's6'].map((id) => scene(id, 'scope', 'callout')),
      scene('s7', 'summary', 'summary'),
    ];
    const speech = new Map(long.map((s) => [s.id!, 13]));
    const layout = layoutScenes(long, speech, new Map(), 'en', pacingFor(standard, HERO));
    const breaths = gaps(layout).filter((g) => g >= 1.5).length;
    // Without a hero beat, the summary and the long stretches breathe: never 24 s of talk
    // without a pause where music can be heard.
    expect(breaths).toBeGreaterThanOrEqual(3);
    let since = layout.scenes[0]!.speechStart;
    for (const [i, s] of layout.scenes.entries()) {
      if (i > 0 && s.speechStart - layout.scenes[i - 1]!.speechEnd >= 1.5) since = s.speechStart;
      expect(s.speechStart - since).toBeLessThanOrEqual(24 + 13.6);
    }
    // A long pause the visuals already leave counts as a breath: no extra one follows it.
    const held = layoutScenes(long, speech, new Map([['s3', 3]]), 'en', pacingFor(standard, HERO));
    expect(held.scenes[4]!.speechStart - held.scenes[4]!.start).toBeCloseTo(0.6 * TRANSITION, 6);
  });

  it('ends with the outro, which enters like a scene and replaces the one-second hold', () => {
    const tight = layoutScenes(story, talk);
    expect(tight.outro).toBeUndefined();
    expect(tight.duration).toBeCloseTo(tight.scenes.at(-1)!.end + 1, 6);

    const layout = layoutScenes(story, talk, new Map(), 'en', pacingFor(standard, HERO));
    const last = layout.scenes.at(-1)!;
    expect(layout.outro).toEqual({
      start: Number((last.end - TRANSITION).toFixed(3)),
      end: Number((last.end - TRANSITION + OUTRO_SECONDS.standard).toFixed(3)),
    });
    expect(layout.duration).toBe(layout.outro!.end);
    // The last card lingers a moment after its last word before the outro takes over.
    expect(last.end - last.speechEnd).toBeCloseTo(0.8, 6);
    // The logo's pickup (at most 0.75 of a beat at 54 bpm) fits between the last word and the
    // outro settling, whatever the tempo.
    expect(layout.outro!.start + outroSettle() - last.speechEnd).toBeGreaterThan(0.84 + 0.1);
  });

  it('never pads a video shorter than its window', () => {
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'bug-fix',
      draft: true,
      scenes: story,
    };
    const brief = new Map(story.map((s) => [s.id!, 4]));
    const paced = pacingFor(standard, HERO);
    const fit = fitToDuration(storyboard, brief, standard, 'en', paced);
    expect(fit.layout).toEqual(layoutScenes(story, brief, new Map(), 'en', paced));
    expect(fit.layout.duration).toBeLessThan(standard.duration.min);
    expect(fit.notes).toEqual([]);
    expect(fit).not.toHaveProperty('extraHold');
    // fitToDuration paces by the spec when it is not told otherwise.
    expect(fitToDuration(storyboard, talk, standard).layout.outro).toBeDefined();
    const config = resolveConfig([
      { name: 'explicit', values: parseConfigInput({ video: { outro: false } }, 't') },
    ]).config;
    expect(
      fitToDuration(storyboard, talk, resolveVideoSpec(config, { mode: 'standard' })).layout.outro,
    ).toBeUndefined();
  });

  it('trims only past the window’s maximum, and never drops the hero', () => {
    // The hero is the last optional scene: only the guard keeps it.
    const scenes = story.map((s, i) =>
      i === 1 ? { ...s, optional: true } : i === 3 ? { ...s, optional: true, hero: true } : s,
    );
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'bug-fix',
      draft: true,
      scenes,
    };
    const long = new Map([...talk].map(([id, s]) => [id, s * 2.4]));
    const fit = fitToDuration(storyboard, long, standard, 'en', pacingFor(standard, HERO));
    expect(fit.scenes.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5']);
    expect(fit.notes[0]).toMatch(/Dropped optional scene "problem"/);
    expect(fit.layout.duration).toBeLessThanOrEqual(standard.duration.max);
  });

  it('never drops the scene playing the template’s hero beat when none is marked', () => {
    // bug-fix's hero is its proof, else its fix: here the fix (s3), the last optional scene.
    const scenes = story.map((s, i) => (i === 1 || i === 2 ? { ...s, optional: true } : s));
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'bug-fix',
      draft: true,
      scenes,
    };
    const long = new Map([...talk].map(([id, s]) => [id, s * 2.4]));
    const fit = fitToDuration(storyboard, long, standard, 'en', pacingFor(standard, HERO));
    expect(fit.scenes.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5']);
    expect(fit.notes[0]).toMatch(/Dropped optional scene "problem"/);
  });
});

describe('the outro in the timeline', () => {
  const build = (scenes: Scene[], verdict?: 'looks-good' | 'needs-changes') => {
    const layout = layoutScenes(scenes, talk, new Map(), 'en', pacingFor(standard, HERO));
    return buildTimeline({
      title: 'x',
      scenes,
      layout,
      spec: standard,
      image: () => ({ src: '', width: 1, height: 1 }),
      verdict,
    });
  };

  it('is Covi’s own last scene, with the summary’s verdict and a cue where it settles', () => {
    const timeline = build(story, 'needs-changes');
    const outro = timeline.scenes.at(-1)!;
    expect(outro).toMatchObject({
      id: OUTRO_ID,
      beat: 'outro',
      narrator: false,
      visual: { kind: 'outro', verdict: 'needs-attention' },
    });
    expect(outro.speech).toBeUndefined();
    expect(timeline.duration).toBe(outro.end);
    expect(timeline.cues.at(-1)).toEqual({
      t: outro.start + outroSettle(),
      kind: 'outro',
      scene: OUTRO_ID,
      detail: 'needs-attention',
    });
    expect(timeline.labels?.signOff).toBe('Reviewed with Covi');
    expect(storyScenes(timeline.scenes).map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    // Captions come from the story's narration only.
    expect(timeline.captions.at(-1)!.end).toBeLessThanOrEqual(outro.start);
  });

  it('takes the review’s verdict when the story has no summary', () => {
    const timeline = build(story.slice(0, 4), 'needs-changes');
    expect(timeline.scenes.at(-1)!.visual).toEqual({ kind: 'outro', verdict: 'needs-changes' });
    expect(build(story.slice(0, 4)).scenes.at(-1)!.visual).toEqual({ kind: 'outro' });
  });
});

describe('the timing grammar', () => {
  const three = (middle: Partial<Scene> = {}) => [
    scene('s1', 'a', 'callout'),
    scene('s2', 'b', 'callout', middle),
    scene('s3', 'c', 'callout'),
  ];
  const lines = new Map([
    ['s1', 3],
    ['s2', 3],
    ['s3', 3],
  ]);

  it('starts a transition at max(line end − 0.5·d, next line − 0.6·d), whatever its kind', () => {
    for (const kind of TRANSITION_KINDS) {
      const [a, b] = layoutScenes(three({ transition: kind }), lines).scenes;
      const d = motion.transitions[kind];
      expect(b!.start, kind).toBeCloseTo(
        Math.max(a!.speechEnd - 0.5 * d, b!.speechStart - 0.6 * d),
        3,
      );
      expect(b!.start, kind).toBeCloseTo(cutStart(a!.speechEnd, a!.speechEnd + LINE_GAP, d), 3);
      expect(b!.speechStart - a!.speechEnd, kind).toBeCloseTo(LINE_GAP, 3);
      expect(a!.end, kind).toBeCloseTo(b!.start + d, 3);
      // So no scene outstays its line by more than 0.6 s.
      expect(a!.end - a!.speechEnd, kind).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('cuts on the first word of the next line', () => {
    const [, b] = layoutScenes(three({ transition: 'cut' }), lines).scenes;
    expect(b!.start).toBe(b!.speechStart);
  });

  it('lets the hero in with zoom-through and holds it 0.4 s after its line', () => {
    const [a, b, c] = layoutScenes(three({ hero: true }), lines).scenes;
    const d = motion.transitions['zoom-through'];
    expect(b!.start).toBeCloseTo(Math.max(a!.speechEnd - 0.5 * d, b!.speechStart - 0.6 * d), 3);
    expect(c!.speechStart - b!.speechEnd).toBeCloseTo(LINE_GAP + HERO_HOLD, 3);
    const plain = layoutScenes(three(), lines).scenes;
    expect(plain[2]!.speechStart - plain[1]!.speechEnd).toBeCloseTo(LINE_GAP, 3);
  });

  it('holds a hero that comes first, or last before the outro', () => {
    const first = layoutScenes(
      [scene('s1', 'a', 'callout', { hero: true }), scene('s2', 'b', 'callout')],
      lines,
    ).scenes;
    expect(first[0]!.start).toBe(0);
    expect(first[1]!.speechStart - first[0]!.speechEnd).toBeCloseTo(LINE_GAP + HERO_HOLD, 3);
    const last = layoutScenes(
      [scene('s1', 'a', 'callout'), scene('s2', 'b', 'callout', { hero: true })],
      lines,
      new Map(),
      'en',
      pacingFor(standard),
    ).scenes;
    expect(last[1]!.end - last[1]!.speechEnd).toBeCloseTo(0.8 + HERO_HOLD, 3);
  });

  it('keeps a visual up for its minimum, and starts the next line after it', () => {
    const [, b, c] = layoutScenes(
      three({ minSeconds: 6 }),
      new Map([
        ['s1', 3],
        ['s2', 1],
        ['s3', 3],
      ]),
    ).scenes;
    expect(b!.end - b!.start).toBeCloseTo(6, 3);
    expect(c!.speechStart - c!.start).toBeCloseTo(0.6 * TRANSITION, 3);
  });

  it('starts the hook by 0.3 s in every kind of video', () => {
    for (const mode of ['short', 'standard'] as const) {
      const paced = pacingFor(spec({ mode }), HERO);
      expect(
        layoutScenes(story, talk, new Map(), 'en', paced).scenes[0]!.speechStart,
      ).toBeLessThanOrEqual(0.3);
    }
  });

  it('gives the visuals the shorter minimums that 2–5 s scenes need', () => {
    const line = { type: 'add', text: 'x' } as const;
    const v = (visual: unknown) => minSecondsFor(visual as Scene['visual']);
    expect(v({ kind: 'title', title: 'T', meta: [] })).toBe(1.5);
    expect(v({ kind: 'code', path: 'a', lines: Array(40).fill(line), highlight: [] })).toBe(2);
    expect(v({ kind: 'before-after' })).toBe(2.5);
    expect(v({ kind: 'interaction', steps: [{}, {}, {}] })).toBeCloseTo(3.6, 9);
    expect(v({ kind: 'findings', findings: [{}, {}] })).toBeCloseTo(2.8, 9);
  });
});
