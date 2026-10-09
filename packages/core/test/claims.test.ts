import { describe, expect, it } from 'vitest';
import {
  citationProblems,
  citeExplanation,
  type GroundableFinding,
  groundFinding,
  hunksAt,
  indexEvidence,
  ungroundedStatements,
  unknownCitations,
} from '../src/evidence/cite.ts';
import { ModelAnalysisSchema } from '../src/intelligence/analyze.ts';
import type { EvidenceItem } from '../src/model/evidence.ts';
import { type Explanation, ExplanationSchema } from '../src/model/explanation.ts';
import { FindingsFileSchema } from '../src/model/finding.ts';
import { parseOrThrow } from '../src/util/zod.ts';

const hunkItem = (
  path: string,
  line: number,
  endLine: number,
  side: 'head' | 'base' = 'head',
): EvidenceItem => ({
  id: `diff-hunk:${path}:${line}`,
  kind: 'diff-hunk',
  path: 'diff.patch',
  revision: 'both',
  sha256: '0'.repeat(64),
  label: `${path}:${line}-${endLine}`,
  location: { path, line, endLine, side },
});
const traceItem: EvidenceItem = {
  id: 'trace:flow-post-head',
  kind: 'trace',
  path: 'demo/traces/flow-post-head.json',
  revision: 'head',
  sha256: '0'.repeat(64),
  label: 'Post (desktop) · head',
  refs: ['trace:flow-post-head#n2'],
};
const index = indexEvidence({
  items: [
    hunkItem('src/cart.ts', 10, 14),
    hunkItem('src/cart.ts', 40, 45),
    hunkItem('src/other.ts', 1, 3),
    traceItem,
  ],
});

const finding = (over: Record<string, unknown> = {}) => ({
  title: 'Quantity goes negative',
  certainty: 'confirmed',
  severity: 'high',
  category: 'correctness',
  location: { path: 'src/cart.ts', line: 12 },
  evidence: 'qty - 1',
  explanation: 'Totals go below zero.',
  ...over,
});

