import { DEFAULT_CONFIG, parseConfigInput, resolveConfig } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  applyAnswers,
  followUpQuestions,
  parseVideoRequest,
  planVideo,
  resolveVideoSpec,
  respecVideo,
  SIZE_QUESTION,
} from '../src/spec.ts';

const config = (input = {}) =>
  resolveConfig([{ name: 'repository', values: parseConfigInput(input, 't') }]).config;

describe('parseVideoRequest', () => {
  it('reads "Make a 30-second vertical review video" without needing questions', () => {
    const { request, inferred } = parseVideoRequest('Make a 30-second vertical review video.');
    expect(request).toMatchObject({ mode: 'short', duration: 30 });
    expect(inferred.mode).toContain('vertical');
    expect(inferred.duration).toContain('30');
  });

  it.each([
    ['a 90 second walkthrough video', { mode: 'standard', duration: 90 }],
    ['quick 15s short for the team channel', { mode: 'short', duration: 15 }],
    ['make it 2 minutes', { mode: 'standard', duration: 120 }],
    ['a square video', { mode: 'custom', width: 1080, height: 1080 }],
    ['render at 1280x720', { mode: 'custom', width: 1280, height: 720 }],
    ['a silent video with no narration', { narration: false }],
    ['landscape, dark mode please', { mode: 'standard', theme: 'dark' }],
    ['without captions', { captions: false }],
  ])('%s', (text, expected) => {
    expect(parseVideoRequest(text).request).toMatchObject(expected);
  });

  it('infers nothing from vague requests', () => {
    expect(parseVideoRequest('make a review video').request).toEqual({});
  });
});

describe('resolveVideoSpec', () => {
  it('applies mode presets', () => {
    expect(resolveVideoSpec(config(), { mode: 'short' })).toMatchObject({
      width: 1080,
      height: 1920,
      duration: { target: 28, min: 20, max: 35, auto: true },
      style: 'concise',
    });
    expect(resolveVideoSpec(config(), { mode: 'standard' })).toMatchObject({
      width: 1920,
      height: 1080,
      duration: { min: 60, max: 120 },
      style: 'explanatory',
    });
  });

  it('turns an explicit duration into a tolerance window', () => {
    expect(resolveVideoSpec(config(), { mode: 'short', duration: 30 }).duration).toEqual({
      target: 30,
      min: 25.5,
      max: 34.5,
      auto: false,
    });
  });

  it('keeps custom sizes even, and fills a missing side', () => {
    expect(resolveVideoSpec(config(), { mode: 'custom', width: 1001, height: 701 })).toMatchObject({
      width: 1002,
      height: 702,
    });
    expect(resolveVideoSpec(config(), { mode: 'custom', width: 1280 })).toMatchObject({
      width: 1280,
      height: 720,
    });
  });

  it('respects repository defaults', () => {
    expect(
      resolveVideoSpec(config({ video: { mode: 'standard', narration: false, theme: 'dark' } })),
    ).toMatchObject({ mode: 'standard', narration: { enabled: false }, theme: 'dark' });
  });
});

