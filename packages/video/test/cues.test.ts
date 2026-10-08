import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Span } from '../src/timeline/cues.ts';
import {
  activeStep,
  apiPanels,
  beforeAfterReveal,
  beforeAfterTiming,
  buildCues,
  findingEntrance,
  findingLanding,
  highlightStarts,
  interactionPointer,
  interactionTiming,
  screenshotPointer,
  screenshotTiming,
  settledAt,
  terminalStarts,
  verdictEntrance,
} from '../src/timeline/cues.ts';
import type { TimelineScene, TimelineVisual } from '../src/timeline/types.ts';

const image = { src: 'a.png', width: 100, height: 100 };

function scene(id: string, start: number, end: number, visual: TimelineVisual): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual,
    expression: 'explaining',
    narrator: true,
  };
}

describe('timeline cues', () => {
  it('time a screenshot click at the press, and only when there is a click', () => {
    const cues = buildCues([
      scene('a', 2, 6, { kind: 'screenshot', image, device: 'desktop', click: { x: 1, y: 1 } }),
      scene('b', 6, 9, { kind: 'screenshot', image, device: 'desktop' }),
    ]);
    expect(cues).toEqual([{ t: 2 + 4 * 0.62, kind: 'click', scene: 'a' }]);
    expect(screenshotPointer(4).press[0]).toBeCloseTo(2.48, 9);
  });

  it('time each interaction step that clicks within its slot', () => {
    const steps = [{ image, click: { x: 1, y: 1 } }, { image }, { image, click: { x: 2, y: 2 } }];
    const cues = buildCues([scene('i', 10, 16, { kind: 'interaction', steps })]);
    const slot = 2;
    expect(cues.map((c) => [c.kind, +c.t.toFixed(6)])).toEqual([
      ['click', 10 + 0 * slot + slot * 0.6],
      ['click', +(10 + 2 * slot + slot * 0.6).toFixed(6)],
    ]);
    expect(interactionPointer(slot)).toEqual({ move: [0.5, 1.2], press: [1.2, 1.7] });
  });

  it('time the before/after reveal by layout', () => {
    const pair = (layout: 'split' | 'stack' | 'wipe') =>
      ({
        kind: 'before-after',
        before: image,
        after: image,
        layout,
        labels: { before: 'Before', after: 'After' },
      }) as const;
    expect(buildCues([scene('s', 1, 6, pair('split'))])).toEqual([
      { t: 1.35, kind: 'reveal', scene: 's' },
    ]);
    expect(buildCues([scene('w', 1, 6, pair('wipe'))])[0]!.t).toBeCloseTo(1 + 5 * 0.25, 9);
    expect(beforeAfterReveal('stack', 5)).toEqual([0.35, 0.85]);
  });

  it('time each finding card as it lands, marking high severity', () => {
    const finding = (severity: 'high' | 'low') =>
      ({ title: 'x', certainty: 'likely', severity }) as const;
    const cues = buildCues([
      scene('f', 4, 9, { kind: 'findings', findings: [finding('high'), finding('low')] }),
    ]);
    expect(cues).toEqual([
      { t: 4 + findingLanding(0), kind: 'finding', scene: 'f', detail: 'high' },
      { t: 4 + findingLanding(1), kind: 'finding', scene: 'f' },
    ]);
    const [start, end] = findingEntrance(1);
    // The card has covered 90% of its ease-out travel when it "lands".
    expect(1 - (1 - (findingLanding(1) - start) / (end - start)) ** 3).toBeCloseTo(0.9, 6);
  });

  it('time the verdict as the summary badge appears', () => {
    const cues = buildCues([
      scene('s', 20, 24, {
        kind: 'summary',
        verdict: 'needs-changes',
        headline: 'h',
        points: [],
      }),
    ]);
    expect(cues).toEqual([
      { t: 20 + verdictEntrance()[0], kind: 'verdict', scene: 's', detail: 'needs-changes' },
    ]);
  });

  it('stay silent for ordinary scenes and come out in time order', () => {
    expect(
      buildCues([
        scene('t', 0, 3, { kind: 'title', title: 't', meta: [] }),
        scene('c', 3, 7, { kind: 'code', path: 'a.ts', lines: [], highlight: [0] }),
        scene('m', 7, 10, { kind: 'terminal', command: 'x', output: 'y' }),
        scene('a', 10, 13, {
          kind: 'api',
          method: 'GET',
          path: '/',
          after: { status: 200, body: '' },
        }),
        scene('d', 13, 16, { kind: 'diagram', nodes: [], edges: [] }),
        scene('k', 16, 19, { kind: 'callout', tone: 'info', title: 'x' }),
        scene('g', 19, 22, { kind: 'change-map', areas: [] }),
      ]),
    ).toEqual([]);
    const cues = buildCues([
      scene('f', 0, 4, {
        kind: 'findings',
        findings: [{ title: 'x', certainty: 'risk', severity: 'low' }],
      }),
      scene('s', 0, 4, { kind: 'summary', verdict: 'looks-good', headline: 'h', points: [] }),
    ]);
    expect(cues.map((c) => c.kind)).toEqual(['verdict', 'finding']);
  });

  it('are the moments the runtime draws: components import them instead of repeating numbers', () => {
    const source = (file: string) =>
      readFileSync(join(import.meta.dirname, '..', 'src', 'runtime', 'components', file), 'utf8');
    const media = source('media.ts');
    const frame = source('frame.ts');
    const cards = source('cards.ts');
    expect(media).toMatch(/from '\.\.\/\.\.\/timeline\/cues\.ts'/);
    expect(frame).toMatch(/from '\.\.\/\.\.\/timeline\/cues\.ts'/);
    expect(cards).toMatch(/from '\.\.\/\.\.\/timeline\/cues\.ts'/);
    for (const [name, text, magic] of [
      [
        'media.ts',
        media,
        /slot \* 0\.6\b|0\.15 \+ i \* 0\.45|seg\(t, 0\.35, 0\.85\)|seg\(t, duration \* 0\.25, duration \* 0\.7\)/,
      ],
      ['frame.ts', frame, /duration \* 0\.62/],
      ['cards.ts', cards, /seg\(t, 0\.3, 0\.7\)/],
    ] as const)
      expect(text, name).not.toMatch(magic);
  });
});

