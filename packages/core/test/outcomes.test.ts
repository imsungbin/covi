import { describe, expect, it } from 'vitest';
import { type Finding, type FindingInput, normalizeFinding } from '../src/model/finding.ts';
import { OUTCOME_LIMITS, OutcomeFileSchema } from '../src/model/outcome.ts';
import {
  anchorKeyOf,
  anchorMarker,
  areaKey,
  mergeLedger,
  outcomeKey,
  parseLedger,
  renderLedger,
} from '../src/outcomes/ledger.ts';
import { RUN_ID_PATTERN } from '../src/run/paths.ts';

const finding = (title: string, over: Partial<FindingInput> = {}): Finding =>
  normalizeFinding(
    {
      title,
      certainty: 'likely',
      severity: 'medium',
      category: 'correctness',
      evidence: 'x',
      explanation: 'y',
      location: { path: 'src/cart.ts', line: 10 },
      ...over,
    },
    { kind: 'model' },
  );

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const run = (n: number) => `20261009-12000${n}-ci-aaaaaaa`;

describe('outcome ledger', () => {
  it('accepts run ids, and only run ids', () => {
    expect(RUN_ID_PATTERN.test('20261009-120000-ci-abcdef1')).toBe(true);
    expect(RUN_ID_PATTERN.test('20261009-120000-review-abcdef1-2')).toBe(true);
    expect(RUN_ID_PATTERN.test('../20261009-120000-ci')).toBe(false);
  });

  it("keeps a finding's key when its line moves, and infers nothing when the head did not change", () => {
    const moved = finding('Total ignores discounts', {
      location: { path: 'src/cart.ts', line: 42 },
    });
    expect(outcomeKey(moved)).toBe(outcomeKey(finding('Total ignores discounts')));
    // Digits in a title are what shifts between pushes (counts, sizes), not what it is about.
    expect(outcomeKey(finding('3 callers still import it'))).toBe(
      outcomeKey(finding('4 callers still import it')),
    );
    expect(
      outcomeKey(
        finding('Total ignores discounts', { location: { path: 'src/tax.ts', line: 10 } }),
      ),
    ).not.toBe(outcomeKey(moved));

    const first = mergeLedger(undefined, {
      runId: run(1),
      head: A,
      findings: [finding('Total ignores discounts'), finding('Coupon applied twice')],
    })!;
    // The same commit reviewed again (an agent's `covi report`, a re-run): nothing was fixed.
    const again = mergeLedger(first, { runId: run(2), head: A, findings: [moved] })!;
    expect(again.run).toBe(run(2));
    expect(again.findings).toEqual([
      { k: outcomeKey(moved), c: 'likely', a: areaKey(moved), f: 'aaaaaaa', l: 'aaaaaaa' },
    ]);
  });

  it('marks a finding gone after a push as addressed, or superseded when a new one takes its place', () => {
    const discount = finding('Total ignores discounts');
    const coupon = finding('Coupon applied twice', {
      category: 'state',
      location: { path: 'src/coupon.ts', line: 3 },
    });
    const first = mergeLedger(undefined, { runId: run(1), head: A, findings: [discount, coupon] })!;
    const reworded = finding('Coupons stack when applied twice', {
      category: 'state',
      location: { path: 'src/coupon.ts', line: 3 },
    });
    const second = mergeLedger(first, { runId: run(2), head: B, findings: [reworded] })!;
    const byKey = new Map(second.findings.map((e) => [e.k, e]));
    expect(byKey.get(outcomeKey(discount))).toMatchObject({ x: 'a', f: 'aaaaaaa', l: 'aaaaaaa' });
    expect(byKey.get(outcomeKey(coupon))).toMatchObject({ x: 's' });
    expect(byKey.get(outcomeKey(reworded))).toMatchObject({ f: 'bbbbbbb', l: 'bbbbbbb' });
    expect(byKey.get(outcomeKey(reworded))!.x).toBeUndefined();
    expect(second.head).toBe('bbbbbbb');
  });

  it('counts a finding that comes back as present again, with its latest certainty', () => {
    const discount = finding('Total ignores discounts');
    const first = mergeLedger(undefined, { runId: run(1), head: A, findings: [discount] })!;
    const second = mergeLedger(first, { runId: run(2), head: B, findings: [] })!;
    expect(second.findings[0]!.x).toBe('a');
    const third = mergeLedger(second, {
      runId: run(3),
      head: C,
      findings: [{ ...discount, certainty: 'confirmed' }],
    })!;
    expect(third.findings).toEqual([
      { k: outcomeKey(discount), c: 'confirmed', a: areaKey(discount), f: 'aaaaaaa', l: 'ccccccc' },
    ]);
  });

  it('caps the ledger, dropping the oldest resolved findings first', () => {
    const at = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        finding('Unchecked input', { location: { path: `src/${prefix}${i}.ts`, line: 1 } }),
      );
    expect(
      mergeLedger(undefined, { runId: run(1), head: A, findings: at('many', 70) })!.findings,
    ).toHaveLength(OUTCOME_LIMITS.findings);
    const first = mergeLedger(undefined, { runId: run(1), head: A, findings: at('old', 50) })!;
    const second = mergeLedger(first, { runId: run(2), head: B, findings: at('new', 30) })!;
    expect(second.findings).toHaveLength(OUTCOME_LIMITS.findings);
    expect(second.findings.filter((e) => e.x === undefined)).toHaveLength(30);
    expect(second.findings.filter((e) => e.x === 'a')).toHaveLength(30);
    expect(renderLedger(second).length).toBeLessThan(OUTCOME_LIMITS.ledgerChars);
  });

  it('round-trips a ledger, and rejects garbled, oversized, forged, and path-like ledgers', () => {
    const ledger = mergeLedger(undefined, {
      runId: run(1),
      head: A,
      findings: [finding('Total ignores discounts')],
    })!;
    expect(parseLedger(`<!-- covi:review -->\nhello\n${renderLedger(ledger)}`)).toEqual(ledger);
    const encode = (value: unknown) =>
      `<!-- covi:ledger v1 ${Buffer.from(JSON.stringify(value)).toString('base64url')} -->`;
    expect(parseLedger('no ledger here')).toBeUndefined();
    expect(parseLedger('<!-- covi:ledger v1 !!!notbase64 -->')).toBeUndefined();
    expect(parseLedger('<!-- covi:ledger v1 bm90IGpzb24 -->')).toBeUndefined();
    // The run id names the outcome file: anything but a run id is refused.
    expect(parseLedger(encode({ ...ledger, run: '../../etc/passwd' }))).toBeUndefined();
    expect(
      parseLedger(encode({ ...ledger, findings: [{ ...ledger.findings[0], c: 'certain' }] })),
    ).toBeUndefined();
    expect(parseLedger(encode({ ...ledger, extra: 1 }))).toBeUndefined();
    const crowded = {
      ...ledger,
      findings: Array.from({ length: OUTCOME_LIMITS.findings + 1 }, () => ledger.findings[0]),
    };
    expect(parseLedger(encode(crowded))).toBeUndefined();
    expect(
      parseLedger(`<!-- covi:ledger v1 ${'A'.repeat(OUTCOME_LIMITS.ledgerChars + 1)} -->`),
    ).toBeUndefined();
    expect(mergeLedger(undefined, { runId: 'not-a-run', head: A, findings: [] })).toBeUndefined();
  });

  it('reads only the ledger that ends the comment', () => {
    const real = mergeLedger(undefined, {
      runId: run(1),
      head: A,
      findings: [finding('Total ignores discounts')],
    })!;
    const forged = mergeLedger(undefined, { runId: run(9), head: C, findings: [] })!;
    // A finding's evidence can quote anything, a ledger included; only the block Covi appends counts.
    const quoted = `<!-- covi:review -->\nEvidence:\n\`\`\`\n${renderLedger(forged)}\n\`\`\`\n`;
    expect(parseLedger(`${quoted}${renderLedger(real)}\n`)).toEqual(real);
    expect(parseLedger(quoted)).toBeUndefined();
    expect(parseLedger(`${renderLedger(real)}\nWas this useful?`)).toBeUndefined();
  });

  it("finds anchor keys only in Covi's marker form", () => {
    const key = outcomeKey(finding('Total ignores discounts'));
    expect(anchorKeyOf(`${anchorMarker(key)}\n**Covi**`)).toBe(key);
    expect(anchorKeyOf('<!-- covi:finding ../x -->')).toBeUndefined();
    expect(anchorKeyOf(`covi:finding ${key}`)).toBeUndefined();
    // A reply that quotes an anchor is not one.
    expect(anchorKeyOf(`> ${anchorMarker(key)}\nagreed`)).toBeUndefined();
  });
});

describe('outcome file', () => {
  const file = (repository: string) => ({
    schemaVersion: 1,
    runId: run(1),
    collectedAt: '2026-10-09T12:00:00Z',
    head: 'aaaaaaa',
    change: { platform: 'github', repository, number: 7, state: 'merged' },
    comment: { id: '123', rating: { up: 1, down: 0 }, replies: 0 },
    findings: [],
  });

  it('names a repository only as a path of owner, groups, and project', () => {
    for (const ok of ['acme/shop', 'acme/.github', 'group/sub-group/my_project.js']) {
      expect(OutcomeFileSchema.safeParse(file(ok)).success).toBe(true);
    }
    for (const bad of ['shop', '../shop', 'acme/../shop', 'acme/./shop', '/acme/shop', 'acme/']) {
      expect(OutcomeFileSchema.safeParse(file(bad)).success).toBe(false);
    }
    expect(OutcomeFileSchema.safeParse(file('https://github.com/acme/shop')).success).toBe(false);
    expect(OutcomeFileSchema.safeParse(file('acme/shop\nx')).success).toBe(false);
  });
});