describe('planVideo (the question protocol)', () => {
  it('asks type and length together when nothing was specified in an interactive session', () => {
    const plan = planVideo(config(), { text: 'make a review video', interactive: true });
    expect(plan.missing).toEqual(['mode', 'duration']);
    expect(plan.questions.map((q) => q.id)).toEqual(['mode', 'duration']);
    expect(plan.questions[0]!.options.map((o) => o.label)).toEqual([
      'Short-form',
      'Standard review',
      'Custom',
    ]);
    expect(plan.questions[1]!.options.map((o) => o.label)).toEqual([
      '~15 sec',
      '~30 sec',
      '~60 sec',
      'Let Covi decide',
    ]);
  });

  it('asks nothing when the request is specific', () => {
    expect(
      planVideo(config(), { text: 'Make a 30-second vertical review video.', interactive: true })
        .questions,
    ).toEqual([]);
  });

  it('does not ask for length when only the type was given (strong defaults)', () => {
    expect(
      planVideo(config(), { explicit: { mode: 'standard' }, interactive: true }).questions,
    ).toEqual([]);
  });

  it('never asks in non-interactive contexts', () => {
    const plan = planVideo(config(), { interactive: false });
    expect(plan.questions).toEqual([]);
    expect(plan.spec.mode).toBe('short');
  });

  it('treats repository configuration as decided', () => {
    expect(
      planVideo(config({ video: { mode: 'standard' } }), {
        provided: ['mode', 'duration'],
        interactive: true,
      }).questions,
    ).toEqual([]);
  });

  it('asks for a size only for custom videos', () => {
    expect(
      planVideo(config(), {
        explicit: { mode: 'custom' },
        provided: ['duration'],
        interactive: true,
      }).questions.map((q) => q.id),
    ).toEqual(['size']);
  });

  it('asks how long a custom-size video should be: a size implies no length', () => {
    const plan = planVideo(config(), { text: 'a square video', interactive: true });
    expect(plan.questions.map((q) => q.id)).toEqual(['duration']);
    // Without an answer, a square video gets feed-length timing, not a walkthrough's.
    expect(plan.spec.duration.target).toBeLessThanOrEqual(35);
  });

  it('follows a Custom answer with the size question unless a size is known', () => {
    const plan = planVideo(config(), { text: 'make a review video', interactive: true });
    expect(followUpQuestions(plan, { mode: 'custom' }, ['mode', 'duration'])).toEqual([
      SIZE_QUESTION,
    ]);
    expect(followUpQuestions(plan, { mode: 'short' }, ['mode', 'duration'])).toEqual([]);
    expect(followUpQuestions(plan, { mode: 'custom' }, ['mode', 'size'])).toEqual([]);
    const sized = planVideo(config({ video: { width: 1200, height: 1200 } }), {
      interactive: true,
    });
    expect(followUpQuestions(sized, { mode: 'custom' }, ['mode'])).toEqual([]);
  });

  it('applies answers', () => {
    expect(applyAnswers({}, { mode: 'custom', duration: '45', size: '1080x1080' })).toEqual({
      mode: 'custom',
      duration: 45,
      width: 1080,
      height: 1080,
    });
    expect(applyAnswers({}, { duration: 'auto' })).toEqual({ duration: 'auto' });
  });
});

describe('respecVideo', () => {
  const saved = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard', duration: 90 });

  it('re-renders with the settings chosen at draft time', () => {
    const spec = respecVideo(DEFAULT_CONFIG, saved, {});
    expect(spec).toMatchObject({ mode: 'standard', width: 1920, height: 1080 });
    expect(spec.duration.target).toBe(90);
  });

  it('applies new choices on top, and a new mode resets what came with the old one', () => {
    expect(respecVideo(DEFAULT_CONFIG, saved, { captions: false })).toMatchObject({
      mode: 'standard',
      captions: false,
    });
    const short = respecVideo(DEFAULT_CONFIG, saved, { mode: 'short' });
    expect(short).toMatchObject({ mode: 'short', width: 1080, height: 1920 });
    expect(short.duration.target).toBeLessThanOrEqual(35);
  });

  it('keeps the drafted frame rate and voice unless they are set again', () => {
    const drafted = resolveVideoSpec(config({ video: { fps: 24, narration: { voice: 'Reed' } } }), {
      mode: 'short',
    });
    const kept = respecVideo(DEFAULT_CONFIG, drafted, {});
    expect(kept.fps).toBe(24);
    expect(kept.narration.voice).toBe('Reed');
    const changed = respecVideo(
      config({ video: { fps: 60 } }),
      drafted,
      {},
      new Set(['video.fps']),
    );
    expect(changed.fps).toBe(60);
    expect(changed.narration.voice).toBe('Reed');
  });

  it('falls back to configuration when nothing was saved', () => {
    expect(respecVideo(DEFAULT_CONFIG, undefined, {}).mode).toBe(DEFAULT_CONFIG.video.mode);
  });
});