/** Spans compared within floating-point error. */
const close = (span: readonly number[], expected: readonly number[]) => {
  expect(span.length).toBe(expected.length);
  for (const [i, e] of expected.entries()) expect(span[i]).toBeCloseTo(e, 9);
};

describe('phases move events to the words', () => {
  it('pin a screenshot zoom and click, keeping each event as long as before', () => {
    const plain = screenshotTiming(4);
    close(plain.zoom, [0.88, 1.92]);
    close(plain.spot, [1.2, 2]);
    close(plain.move, [1.68, 2.48]);
    close(plain.press, [2.48, 3.2]);
    const pinned = screenshotTiming(4, { zoom: 0.5, click: 3 });
    close(pinned.zoom, [0.5, 0.5 + 4 * 0.26]);
    close(pinned.press, [3, 3 + 4 * 0.18]);
    close(pinned.move, [3 - 4 * 0.2, 3]);
    expect(screenshotPointer(4, { click: 3 }).press[0]).toBe(3);
  });

  it('start interaction steps at their phases and share the rest of the time', () => {
    const even = interactionTiming(6, 3);
    close(
      even.map((s) => s.start),
      [0, 2, 4],
    );
    close(even[1]!.press, [2 + 2 * 0.6, 2 + 2 * 0.85]);
    const pinned = interactionTiming(8, 4, { step3: 5 });
    close(
      pinned.map((s) => s.start),
      [0, 2.5, 5, 6.5],
    );
    expect(activeStep(pinned, 4.99)).toBe(1);
    expect(activeStep(pinned, 5)).toBe(2);
    // A click phase acts on the step showing at that moment.
    const clicked = interactionTiming(6, 3, { click: 3 });
    close(clicked[1]!.press, [3, 3.5]);
    close(clicked[0]!.press, [1.2, 1.7]);
  });

  it('light highlighted lines at their phases', () => {
    const plain = highlightStarts(5, [1, 3]);
    expect(plain.get(1)).toBeCloseTo(5 * 0.32 + 0.05, 9);
    expect(plain.get(3)).toBeCloseTo(5 * 0.32 + 0.15, 9);
    const all = highlightStarts(5, [1, 3], { highlight: 2 });
    expect(all.get(1)).toBeCloseTo(2, 9);
    expect(all.get(3)).toBeCloseTo(2.1, 9);
    const each = highlightStarts(5, [1, 3], { highlight: 2, highlight2: 4 });
    expect(each.get(3)).toBe(4);
  });

  it('reveal the after state at its phase, then focus on it', () => {
    const plain = beforeAfterTiming('split', 5);
    close(plain.reveal, [0.35, 0.85]);
    close(plain.focus, [2, 3.1]);
    const pinned = beforeAfterTiming('split', 5, { reveal: 2 });
    close(pinned.reveal, [2, 2.5]);
    close(pinned.focus, [2.5, 3.6]);
    close(beforeAfterTiming('wipe', 4, { reveal: 1 }).reveal, [1, 2.8]);
    close(beforeAfterTiming('wipe', 4).label, [1.2, 2]);
    expect(beforeAfterReveal('wipe', 4)).toEqual(beforeAfterTiming('wipe', 4).reveal);
  });

  it('bring a finding card, terminal output, and an API response in at their phases', () => {
    close(findingEntrance(1, { finding2: 3 }), [3, 3.55]);
    close(findingEntrance(0, { finding2: 3 }), [0.15, 0.7]);
    close(terminalStarts(5, 1), [0.2]);
    close(terminalStarts(5, 2), [0.2, 2.1]);
    close(terminalStarts(5, 1, { output: 2 }), [1.3]);
    close(apiPanels(4, 2)[1]!, [1.25, 1.75]);
    close(apiPanels(4, 2, { after: 3 })[1]!, [3, 3.5]);
    close(apiPanels(4, 1, { after: 3 })[0]!, [3, 3.5]);
  });

  it('finish a late pinned event, and what follows it, before the scene ends', () => {
    const within = (span: Span, end: number) => {
      expect(span[0]).toBeLessThanOrEqual(span[1]);
      expect(span[1]).toBeLessThanOrEqual(end + 1e-9);
    };
    for (const layout of ['wipe', 'split'] as const) {
      const late = beforeAfterTiming(layout, 5, { reveal: 4 });
      expect(late.reveal[0]).toBe(4);
      for (const span of Object.values(late)) within(span, 5);
      // Compressed, not dropped: the spotlight still plays after the reveal starts.
      expect(late.spot[1]).toBeGreaterThan(late.spot[0]);
      expect(late.spot[0]).toBeGreaterThan(4);
    }
    const shot = screenshotTiming(4, { zoom: 3.6, click: 3.8 });
    expect(shot.zoom[0]).toBe(3.6);
    expect(shot.press[0]).toBe(3.8);
    for (const span of Object.values(shot)) within(span, 4);
    expect(shot.spot[1]).toBeGreaterThan(shot.spot[0]);
    // A late zoom or click in an interaction step ends with its step.
    const steps = interactionTiming(6, 2, { zoom: 2.8, click: 5.9 });
    within(steps[0]!.zoom, 3);
    within(steps[0]!.spot, 3);
    expect(steps[0]!.zoom[0]).toBe(2.8);
    within(steps[1]!.press, 6);
    expect(steps[1]!.press[0]).toBe(5.9);
    within(apiPanels(4, 2, { after: 3.8 })[1]!, 4);
    const ba = {
      kind: 'before-after',
      before: image,
      after: image,
      layout: 'wipe',
      labels: { before: 'Before', after: 'After' },
      focus: { x: 0, y: 0, width: 5, height: 5 },
    } as const;
    expect(settledAt(ba, 5, { reveal: 4 })).toBeLessThanOrEqual(5);
  });

  it('know when each visual has settled', () => {
    const line = { type: 'add', text: 'x' } as const;
    const click = { kind: 'screenshot', image, device: 'desktop', click: { x: 1, y: 1 } } as const;
    const focused = { ...click, focus: { x: 0, y: 0, width: 5, height: 5 } };
    expect(settledAt({ kind: 'callout', tone: 'info', title: 'C' }, 4)).toBe(0.6);
    expect(settledAt(click, 4)).toBeCloseTo(3.2, 9);
    expect(settledAt(focused, 4, { click: 1 })).toBeCloseTo(2, 9);
    expect(
      settledAt({ kind: 'code', path: 'a', lines: [line, line, line, line], highlight: [3] }, 4),
    ).toBeCloseTo(4 * 0.32 + 0.15 + 0.4, 9);
    const finding = { title: 'x', certainty: 'risk', severity: 'low' } as const;
    expect(
      settledAt({ kind: 'findings', findings: [finding, finding] }, 5, { finding2: 3 }),
    ).toBeCloseTo(3.55, 9);
    expect(settledAt({ kind: 'terminal', command: 'x', output: 'a\nb\nc' }, 5)).toBeCloseTo(
      0.2 + 0.7 + 0.15 + 2 * 0.06,
      9,
    );
  });

  it('sound each moment where its phase put it', () => {
    const finding = { title: 'x', certainty: 'likely', severity: 'low' } as const;
    const cues = buildCues([
      {
        ...scene('a', 2, 6, {
          kind: 'screenshot',
          image,
          device: 'desktop',
          click: { x: 1, y: 1 },
        }),
        phases: { click: 1 },
      },
      {
        ...scene('b', 6, 11, {
          kind: 'before-after',
          before: image,
          after: image,
          layout: 'split',
          labels: { before: 'Before', after: 'After' },
        }),
        phases: { reveal: 2 },
      },
      {
        ...scene('f', 11, 16, { kind: 'findings', findings: [finding, finding] }),
        phases: { finding2: 3 },
      },
    ]);
    expect(cues.map((c) => [c.kind, +c.t.toFixed(6)])).toEqual([
      ['click', 3],
      ['reveal', 8],
      ['finding', +(11 + findingLanding(0)).toFixed(6)],
      ['finding', +(11 + findingLanding(1, { finding2: 3 })).toFixed(6)],
    ]);
  });
});
