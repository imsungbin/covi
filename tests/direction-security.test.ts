import { indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { directionProblems } from '../packages/video/src/direction/refs.ts';
import { DIRECTION_LIMITS, DirectionSchema } from '../packages/video/src/direction/schema.ts';
import { directionSources } from '../packages/video/src/direction/sources.ts';

/*
 * A direction file is untrusted: an agent writes it, and the repository it read can steer the
 * agent. These tests are the acceptance check of spec §14: oversized lists, script-like strings,
 * URLs, unknown evidence ids, and made-up numbers are rejected, and a label that passes
 * validation reaches the page only as text.
 */

const rejected = (value: unknown) => !DirectionSchema.safeParse(value).success;
const withLabel = (text: string) => ({
  shots: [{ scene: 's1', elements: [{ id: 'note', kind: 'label', text }] }],
});
const withNode = (label: string) => ({
  shots: [{ scene: 's1', elements: [{ id: 'node', kind: 'node', label }] }],
});

describe('a hostile direction file', () => {
  it('cannot grow past its bounds, and is not refused at them', () => {
    const shot = (i: number) => ({ scene: `s${i}`, elements: [{ id: 'v', kind: 'visual' }] });
    const shots = (n: number) => ({ shots: Array.from({ length: n }, (_, i) => shot(i)) });
    expect(rejected(shots(DIRECTION_LIMITS.shots))).toBe(false);
    expect(rejected(shots(DIRECTION_LIMITS.shots + 1))).toBe(true);
    const elements = (n: number) => ({
      shots: [
        {
          scene: 's1',
          elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: 'visual' })),
        },
      ],
    });
    expect(rejected(elements(DIRECTION_LIMITS.elementsPerShot))).toBe(false);
    expect(rejected(elements(DIRECTION_LIMITS.elementsPerShot + 1))).toBe(true);
    const beats = (n: number) => ({
      shots: [
        {
          scene: 's1',
          elements: [{ id: 'v', kind: 'visual' }],
          beats: Array.from({ length: n }, () => ({ verb: 'reveal', element: 'v' })),
        },
      ],
    });
    expect(rejected(beats(DIRECTION_LIMITS.beatsPerShot))).toBe(false);
    expect(rejected(beats(DIRECTION_LIMITS.beatsPerShot + 1))).toBe(true);
    const cited = (n: number) => ({
      shots: [
        {
          scene: 's1',
          elements: [
            {
              id: 'n',
              kind: 'node',
              label: 'Reader',
              evidence: Array.from({ length: n }, (_, i) => `diff-hunk:a.js:${i + 1}`),
            },
          ],
        },
      ],
    });
    expect(rejected(cited(DIRECTION_LIMITS.evidencePerElement))).toBe(false);
    expect(rejected(cited(DIRECTION_LIMITS.evidencePerElement + 1))).toBe(true);
    expect(rejected(withLabel('x'.repeat(DIRECTION_LIMITS.labelChars)))).toBe(false);
    expect(rejected(withLabel('x'.repeat(DIRECTION_LIMITS.labelChars + 1)))).toBe(true);
  });

  it('cannot smuggle markup, script, or links through a label or a node', () => {
    for (const text of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      'x onerror=alert(1)',
      '"><svg onload=alert(1)>',
      'https://evil.example/x',
      'www.evil.example',
      '{{constructor}}',
      'a`b`',
      // Full-width letters and colons pass the allowlist (CJK labels use them); NFKC folds them.
      'ｗｗｗ.evil.example',
      'ｈｔｔｐｓ：//x',
      'ｊａｖａｓｃｒｉｐｔ：alert',
      // Invisible characters that letters and marks would let in, splitting what the checks seek.
      'https:\u034f//evil.example',
      'https:\ufe0f//evil.example',
      'w\u034fww.evil.example',
      '\u3164\u3164\u3164',
      // Ideographic full stops, which address parsing reads as dots.
      'www。evil。example',
      // Bidi controls, which reorder what is drawn.
      'abc\u202edef',
      'safe\u2067txt.exe\u2069',
    ]) {
      expect(rejected(withLabel(text)), text).toBe(true);
      expect(rejected(withNode(text)), text).toBe(true);
    }
    expect(rejected(withLabel('「요청」이 큼！'))).toBe(false);
    expect(rejected(withLabel('Stale data: refetch'))).toBe(false);
    expect(rejected(withNode('タイム・アウト。'))).toBe(false);
  });

  it('cannot make up numbers: no digits in labels, no value on a metric', () => {
    expect(rejected(withLabel('Ten times faster'))).toBe(false);
    for (const text of ['10x faster', '-85%', '1,024 bytes', '٣ reads', 'Step ²', '１０ times'])
      expect(rejected(withLabel(text)), text).toBe(true);
    expect(
      rejected({
        shots: [
          {
            scene: 's1',
            elements: [{ id: 'm', kind: 'metric', evidence: 'metric:terminal-1:bytes', value: 42 }],
          },
        ],
      }),
    ).toBe(true);
    // The metric case is refused by its kind alone; a value is refused on a drawn kind too.
    expect(
      rejected({
        shots: [{ scene: 's1', elements: [{ id: 'n', kind: 'node', label: 'Reads', value: 42 }] }],
      }),
    ).toBe(true);
  });

  it('cannot pollute prototypes through ids or keys', () => {
    // As JSON.parse reads it: `__proto__` is an own key there, not the prototype.
    const parse = (text: string) => DirectionSchema.safeParse(JSON.parse(text));
    const named = parse(
      '{"shots":[{"scene":"constructor","elements":[{"id":"constructor","kind":"visual"}],' +
        '"beats":[{"verb":"reveal","element":"constructor"}]}]}',
    );
    expect(named.success).toBe(true);
    const shot = named.data!.shots[0]!;
    expect(shot.scene).toBe('constructor');
    expect(shot.elements[0]).toEqual({ id: 'constructor', kind: 'visual' });
    expect(Object.getPrototypeOf(shot)).toBe(Object.prototype);
    for (const id of ['__proto__', 'prototype-', '__defineGetter__']) {
      const text = `{"shots":[{"scene":"s1","elements":[{"id":${JSON.stringify(id)},"kind":"visual"}]}]}`;
      expect(parse(text).success, id).toBe(id === 'prototype-');
    }
    for (const text of [
      '{"shots":[],"__proto__":{"polluted":true}}',
      '{"shots":[{"scene":"s1","elements":[{"id":"v","kind":"visual"}],"__proto__":{"polluted":true}}]}',
      '{"shots":[{"scene":"s1","elements":[{"id":"v","kind":"visual","__proto__":{"polluted":true}}]}]}',
      '{"shots":[],"constructor":{"prototype":{"polluted":true}}}',
    ])
      expect(parse(text).success, text).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('cannot hand the renderer styles, markup, or addresses through any key', () => {
    for (const extra of [{ css: 'x' }, { html: '<b>' }, { url: 'https://x' }, { selector: '#a' }])
      expect(
        rejected({ shots: [{ scene: 's1', elements: [{ id: 'v', kind: 'visual', ...extra }] }] }),
      ).toBe(true);
  });
});

