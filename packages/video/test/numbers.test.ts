import { describe, expect, it } from 'vitest';
import {
  COMPARE_LANDS,
  COMPARE_RISE,
  countProgress,
  DELTA_FADE,
  deltaWindow,
  drawnShow,
  formatNumber,
  formatPercent,
  metricSettled,
  percentChange,
  tickValue,
  VALUE_CENTER,
  valueCentering,
} from '../src/runtime/numbers.ts';

describe('numbers as a video draws them', () => {
  it('group thousands with commas, keep the decimals asked for, and use a real minus', () => {
    expect(formatNumber(70406, 0)).toBe('70,406');
    expect(formatNumber(9907, 0)).toBe('9,907');
    expect(formatNumber(999, 0)).toBe('999');
    expect(formatNumber(1234567.891, 3)).toBe('1,234,567.891');
    expect(formatNumber(0.5, 2)).toBe('0.50');
    expect(formatNumber(-12.5, 1)).toBe('−12.5');
    expect(formatNumber(-0.0001, 2)).toBe('0.00');
    expect(formatNumber(999_999_999_999_999, 0)).toBe('999,999,999,999,999');
  });

  it('derive the change in percent, whole from ten up, never from zero', () => {
    expect(percentChange(70406, 9907)).toBe(-86);
    expect(percentChange(4, 1)).toBe(-75);
    expect(percentChange(1, 0)).toBe(-100);
    expect(percentChange(200, 209)).toBe(4.5);
    expect(percentChange(-50, -25)).toBe(50);
    expect(percentChange(10, 10)).toBe(0);
    expect(percentChange(1000, 999.9996)).toBe(0);
    expect(percentChange(0, 5)).toBeUndefined();
    expect(formatPercent(-86)).toBe('−86%');
    expect(formatPercent(4.5)).toBe('+4.5%');
    expect(formatPercent(1234)).toBe('+1,234%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('tick from one value to the other with an ease-out, landing exactly', () => {
    const count = { t: 1, seconds: 2 };
    expect(countProgress(0.5, count)).toBe(0);
    expect(countProgress(2, count)).toBeCloseTo(0.875, 9);
    expect(countProgress(3, count)).toBe(1);
    expect(countProgress(9, undefined)).toBe(1);
    expect(tickValue(70406, 9907, 0, 0)).toBe(70406);
    expect(tickValue(70406, 9907, 0.875, 0)).toBe(17469);
    expect(tickValue(70406, 9907, 1, 0)).toBe(9907);
    expect(tickValue(1.25, 0.5, 0.5, 2)).toBe(0.88);
    // Each step of the count is a value the counter can print.
    for (let k = 0; k <= 1; k += 0.05) {
      const v = tickValue(70406, 9907, k, 0);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeLessThanOrEqual(70406);
      expect(v).toBeGreaterThanOrEqual(9907);
    }
  });

  it('fade the change in once the value has landed, and settle when it is in', () => {
    const count = { t: 1, seconds: 1.6 };
    const landed = COMPARE_LANDS + COMPARE_RISE;
    expect(deltaWindow('counter', count)).toEqual([2.6, 2.6 + DELTA_FADE]);
    expect(deltaWindow('bars', count)).toEqual([2.6, 2.6 + DELTA_FADE]);
    expect(deltaWindow('compare', undefined)).toEqual([landed, landed + DELTA_FADE]);
    // Nothing lands later: the change comes in with the card.
    expect(deltaWindow('counter', undefined)).toBeUndefined();
    expect(deltaWindow('bars', undefined)).toBeUndefined();
    const compare = { show: 'compare' as const, from: 70406, delta: -86 };
    expect(metricSettled(compare, undefined)).toBeCloseTo(landed + DELTA_FADE, 9);
    expect(metricSettled({ ...compare, delta: undefined }, undefined)).toBeCloseTo(landed, 9);
    expect(metricSettled(compare, count)).toBeCloseTo(2.6 + DELTA_FADE, 9);
    // One value alone is drawn as a counter, whatever it asks for.
    expect(drawnShow({ show: 'compare' })).toBe('counter');
    expect(metricSettled({ show: 'compare' }, undefined)).toBe(0);
  });

  it('center a counted value once it has landed, and settle when it is centered', () => {
    const count = { t: 1, seconds: 1.6 };
    const counter = { show: 'counter' as const, from: 70406 };
    expect(valueCentering(counter, count)).toEqual([2.6, 2.6 + VALUE_CENTER]);
    // Without a count, or a value to count from, the value is drawn centered from the start.
    expect(valueCentering(counter, undefined)).toBeUndefined();
    expect(valueCentering({ show: 'counter' }, count)).toBeUndefined();
    // Bars and a compare hold their values' columns; only the counter's value is alone in its row.
    expect(valueCentering({ ...counter, show: 'bars' }, count)).toBeUndefined();
    expect(valueCentering({ ...counter, show: 'compare' }, count)).toBeUndefined();
    expect(metricSettled(counter, count)).toBeCloseTo(2.6 + VALUE_CENTER, 9);
    expect(metricSettled({ ...counter, delta: -86 }, count)).toBeCloseTo(
      2.6 + Math.max(VALUE_CENTER, DELTA_FADE),
      9,
    );
    expect(metricSettled({ ...counter, show: 'bars' }, count)).toBeCloseTo(2.6, 9);
  });
});