describe('findings.json version 2', () => {
  it('requires evidence on confirmed and likely findings', () => {
    expect(() =>
      parseOrThrow(FindingsFileSchema, { findings: [finding()] }, 'findings.json'),
    ).toThrow(/findings\.0\.evidenceIds: a confirmed finding cites at least one evidence id/);
    expect(() =>
      parseOrThrow(
        FindingsFileSchema,
        { schemaVersion: 2, findings: [finding({ certainty: 'likely' })] },
        'findings.json',
      ),
    ).toThrow(/likely finding cites at least one evidence id/);
    const cited = FindingsFileSchema.parse({
      findings: [finding({ evidenceIds: ['diff-hunk:src/cart.ts:10'] })],
    });
    expect(cited.schemaVersion).toBe(2);
    expect(cited.findings[0]!.evidenceIds).toEqual(['diff-hunk:src/cart.ts:10']);
  });

  it('lets risks and questions stand without evidence', () => {
    for (const certainty of ['risk', 'question'])
      expect(FindingsFileSchema.safeParse({ findings: [finding({ certainty })] }).success).toBe(
        true,
      );
  });

  it('reads version 1 files as before', () => {
    expect(
      FindingsFileSchema.parse({ schemaVersion: 1, findings: [finding()] }).schemaVersion,
    ).toBe(1);
  });

  it('does not hold a model to version 2: Covi grounds its findings instead', () => {
    const analysis = {
      explanation: {
        depth: 'brief',
        headline: 'Clamp quantities',
        summary: 's',
        intent: { statement: 's', confidence: 'high' },
      },
      review: { findings: [finding()] },
    };
    expect(ModelAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("cuts a model's over-long citation lists instead of discarding its analysis", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `diff-hunk:src/cart.ts:${i + 1}`);
    const long = `trace:${'x'.repeat(500)}`;
    const parsed = ModelAnalysisSchema.parse({
      explanation: {
        depth: 'brief',
        headline: 'Clamp quantities',
        summary: 's',
        intent: { statement: 's', confidence: 'high', evidenceIds: [long, ...ids] },
        changes: [{ area: 'Cart', description: 'd', evidenceIds: ['', ...ids] }],
      },
      review: { findings: [finding({ evidenceIds: ids })] },
    });
    const first20 = ids.slice(0, 20);
    expect(parsed.explanation.intent.evidenceIds).toEqual(first20);
    expect(parsed.explanation.changes[0]!.evidenceIds).toEqual(first20);
    expect(parsed.review.findings[0]!.evidenceIds).toEqual(first20);
    // An agent's files are held to the limit.
    expect(
      FindingsFileSchema.safeParse({ findings: [finding({ evidenceIds: ids })] }).success,
    ).toBe(false);
  });
});

describe('explanation statements', () => {
  it('may cite evidence, and need not', () => {
    const base = {
      depth: 'brief',
      headline: 'Clamp quantities',
      summary: 's',
      intent: { statement: 's', confidence: 'high', evidenceIds: ['diff-hunk:src/cart.ts:10'] },
    };
    expect(
      ExplanationSchema.parse({
        ...base,
        behavior: {
          userVisible: true,
          after: 'Stops at zero',
          evidenceIds: ['trace:flow-post-head'],
        },
        changes: [{ area: 'Cart', description: 'd', evidenceIds: ['diff-hunk:src/cart.ts:10'] }],
      }).changes[0]!.evidenceIds,
    ).toEqual(['diff-hunk:src/cart.ts:10']);
    expect(
      ExplanationSchema.safeParse({ ...base, changes: [{ area: 'Cart', description: 'd' }] })
        .success,
    ).toBe(true);
  });
});

describe('citations', () => {
  it('knows items and their parts, and nothing else', () => {
    expect(
      unknownCitations(index, [
        'diff-hunk:src/cart.ts:10',
        'trace:flow-post-head#n2',
        'trace:nope',
        'flow-post-head#n2',
        'line 42',
      ]),
    ).toEqual(['trace:nope', 'flow-post-head#n2', 'line 42']);
    expect(unknownCitations(index, undefined)).toEqual([]);
  });

  it('compares ids after the redaction the registry went through', () => {
    const redact = (text: string) => text.split('qq7788').join('[REDACTED]');
    const redacted = indexEvidence({ items: [hunkItem('src/[REDACTED].ts', 1, 2)] }, redact);
    // A rule computes its hunk id from the raw diff; the registry holds the redacted one.
    expect(
      unknownCitations(redacted, ['diff-hunk:src/qq7788.ts:1', 'diff-hunk:src/x.ts:1']),
    ).toEqual(['diff-hunk:src/x.ts:1']);
    expect(redacted.find('diff-hunk:src/qq7788.ts:1')?.label).toBe('src/[REDACTED].ts:1-2');
    expect(
      groundFinding(
        { certainty: 'confirmed', evidenceIds: ['diff-hunk:src/qq7788.ts:1'] },
        redacted,
      ),
    ).toEqual({
      finding: { certainty: 'confirmed', evidenceIds: ['diff-hunk:src/qq7788.ts:1'] },
      dropped: [],
    });
  });

  it('names the claim behind every unknown id', () => {
    expect(
      citationProblems(index, {
        explanation: {
          intent: { evidenceIds: ['diff-hunk:src/cart.ts:10'] },
          changes: [{ area: 'Cart', evidenceIds: ['http:9'] }],
        },
        findings: [
          { title: 'Negative totals', evidenceIds: ['trace:nope', 'trace:flow-post-head'] },
        ],
      }),
    ).toEqual([
      'explanation.json changes[0] (Cart): http:9',
      'findings.json findings[0] (Negative totals): trace:nope',
    ]);
  });

  it('finds the hunks at a location: overlapping, else the nearest in the file', () => {
    expect(hunksAt(index, { path: 'src/cart.ts', line: 12 })).toEqual(['diff-hunk:src/cart.ts:10']);
    expect(hunksAt(index, { path: 'src/cart.ts', line: 13, endLine: 41 })).toEqual([
      'diff-hunk:src/cart.ts:10',
      'diff-hunk:src/cart.ts:40',
    ]);
    expect(hunksAt(index, { path: 'src/cart.ts', line: 30 })).toEqual(['diff-hunk:src/cart.ts:40']);
    expect(hunksAt(index, { path: 'src/cart.ts' })).toEqual(['diff-hunk:src/cart.ts:10']);
    expect(hunksAt(index, { path: 'src/none.ts', line: 1 })).toEqual([]);
    expect(hunksAt(index, undefined)).toEqual([]);
  });
});

describe('groundFinding', () => {
  const base: GroundableFinding = {
    certainty: 'likely',
    location: { path: 'src/cart.ts', line: 12 },
  };

  it('keeps known ids and drops unknown ones', () => {
    expect(
      groundFinding({ ...base, evidenceIds: ['trace:flow-post-head#n2', 'trace:nope'] }, index),
    ).toEqual({
      finding: { ...base, evidenceIds: ['trace:flow-post-head#n2'] },
      dropped: ['trace:nope'],
    });
  });

  it('cites the hunk at its location when it cites nothing', () => {
    expect(groundFinding(base, index).finding.evidenceIds).toEqual(['diff-hunk:src/cart.ts:10']);
  });

  it('reports a confirmed or likely finding with nothing to cite as a risk', () => {
    const grounded = groundFinding<GroundableFinding>(
      { certainty: 'confirmed', location: { path: 'nowhere.ts', line: 1 } },
      index,
    );
    expect(grounded).toMatchObject({ finding: { certainty: 'risk' }, demoted: 'confirmed' });
    expect(grounded.finding.evidenceIds).toBeUndefined();
    expect(groundFinding({ certainty: 'question' as const }, index)).toEqual({
      finding: { certainty: 'question' },
      dropped: [],
    });
  });
});

describe('explanation grounding', () => {
  const explanation = {
    intent: { statement: 'Stop negative totals', confidence: 'high', evidence: ['commit message'] },
    changes: [
      { area: 'Cart', description: 'd', files: ['src/cart.ts'] },
      { area: 'Docs', description: 'd', files: ['README.md'] },
      {
        area: 'Other',
        description: 'd',
        files: ['src/other.ts'],
        evidenceIds: ['trace:flow-post-head'],
      },
    ],
    behavior: { userVisible: true, before: 'Went negative' },
  } as unknown as Explanation;

  it("cites the hunks of each change's files in Covi's own explanation", () => {
    expect(citeExplanation(explanation, index).changes.map((c) => c.evidenceIds)).toEqual([
      ['diff-hunk:src/cart.ts:10', 'diff-hunk:src/cart.ts:40'],
      undefined,
      ['trace:flow-post-head'],
    ]);
  });

  it('cites for the intent what its changes cite, once each', () => {
    const cited = citeExplanation(explanation, index);
    expect(cited.intent.evidenceIds).toEqual([
      'diff-hunk:src/cart.ts:10',
      'diff-hunk:src/cart.ts:40',
      'trace:flow-post-head',
    ]);
    expect(ungroundedStatements(cited)).toEqual(['behavior', 'changes[1] (Docs)']);
    // An intent that cites something keeps its own ids.
    const own = { ...explanation.intent, evidenceIds: ['trace:flow-post-head#n2'] };
    expect(citeExplanation({ ...explanation, intent: own }, index).intent.evidenceIds).toEqual([
      'trace:flow-post-head#n2',
    ]);
  });

  it('caps what a change and the intent cite at six ids', () => {
    const paths = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`);
    const many = indexEvidence({ items: paths.map((path) => hunkItem(path, 1, 2)) });
    const change = (files: string[]) => ({ area: 'A', description: 'd', files });
    const two = { ...explanation, changes: [change(paths.slice(0, 4)), change(paths.slice(4))] };
    const cited = citeExplanation(two, many);
    expect(cited.changes.map((c) => c.evidenceIds?.length)).toEqual([4, 4]);
    expect(cited.intent.evidenceIds).toEqual(paths.slice(0, 6).map((p) => `diff-hunk:${p}:1`));
    const one = citeExplanation({ ...explanation, changes: [change(paths)] }, many);
    expect(one.changes[0]!.evidenceIds).toHaveLength(6);
  });

  it('cites the hunks of the files to read first when no change cites anything', () => {
    const bare = {
      ...explanation,
      changes: [],
      readingOrder: [{ path: 'src/other.ts', reason: 'r' }],
    } as Explanation;
    expect(citeExplanation(bare, index).intent.evidenceIds).toEqual(['diff-hunk:src/other.ts:1']);
  });

  it('lists the statements that make a claim and cite nothing', () => {
    // A prose `evidence` list is not a citation: the intent still cites nothing.
    expect(ungroundedStatements(explanation)).toEqual([
      'intent',
      'behavior',
      'changes[0] (Cart)',
      'changes[1] (Docs)',
    ]);
    expect(
      ungroundedStatements({
        intent: {
          statement: 's',
          confidence: 'high',
          evidence: [],
          evidenceIds: ['diff-hunk:src/cart.ts:10'],
        },
        changes: [],
        behavior: { userVisible: true, notes: 'n' },
      }),
    ).toEqual([]);
  });
});
