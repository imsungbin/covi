import { parseOrThrow, UsageError } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  emphasisSpan,
  findPhrase,
  parseEmphasis,
  phaseNames,
  stripEmphasis,
} from '../src/storyboard/grammar.ts';
import {
  type StoryboardInput,
  StoryboardSchema,
  TRANSITION_KINDS,
  type Visual,
} from '../src/storyboard/schema.ts';

const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const shot = {
  kind: 'screenshot',
  image: { path: 'demo/screenshots/a.png' },
  focus: { x: 0, y: 0, width: 10, height: 10 },
  click: { x: 5, y: 5 },
} as const;
const step = { image: { path: 'demo/screenshots/a.png' } };

/** A valid storyboard that uses every new field; each test breaks one thing. */
function storyboard(): StoryboardInput {
  return {
    title: 'Clamp quantities',
    template: 'bug-fix',
    scenes: [
      {
        id: 'open',
        beat: 'context',
        narration: 'Remove one too many, and the cart says [[minus one]].',
        visual: {
          kind: 'title',
          title: 'Clamp quantities',
          background: { path: 'demo/screenshots/a.png' },
        },
      },
      {
        id: 'fix',
        beat: 'fix',
        narration: 'The fix clamps the quantity, and the cart stops at zero.',
        transition: 'cut',
        sync: { highlight: 'clamps the quantity' },
        visual: {
          kind: 'code',
          path: 'src/cart.js',
          lines: [{ type: 'add', text: 'qty = Math.max(0, qty - 1);' }],
          highlight: [0],
        },
      },
      {
        id: 'proof',
        beat: 'proof',
        hero: true,
        camera: 'static',
        narration: 'Click minus at zero, and nothing happens.',
        sync: { zoom: 'Click minus', click: 'nothing happens', hero: 'nothing happens' },
        visual: shot,
      },
      {
        id: 'wrap',
        beat: 'summary',
        narration: 'Ready to merge.',
        transition: 'push',
        visual: callout,
      },
    ],
  };
}

