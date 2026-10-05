import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANIMATIONS,
  assetFiles,
  EXPRESSIONS,
  foxMarkSvg,
  foxPose,
  foxSvg,
  logoSvg,
  palette,
} from '../src/index.ts';

function wellFormed(svg: string): void {
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  const tags = [...svg.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)];
  const stack: string[] = [];
  for (const [, closing, name, selfClosing] of tags) {
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name!);
  }
  expect(stack).toEqual([]);
}

describe('fox mascot', () => {
  it('renders every expression as well-formed, deterministic SVG', () => {
    for (const expression of EXPRESSIONS) {
      const svg = foxSvg({ expression });
      wellFormed(svg);
      expect(foxSvg({ expression })).toBe(svg);
      expect(svg).toContain(palette.cobalt);
      expect(svg).toContain(`Covi the fox (${expression})`);
    }
  });

  it('is cobalt, not a conventional orange fox: the warm accent stays a small accent', () => {
    const svg = foxSvg({ expression: 'neutral' });
    const orange = (svg.match(new RegExp(palette.accent, 'g')) ?? []).length;
    const cobalt = (svg.match(new RegExp(palette.cobalt, 'g')) ?? []).length;
    expect(cobalt).toBeGreaterThan(orange);
  });

  it('animates through parameters (blink, talk, gaze) and clamps them', () => {
    const open = foxSvg({ blink: 0 });
    const closed = foxSvg({ blink: 1 });
    expect(open).not.toBe(closed);
    expect(closed).toContain('stroke-linecap="round"');
    expect(foxSvg({ mouth: 2 })).toBe(foxSvg({ mouth: 1 }));
    expect(foxSvg({ look: { x: 1, y: 0 } })).not.toBe(foxSvg({ look: { x: -1, y: 0 } }));
  });

  it('escapes titles and attributes', () => {
    const svg = foxSvg({ title: '<script>', attributes: { 'data-x': 'a"b' } });
    expect(svg).toContain('&lt;script>');
    expect(svg).toContain('data-x="a&quot;b"');
  });

  it('provides a simplified mark and a wordmark logo', () => {
    wellFormed(foxMarkSvg({ size: 16 }));
    wellFormed(logoSvg({ theme: 'dark' }));
    expect(logoSvg()).toContain('>covi</text>');
  });

  it('keeps generated assets in sync with the mascot code', () => {
    for (const [name, content] of Object.entries(assetFiles())) {
      expect(
        readFileSync(join(import.meta.dirname, '../../../assets/covi', name), 'utf8'),
        `assets/covi/${name} is stale; run npm run assets`,
      ).toBe(content);
    }
  });
});

describe('foxPose (the narrator animations)', () => {
  const base = {
    t: 2,
    time: 10,
    mouth: 0,
    blink: 0,
    gaze: { x: -0.7, y: 0.45 },
    pointing: false,
  };

  it('names all seven animations', () => {
    expect(ANIMATIONS).toEqual(['blink', 'talk', 'look', 'think', 'alert', 'approve', 'point']);
  });

  it('is a pure function of time', () => {
    const input = { ...base, expression: 'warning' as const, t: 0.2, seed: 3 };
    expect(foxPose(input)).toEqual(foxPose(input));
  });

  it('blinks, talks, and looks at the content', () => {
    const pose = foxPose({ ...base, expression: 'explaining', mouth: 0.6, blink: 0.5 });
    expect(pose.active).toEqual(expect.arrayContaining(['blink', 'talk', 'look']));
    expect(pose.fox.look).toEqual({ x: -0.7, y: 0.45 });
  });

  it('thinks: sways, looks away, and shows thought dots one by one', () => {
    const early = foxPose({ ...base, expression: 'thinking', t: 0.6 });
    const late = foxPose({ ...base, expression: 'thinking', t: 2 });
    expect(late.active).toContain('think');
    expect(early.fox.propReveal).toBeLessThan(late.fox.propReveal!);
    expect(late.fox.look!.y).toBeLessThan(0); // up and away, not at the content
    expect((foxSvg(early.fox).match(/<circle/g) ?? []).length).toBeLessThan(
      (foxSvg(late.fox).match(/<circle/g) ?? []).length,
    );
  });

  it('alerts: ears flick and the badge pops in', () => {
    const start = foxPose({ ...base, expression: 'warning', t: 0.05 });
    const later = foxPose({ ...base, expression: 'warning', t: 2 });
    expect(start.active).toContain('alert');
    expect(start.fox.propReveal).toBeLessThan(1);
    expect(later.fox.propReveal).toBe(1);
    expect(start.fox.ears).not.toBe(later.fox.ears);
  });

  it('approves: nods while the check badge appears', () => {
    const nods = [0.3, 0.45, 0.6, 0.75].map((t) => foxPose({ ...base, expression: 'success', t }));
    expect(nods[0]!.active).toContain('approve');
    expect(new Set(nods.map((p) => p.fox.bounce!.toFixed(2))).size).toBeGreaterThan(2);
    expect(foxPose({ ...base, expression: 'success', t: 3 }).fox.bounce).toBeCloseTo(0, 1);
  });

  it('points: leans toward highlighted content once it is on screen', () => {
    const before = foxPose({ ...base, expression: 'reviewing', t: 0.3, pointing: true });
    const after = foxPose({ ...base, expression: 'reviewing', t: 2, pointing: true });
    expect(before.active).not.toContain('point');
    expect(after.active).toContain('point');
    expect(after.lean.x).toBeLessThan(0); // the content is to the narrator's left
    expect(foxPose({ ...base, expression: 'reviewing', t: 2 }).lean).toEqual({ x: 0, rotate: 0 });
  });
});
