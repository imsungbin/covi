import { afterEach, describe, expect, it } from 'vitest';
import { type Analysis, analyze } from '../../../tests/helpers/analyze.ts';
import { diffHunkEvidence } from '../src/evidence/build.ts';
import {
  groundModelExplanation,
  groundModelFindings,
  indexEvidence,
} from '../src/evidence/cite.ts';
import { analyzeWithModel } from '../src/intelligence/analyze.ts';
import type { GenerateRequest, ModelProvider } from '../src/intelligence/provider.ts';
import type { EvidenceItem } from '../src/model/evidence.ts';
import type { Explanation } from '../src/model/explanation.ts';
import { Redactor } from '../src/security/redact.ts';

let a: Analysis | undefined;
afterEach(() => a?.repo.cleanup());

const trace: EvidenceItem = {
  id: 'trace:flow-cart-head',
  kind: 'trace',
  path: 'demo/traces/flow-cart-head.json',
  revision: 'head',
  sha256: '0'.repeat(64),
  label: 'Cart (desktop) · head',
  refs: ['trace:flow-cart-head#n2'],
};

const finding = (over: Record<string, unknown>) => ({
  title: 'Quantity can no longer go negative',
  certainty: 'likely',
  severity: 'low',
  category: 'correctness',
  location: { path: 'src/cart.ts', line: 1 },
  evidence: 'Math.max(0, q - 1)',
  explanation: 'x',
  ...over,
});

describe('model findings and evidence', () => {
  it('shows the model what it can cite', async () => {
    a = await analyze(
      { 'src/cart.ts': 'export const dec = (q) => q - 1;\n' },
      { 'src/cart.ts': 'export const dec = (q) => Math.max(0, q - 1);\n' },
    );
    const requests: Array<GenerateRequest<unknown>> = [];
    const provider: ModelProvider = {
      id: 'command',
      async generate<T>(request: GenerateRequest<T>): Promise<T> {
        requests.push(request as GenerateRequest<unknown>);
        return request.schema.parse({
          explanation: {
            depth: 'brief',
            headline: 'Clamp quantities',
            summary: 's',
            intent: { statement: 's', confidence: 'high' },
          },
          review: { findings: [finding({})] },
        });
      },
    };
    await analyzeWithModel(provider, {
      change: a.change,
      context: a.context,
      ruleFindings: a.findings,
      redactor: new Redactor(),
      maxDiffChars: 20_000,
      runId: 'r',
      evidence: [...diffHunkEvidence(a.change.files), trace],
    });
    const { prompt, system } = requests[0]!;
    expect(prompt).toContain('## Captured evidence (ids)');
    expect(prompt).toContain('- `trace:flow-cart-head`: Cart (desktop) · head');
    // Hunks are not listed: the model reads them from the diff's own headers.
    expect(prompt).not.toContain('- `diff-hunk:');
    expect(system).toMatch(/evidenceIds/);
  });

  const index = indexEvidence({
    items: [
      trace,
      {
        id: 'diff-hunk:src/cart.ts:1',
        kind: 'diff-hunk',
        path: 'diff.patch',
        revision: 'both',
        sha256: '0'.repeat(64),
        label: 'src/cart.ts:1',
        location: { path: 'src/cart.ts', line: 1, endLine: 1, side: 'head' },
      },
    ],
  });

  it("grounds a model's findings and says what changed, once per finding", () => {
    const { findings, notes } = groundModelFindings(
      {
        schemaVersion: 1,
        findings: [
          finding({ evidenceIds: ['trace:flow-cart-head#n2', 'trace:made-up'] }),
          finding({ title: 'Somewhere else', location: { path: 'other.ts', line: 3 } }),
          finding({ title: 'At the change', evidenceIds: undefined }),
          finding({ title: 'Only made up', evidenceIds: ['http:9'] }),
          finding({
            title: 'Made up elsewhere',
            evidenceIds: ['http:9'],
            location: { path: 'other.ts', line: 3 },
          }),
        ],
        dismissed: [],
        checked: [],
        notVerified: [],
      },
      index,
    );
    expect(findings.schemaVersion).toBe(2);
    expect(findings.findings.map((f) => [f.certainty, f.evidenceIds])).toEqual([
      ['likely', ['trace:flow-cart-head#n2']],
      ['risk', undefined],
      ['likely', ['diff-hunk:src/cart.ts:1']],
      ['likely', ['diff-hunk:src/cart.ts:1']],
      ['risk', undefined],
    ]);
    expect(notes).toEqual([
      'Model finding "Quantity can no longer go negative" cited evidence the run does not have (trace:made-up); those ids were dropped.',
      'Model finding "Somewhere else" cited no evidence, so it is reported as a risk rather than likely.',
      'Model finding "At the change" cited no evidence, so it cites the diff at its location (diff-hunk:src/cart.ts:1).',
      'Model finding "Only made up" cited evidence the run does not have (http:9), so it cites the diff at its location (diff-hunk:src/cart.ts:1).',
      'Model finding "Made up elsewhere" cited evidence the run does not have (http:9), so it is reported as a risk rather than likely.',
    ]);
  });

  it("keeps only the ids a model's explanation cites that the run has", () => {
    const explanation: Explanation = {
      schemaVersion: 1,
      depth: 'brief',
      headline: 'Clamp quantities',
      summary: 's',
      intent: { statement: 's', confidence: 'high', evidence: [], evidenceIds: ['trace:made-up'] },
      behavior: { after: 'Stops at zero.', evidenceIds: ['trace:flow-cart-head#n2', 'http:9'] },
      changes: [
        { area: 'Cart', description: 'd', files: ['src/cart.ts'], evidenceIds: ['http:9'] },
        { area: 'Docs', description: 'd', files: [], evidenceIds: ['diff-hunk:src/cart.ts:1'] },
      ],
      generatedBy: { provider: 'command' },
    } as Explanation;
    const { explanation: grounded, notes } = groundModelExplanation(explanation, index);
    expect(grounded.intent.evidenceIds).toBeUndefined();
    expect(grounded.behavior?.evidenceIds).toEqual(['trace:flow-cart-head#n2']);
    expect(grounded.changes.map((c) => c.evidenceIds)).toEqual([
      undefined,
      ['diff-hunk:src/cart.ts:1'],
    ]);
    expect(notes).toEqual([
      'Model explanation intent cited evidence the run does not have (trace:made-up); those ids were dropped.',
      'Model explanation behavior cited evidence the run does not have (http:9); those ids were dropped.',
      'Model explanation changes[0] (Cart) cited evidence the run does not have (http:9); those ids were dropped.',
    ]);
    // Grounded already: nothing changes, nothing to say.
    expect(groundModelExplanation(grounded, index)).toEqual({ explanation: grounded, notes: [] });
  });
});