describe('a direction citing evidence the run does not have', () => {
  it('is refused, element by element, before anything renders', () => {
    const evidence = indexEvidence({ items: [] });
    const direction = DirectionSchema.parse({
      shots: [
        {
          scene: 's1',
          elements: [
            { id: 'a', kind: 'code', evidence: 'diff-hunk:../../etc/passwd:1' },
            { id: 'b', kind: 'capture', evidence: 'screenshot:../../secret' },
            { id: 'c', kind: 'output', evidence: 'terminal:999' },
            { id: 'd', kind: 'node', label: 'Made up', evidence: ['metric:x:y'] },
          ],
        },
      ],
    });
    const found = directionProblems(
      direction,
      [{ id: 's1', narration: 'One line.' }],
      evidence,
      directionSources({ evidence }),
    );
    expect(found).toHaveLength(4);
    for (const line of found) expect(line).toMatch(/which the run's evidence does not have/);
  });

  it('cannot reach the terminal through the ids and phrases its problems echo', () => {
    const evidence = indexEvidence({ items: [] });
    // An ANSI clear-screen and a right-to-left override, then an id at the schema's length limit.
    const hostile = `diff-hunk:\u001b[2J\u202e${'x'.repeat(380)}`;
    const direction = DirectionSchema.parse({
      shots: [
        { scene: 'constructor', elements: [{ id: 'v', kind: 'visual' }] },
        {
          scene: 's1',
          elements: [
            { id: 'a', kind: 'code', evidence: hostile },
            { id: 'b', kind: 'node', label: 'Reader', evidence: ['\u001b]8;;https://evil\u0007'] },
          ],
          beats: [{ verb: 'reveal', element: 'a', at: 'One \u001b[31mline\u2028.' }],
        },
      ],
    });
    const found = directionProblems(
      direction,
      [{ id: 's1', narration: 'One line.' }],
      evidence,
      directionSources({ evidence }),
    );
    // Looked up by value: the "constructor" every object has is no scene.
    expect(found[0]).toBe(
      'shot 1 (scene constructor): the storyboard has no scene "constructor" (it has: s1)',
    );
    expect(found).toHaveLength(4);
    for (const line of found) {
      expect(line).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(line.length).toBeLessThan(300);
    }
    expect(found[1]).toContain('"diff-hunk:\\u001b[2J\\u202exxx');
    expect(found[1]).toContain('x…"');
    expect(found[2]).toContain('"\\u001b]8;;https://evil\\u0007"');
    expect(found[3]).toContain('quotes "One \\u001b[31mline\\u2028."');
  });
});
