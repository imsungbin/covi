import { describe, expect, it } from 'vitest';
import { DIRECTION_LIMITS, DirectionSchema } from '../packages/video/src/direction/schema.ts';

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
  it('cannot grow past its bounds', () => {
    const shot = (i: number) => ({ scene: `s${i}`, elements: [{ id: 'v', kind: 'visual' }] });
    expect(
      rejected({ shots: Array.from({ length: DIRECTION_LIMITS.shots + 1 }, (_, i) => shot(i)) }),
    ).toBe(true);
    expect(
      rejected({
        shots: [
          {
            scene: 's1',
            elements: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, kind: 'visual' })),
          },
        ],
      }),
    ).toBe(true);
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
    ]) {
      expect(rejected(withLabel(text)), text).toBe(true);
      expect(rejected(withNode(text)), text).toBe(true);
    }
    expect(rejected(withLabel('「요청」이 큼！'))).toBe(false);
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
  });

  it('cannot hand the renderer styles, markup, or addresses through any key', () => {
    for (const extra of [{ css: 'x' }, { html: '<b>' }, { url: 'https://x' }, { selector: '#a' }])
      expect(
        rejected({ shots: [{ scene: 's1', elements: [{ id: 'v', kind: 'visual', ...extra }] }] }),
      ).toBe(true);
  });
});
