import { describe, expect, it } from 'vitest';
import { highlightGroups, phaseNames, visualMarks } from '../src/storyboard/grammar.ts';
import {
  CUE_KINDS,
  type StoryboardInput,
  StoryboardSchema,
  type Visual,
} from '../src/storyboard/schema.ts';

const image = { path: 'demo/screenshots/a.png' };
const box = (x: number) => ({ x, y: 0, width: 10, height: 10 });

/** A valid storyboard that uses every new field; each test breaks one thing. */
function storyboard(): StoryboardInput {
  return {
    title: 'Clamp quantities',
    template: 'bug-fix',
    scenes: [
      {
        id: 'fix',
        beat: 'fix',
        narration: 'Minus one becomes a clamp at zero, so the cart stops.',
        sync: { morph: 'becomes a clamp', stop: 'the cart stops' },
        cues: [{ at: 'stop', kind: 'click' }],
        visual: {
          kind: 'code',
          path: 'src/cart.js',
          mode: 'morph',
          lines: [
            { type: 'del', text: 'qty = qty - 1;' },
            { type: 'add', text: 'qty = Math.max(0, qty - 1);' },
            { type: 'context', text: 'render(cart);' },
          ],
          highlight: [{ lines: [1, 2], sync: 'stop' }],
          caption: 'Clamped at zero',
        },
      },
      {
        id: 'page',
        beat: 'proof',
        hero: true,
        narration: 'The total updates, the badge clears, and checkout opens.',
        sync: { mark2: 'the badge clears', open: 'checkout opens' },
        cues: [
          { at: 'hero', kind: 'riser' },
          { at: 1.2, kind: 'reveal' },
        ],
        visual: {
          kind: 'screenshot',
          image,
          marks: [
            { focus: box(0), label: 'Total' },
            { focus: box(20), label: 'Badge' },
            { focus: box(40), sync: 'open' },
          ],
          click: { x: 45, y: 5 },
        },
      },
      {
        id: 'flow',
        beat: 'interaction',
        narration: 'Add an item, then open the cart.',
        sync: { step2: 'then open the cart' },
        visual: {
          kind: 'interaction',
          steps: [
            { image, marks: [{ focus: box(0) }] },
            { image, marks: [{ focus: box(10) }, { focus: box(20) }] },
          ],
        },
      },
    ],
  };
}

