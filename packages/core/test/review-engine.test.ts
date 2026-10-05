import { describe, expect, it } from 'vitest';
import { parseConfigInput, resolveConfig } from '../src/config/resolve.ts';
import type { ReviewContext } from '../src/model/context.ts';
import { type Finding, gateFailures, normalizeFinding } from '../src/model/finding.ts';
import { buildReview } from '../src/review/engine.ts';

const config = (input = {}) =>
  resolveConfig([{ name: 'repository', values: parseConfigInput(input, 't') }]).config;
const context = { demonstration: { value: 'none' } } as unknown as ReviewContext;

const rule = (id: string, over: Partial<Finding> = {}): Finding =>
  normalizeFinding(
    {
      title: `Rule ${id}`,
      certainty: 'likely',
      severity: 'medium',
      category: 'correctness',
      evidence: 'e',
      explanation: 'x',
      location: { path: 'a.ts', line: 10 },
      ...over,
    },
    { kind: 'rule', id },
  );

describe('buildReview', () => {
  it('merges authored findings, honors dismissals, and drops rule findings an author restated', () => {
    const r1 = rule('r1');
    const r2 = rule('r2', { location: { path: 'b.ts', line: 3 }, category: 'security' });
    const { review } = buildReview({
      ruleFindings: [r1, r2],
      authored: {
        schemaVersion: 1,
        findings: [
          {
            title: 'Null dereference when cart is empty',
            certainty: 'confirmed',
            severity: 'high',
            category: 'correctness',
            evidence: 'cart[0].id',
            explanation: 'crash',
            location: { path: 'a.ts', line: 11 },
          },
        ],
        dismissed: [{ id: r2.id, reason: 'Test fixture, not a real credential.' }],
        checked: ['null handling'],
        notVerified: [],
      },
      authoredSource: 'agent',
      checked: ['rules'],
      config: config(),
      context,
      demonstrated: false,
      generatedBy: { provider: 'agent' },
    });
    expect(review.findings.map((f) => f.title)).toEqual(['Null dereference when cart is empty']);
    expect(review.findings[0]!.source.kind).toBe('agent');
    expect(review.dismissed).toHaveLength(1);
    expect(review.verdict).toBe('needs-changes');
    expect(review.checked).toEqual(['null handling', 'rules']);
  });

  it('prioritizes focus categories and caps the visible list', () => {
    const findings = [
      rule('a', { category: 'performance', location: { path: 'p.ts' } }),
      rule('b', { category: 'security', location: { path: 's.ts' } }),
      rule('c', { category: 'ui', certainty: 'risk', location: { path: 'u.ts' } }),
    ];
    const { review, omitted } = buildReview({
      ruleFindings: findings,
      checked: [],
      config: config({ review: { focus: ['security'], maxFindings: 2 } }),
      context,
      generatedBy: { provider: 'heuristic' },
    });
    expect(review.findings.map((f) => f.source.id)).toEqual(['b', 'a']);
    expect(omitted.map((f) => f.source.id)).toEqual(['c']);
    expect(review.summary).toBe(
      '2 likely issues (1 lower-priority note under "omitted" in review.json).',
    );
  });

  it('says what was not verified', () => {
    const { review } = buildReview({
      ruleFindings: [],
      checked: [],
      config: config({ test: { command: 'npm test' } }),
      context: { demonstration: { value: 'high' } } as unknown as ReviewContext,
      generatedBy: { provider: 'heuristic' },
    });
    expect(review.verdict).toBe('looks-good');
    expect(review.notVerified.join('\n')).toMatch(/Tests were not run \(enable review.runTests/);
    expect(review.notVerified.join('\n')).toMatch(/not demonstrated/);
    expect(review.notVerified.join('\n')).toMatch(/built-in rules only/);
  });
});

describe('gates', () => {
  it('only fails on confirmed or likely findings at or above the threshold', () => {
    const findings = [
      rule('a', { severity: 'medium' }),
      rule('b', { certainty: 'risk', severity: 'high' }),
      rule('c', { certainty: 'confirmed', severity: 'low' }),
    ];
    expect(gateFailures(findings, 'none')).toEqual([]);
    expect(gateFailures(findings, 'high')).toEqual([]);
    expect(gateFailures(findings, 'medium').map((f) => f.source.id)).toEqual(['a']);
    expect(gateFailures(findings, 'low').map((f) => f.source.id)).toEqual(['a', 'c']);
  });
});
