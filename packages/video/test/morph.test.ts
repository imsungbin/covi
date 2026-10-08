import { describe, expect, it } from 'vitest';
import { typedPrefix } from '../src/runtime/anim.ts';

describe('typing a line', () => {
  it('shows the first share of it, by character', () => {
    expect(typedPrefix('abcd', 0)).toBe('');
    expect(typedPrefix('abcd', 0.5)).toBe('ab');
    expect(typedPrefix('abcd', 0.99)).toBe('abc');
    expect(typedPrefix('abcd', 1)).toBe('abcd');
    expect(typedPrefix('abcd', 2)).toBe('abcd');
    expect(typedPrefix('abcd', -1)).toBe('');
  });

  it('never splits a character', () => {
    const line = 'const 수량 = "🙂🎉";';
    for (let k = 0; k <= 1.0001; k += 0.01) {
      const shown = typedPrefix(line, k);
      expect(line.startsWith(shown)).toBe(true);
      expect(shown).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    expect(typedPrefix('🙂🙂', 0.5)).toBe('🙂');
  });
});