/** The schema's issues as `path: message` lines, the way `parseOrThrow` prints them. */
const issues = (input: unknown) => {
  const result = StoryboardSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('caption emphasis markup', () => {
  it('reads one [[…]] phrase and removes the markup', () => {
    expect(parseEmphasis('The cart says [[minus one]].')).toEqual({
      text: 'The cart says minus one.',
      phrase: 'minus one',
      at: 14,
    });
    expect(parseEmphasis('[[ Zero ]] is the floor.')).toEqual({
      text: ' Zero  is the floor.',
      phrase: 'Zero',
      at: 1,
    });
    expect(parseEmphasis('No markup here.')).toEqual({ text: 'No markup here.' });
  });

  it('reports broken markup and never leaves brackets in the text', () => {
    for (const [line, error] of [
      ['Two [[marks]] in [[one]] line.', /more than one/],
      ['An [[unclosed mark.', /unbalanced/],
      ['A stray]] close.', /unbalanced/],
      ['Nested [[a [[b]] c]].', /unbalanced/],
      ['Empty [[ ]] mark.', /empty/],
    ] as const) {
      const parsed = parseEmphasis(line);
      expect(parsed.error, line).toMatch(error);
      expect(parsed.phrase, line).toBeUndefined();
      expect(parsed.text, line).not.toMatch(/\[\[|\]\]/);
    }
    expect(stripEmphasis('a [[b]] c]] [[')).toBe('a b c ');
  });

  it('places the phrase in characters without whitespace', () => {
    expect(emphasisSpan(parseEmphasis('The cart  says [[minus one]].'))).toEqual({
      index: 11,
      length: 8,
    });
    expect(emphasisSpan(parseEmphasis('남은 [[글자 수]]가 보입니다.'))).toEqual({
      index: 2,
      length: 3,
    });
    expect(emphasisSpan(parseEmphasis('No markup.'))).toBeUndefined();
  });
});

describe('finding a synced phrase', () => {
  it('matches up to whitespace and counts in characters without whitespace', () => {
    expect(findPhrase('Open the composer,  type\na comment.', 'type a comment')).toEqual({
      index: 16,
      length: 12,
      count: 1,
    });
  });

  it('is case-sensitive, and finds nothing for a missing or blank phrase', () => {
    expect(findPhrase('Press Post.', 'press post').count).toBe(0);
    expect(findPhrase('Press Post.', 'Press Post').count).toBe(1);
    expect(findPhrase('Anything.', '  ')).toEqual({ index: -1, length: 0, count: 0 });
  });

  it('counts every occurrence, overlapping ones too', () => {
    expect(findPhrase('the cart and the list', 'the').count).toBe(2);
    expect(findPhrase('aaa', 'aa').count).toBe(2);
    expect(findPhrase('the cart and the list', 'the cart').index).toBe(0);
  });

  it('counts characters, not UTF-16 units, in CJK text and around emoji', () => {
    expect(findPhrase('残りの文字数が表示されます。', '文字数')).toEqual({
      index: 3,
      length: 3,
      count: 1,
    });
    expect(findPhrase('🎉 Ready to merge.', 'merge')).toEqual({ index: 8, length: 5, count: 1 });
  });
});

describe('phase names', () => {
  it('lists the moments each visual can pin to a phrase', () => {
    const v = (visual: unknown) => phaseNames(visual as Visual);
    expect(v(shot)).toEqual(['zoom', 'click']);
    expect(v({ kind: 'interaction', steps: [step, step, step] })).toEqual([
      'zoom',
      'click',
      'step2',
      'step3',
    ]);
    const code = (highlight: number[]) => ({ kind: 'code', path: 'a', lines: [], highlight });
    expect(v(code([1, 3]))).toEqual(['highlight', 'highlight1', 'highlight2']);
    expect(v(code([]))).toEqual([]);
    expect(v({ kind: 'before-after' })).toEqual(['reveal']);
    expect(v({ kind: 'findings', findings: [{}, {}] })).toEqual(['finding1', 'finding2']);
    expect(v({ kind: 'terminal' })).toEqual(['output']);
    expect(v({ kind: 'api' })).toEqual(['after']);
    expect(v(callout)).toEqual([]);
  });
});

describe('the storyboard schema', () => {
  it('accepts every timing field', () => {
    expect(issues(storyboard())).toEqual([]);
    expect([...TRANSITION_KINDS]).toEqual(['fade', 'cut', 'push', 'wipe', 'zoom-through']);
  });

  it('holds up to 24 scenes', () => {
    const many = (n: number) => ({
      ...storyboard(),
      scenes: Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        beat: 'b',
        narration: 'x',
        visual: callout,
      })),
    });
    expect(issues(many(24))).toEqual([]);
    expect(issues(many(25))).toHaveLength(1);
    expect(issues(many(25))[0]).toMatch(/^scenes: /);
  });

  it('rejects a second hero, naming the scene', () => {
    const sb = storyboard();
    sb.scenes[1]!.hero = true;
    expect(issues(sb)).toEqual([
      'scenes.2.hero: scene proof: only one scene can be the hero, and fix already is',
    ]);
  });

  it('rejects a sync phrase that is missing or repeated, naming the scene and the phase', () => {
    const missing = storyboard();
    missing.scenes[2]!.sync = { zoom: 'Tap minus' };
    expect(issues(missing)).toEqual([
      'scenes.2.sync.zoom: scene proof: sync.zoom quotes "Tap minus", which is not in its narration',
    ]);
    const twice = storyboard();
    twice.scenes[1]!.narration = 'Below zero becomes zero.';
    twice.scenes[1]!.sync = { highlight: 'zero' };
    expect(issues(twice)).toEqual([
      'scenes.1.sync.highlight: scene fix: sync.highlight quotes "zero", which appears 2 times in its narration; quote enough words to make it unique',
    ]);
  });

  it('matches a phrase inside [[…]] against the line without markup', () => {
    const sb = storyboard();
    sb.scenes[2]!.narration = 'Click minus at zero, and [[nothing happens]].';
    expect(issues(sb)).toEqual([]);
  });

  it('rejects a phase the visual does not have, and the hero phase off the hero', () => {
    const wrong = storyboard();
    wrong.scenes[1]!.sync = { zoom: 'clamps the quantity' };
    expect(issues(wrong)).toEqual([
      'scenes.1.sync.zoom: scene fix: a code scene has no "zoom" phase (it has: highlight, highlight1)',
    ]);
    const offHero = storyboard();
    offHero.scenes[1]!.sync = { hero: 'clamps the quantity' };
    expect(issues(offHero)).toEqual([
      'scenes.1.sync.hero: scene fix: sync.hero belongs to the hero scene; set "hero": true there, or remove it',
    ]);
  });

  it('rejects interaction steps synced out of order', () => {
    const sb = storyboard();
    sb.scenes[2] = {
      id: 'flow',
      beat: 'proof',
      narration: 'Type a comment, then post it, then edit it.',
      sync: { step2: 'then edit it', step3: 'then post it' },
      visual: { kind: 'interaction', steps: [step, step, step] },
    };
    expect(issues(sb)).toEqual([
      "scenes.2.sync.step3: scene flow: sync.step3's phrase comes before sync.step2's; steps play in order",
    ]);
  });

  it('rejects doubled or broken caption markup', () => {
    const sb = storyboard();
    sb.scenes[0]!.narration = 'Remove one [[too many]], and the cart says [[minus one]].';
    expect(issues(sb)).toEqual([
      "scenes.0.narration: scene open: more than one [[…]]: mark only the line's key phrase",
    ]);
  });

  it('rejects unknown transitions and camera modes', () => {
    const sb = storyboard() as unknown as { scenes: Array<Record<string, unknown>> };
    sb.scenes[1]!.transition = 'dissolve';
    sb.scenes[2]!.camera = 'shaky';
    expect(issues(sb).map((i) => i.split(':')[0])).toEqual([
      'scenes.1.transition',
      'scenes.2.camera',
    ]);
  });

  it('fails as a usage error (exit 2) that names the scene', () => {
    const sb = storyboard();
    sb.scenes[2]!.sync = { zoom: 'Tap minus' };
    expect(() => parseOrThrow(StoryboardSchema, sb, 'storyboard.json')).toThrow(UsageError);
    expect(() => parseOrThrow(StoryboardSchema, sb, 'storyboard.json')).toThrow(
      /scene proof: sync\.zoom quotes "Tap minus"/,
    );
  });
});