/** The schema's issues as `path: message` lines, the way `parseOrThrow` prints them. */
const issues = (input: unknown) => {
  const result = StoryboardSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

/** Mutable access to a scene's visual, for breaking one field. */
const visualOf = (sb: StoryboardInput, i: number) =>
  sb.scenes[i]!.visual as unknown as Record<string, unknown> & {
    marks?: Array<Record<string, unknown>>;
    steps?: Array<{ marks?: Array<Record<string, unknown>> }>;
    highlight?: Array<Record<string, unknown>>;
  };

describe('component fields', () => {
  it('accept a code morph, highlight groups, marks, and cues', () => {
    expect(issues(storyboard())).toEqual([]);
    expect([...CUE_KINDS]).toEqual(['click', 'reveal', 'finding', 'transition', 'riser', 'hero']);
    const sb = storyboard();
    visualOf(sb, 0).mode = 'diff';
    expect(issues(sb)).toEqual([
      'scenes.0.sync.morph: scene fix: a code scene has no "morph" phase (it has: highlight, stop)',
    ]);
  });

  it('name the phases of groups and marks', () => {
    const [fix, page, flow] = StoryboardSchema.parse(storyboard()).scenes;
    expect(phaseNames(fix!.visual)).toEqual(['highlight', 'stop', 'morph']);
    expect(phaseNames(page!.visual)).toEqual(['zoom', 'click', 'mark1', 'mark2', 'open']);
    expect(phaseNames(flow!.visual)).toEqual(['zoom', 'click', 'step2', 'mark1', 'mark2', 'mark3']);
    // A plain list keeps PR 2's names.
    const code = (highlight: unknown[]) =>
      phaseNames({ kind: 'code', path: 'a', lines: [], highlight } as unknown as Visual);
    expect(code([1, 3])).toEqual(['highlight', 'highlight1', 'highlight2']);
    expect(code([])).toEqual([]);
  });

  it('read highlight entries as groups, and number marks through the visual', () => {
    expect(highlightGroups([3, { lines: 5 }, { lines: [6, 7], sync: 'fix' }])).toEqual([
      { lines: [3], phase: 'highlight1' },
      { lines: [5], phase: 'highlight2' },
      { lines: [6, 7], phase: 'fix' },
    ]);
    const [, page, flow] = StoryboardSchema.parse(storyboard()).scenes;
    expect(visualMarks(page!.visual)).toEqual([
      { focus: box(0), label: 'Total', phase: 'mark1' },
      { focus: box(20), label: 'Badge', phase: 'mark2' },
      { focus: box(40), phase: 'open' },
    ]);
    expect(visualMarks(flow!.visual)).toEqual([
      { focus: box(0), phase: 'mark1', step: 0 },
      { focus: box(10), phase: 'mark2', step: 1 },
      { focus: box(20), phase: 'mark3', step: 1 },
    ]);
  });
});

describe('marks', () => {
  it('reject marks together with focus, on a screenshot or a step', () => {
    const shot = storyboard();
    visualOf(shot, 1).focus = box(0);
    expect(issues(shot)).toEqual([
      'scenes.1.visual.marks: scene page: set marks, or focus as the one-mark shorthand, not both',
    ]);
    const step = storyboard();
    (visualOf(step, 2).steps![1] as Record<string, unknown>).focus = box(0);
    expect(issues(step)).toEqual([
      'scenes.2.visual.steps.1.marks: scene flow: step 2: set marks, or focus as the one-mark shorthand, not both',
    ]);
  });

  it('reject two marks that share a phase', () => {
    const sb = storyboard();
    visualOf(sb, 1).marks![0]!.sync = 'mark2';
    expect(issues(sb)).toEqual([
      'scenes.1.visual.marks.1: scene page: marks 1 and 2 share phase "mark2"; give each mark its own moment',
    ]);
  });

  it('reject marks synced out of order', () => {
    const sb = storyboard();
    sb.scenes[1]!.sync = { mark2: 'checkout opens', open: 'the badge clears' };
    expect(issues(sb)).toEqual([
      "scenes.1.sync.open: scene page: sync.open's phrase comes before sync.mark2's; marks play in order",
    ]);
  });

  it('take the hero phase only on the hero scene', () => {
    const off = storyboard();
    visualOf(off, 2).steps![0]!.marks![0]!.sync = 'hero';
    expect(issues(off)).toEqual([
      'scenes.2.visual.steps.0.marks.0.sync: scene flow: step 1 mark 1 names phase "hero", which only the hero scene has',
    ]);
    const on = storyboard();
    visualOf(on, 1).marks![0]!.sync = 'hero';
    expect(issues(on)).toEqual([]);
  });

  it('hold one to three marks with a short gloss', () => {
    const none = storyboard();
    visualOf(none, 1).marks = [];
    expect(issues(none)[0]).toMatch(/^scenes\.1\.visual\.marks: /);
    const four = storyboard();
    visualOf(four, 1).marks = [0, 10, 20, 30].map((x) => ({ focus: box(x) }));
    expect(issues(four)[0]).toMatch(/^scenes\.1\.visual\.marks: /);
    const long = storyboard();
    visualOf(long, 1).marks![0]!.label = 'x'.repeat(41);
    expect(issues(long)[0]).toMatch(/^scenes\.1\.visual\.marks\.0\.label: /);
  });
});

describe('named phases', () => {
  it('reject a phase an entry names that sync does not define', () => {
    const sb = storyboard();
    visualOf(sb, 0).highlight![0]!.sync = 'stopp';
    expect(issues(sb)).toEqual([
      'scenes.0.sync.stop: scene fix: a code scene has no "stop" phase (it has: highlight, stopp, morph)',
      'scenes.0.visual.highlight.0.sync: scene fix: highlight entry 1 names phase "stopp", which sync does not define; add sync.stopp with a phrase from the narration',
    ]);
  });
});

describe('cues', () => {
  it('reject a cue at a phase sync does not define, even constructor', () => {
    for (const at of ['gone', 'constructor']) {
      const sb = storyboard();
      sb.scenes[0]!.cues = [{ at, kind: 'click' }];
      expect(issues(sb)).toEqual([
        `scenes.0.cues.0.at: scene fix: cue 1 plays at "${at}", a phase this scene does not pin; add sync.${at}, or give seconds`,
      ]);
    }
    const hero = storyboard();
    hero.scenes[0]!.cues = [{ at: 'hero', kind: 'click' }];
    expect(issues(hero)).toEqual([
      'scenes.0.cues.0.at: scene fix: cue 1 plays at "hero", which only the hero scene has',
    ]);
  });

  it('keep the riser and the hit for the hero', () => {
    const sb = storyboard();
    sb.scenes[0]!.cues = [
      { at: 'stop', kind: 'click' },
      { at: 0.5, kind: 'riser' },
      { at: 0.8, kind: 'hero' },
    ];
    expect(issues(sb)).toEqual([
      'scenes.0.cues.1.kind: scene fix: a riser cue belongs to the hero scene',
      'scenes.0.cues.2.kind: scene fix: a hero cue belongs to the hero scene',
    ]);
  });

  it('are bounded: known kinds, 0–30 s, at most four a scene', () => {
    const kind = storyboard() as unknown as { scenes: Array<{ cues: unknown[] }> };
    kind.scenes[0]!.cues = [{ at: 0.5, kind: 'verdict' }];
    expect(issues(kind)[0]).toMatch(/^scenes\.0\.cues\.0\.kind: /);
    const early = storyboard();
    early.scenes[0]!.cues = [{ at: -1, kind: 'click' }];
    expect(issues(early)[0]).toMatch(/^scenes\.0\.cues\.0\.at: /);
    const many = storyboard();
    many.scenes[0]!.cues = Array.from({ length: 5 }, (_, i) => ({ at: i, kind: 'click' as const }));
    expect(issues(many)[0]).toMatch(/^scenes\.0\.cues: /);
  });
});
