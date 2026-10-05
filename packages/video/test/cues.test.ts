import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  beforeAfterReveal,
  buildCues,
  findingEntrance,
  findingLanding,
  interactionPointer,
  screenshotPointer,
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
