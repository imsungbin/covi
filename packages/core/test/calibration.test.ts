import { afterEach, describe, expect, it } from 'vitest';
import { type Analysis, analyze } from '../../../tests/helpers/analyze.ts';
import { analyzeWithModel } from '../src/intelligence/analyze.ts';
import type { GenerateRequest, ModelProvider } from '../src/intelligence/provider.ts';
import type { Calibration } from '../src/outcomes/precision.ts';
import { renderBrief } from '../src/report/brief.ts';
import { Redactor } from '../src/security/redact.ts';

let a: Analysis | undefined;
afterEach(() => a?.repo.cleanup());

const calibration: Calibration = {
  changes: 12,
  lines: [{ certainty: 'likely', right: 4, labeled: 5, percent: 80 }],
};

/** A model that records its prompts and reports one likely finding, whatever it is told. */
function recordingModel(prompts: string[]): ModelProvider {
  return {
    id: 'command',
    async generate<T>(request: GenerateRequest<T>): Promise<T> {
      prompts.push(request.prompt);
      return request.schema.parse({
        explanation: {
          depth: 'brief',
          headline: 'Sum the cart',
          summary: 's',
          intent: { statement: 's', confidence: 'high' },
        },
        review: {
          findings: [
            {
              title: 'Empty carts sum to zero',
              certainty: 'likely',
              severity: 'low',
              category: 'correctness',
              location: { path: 'src/cart.ts', line: 1 },
              evidence: 'xs.reduce((s, x) => s + x, 0)',
              explanation: 'The initial value is 0.',
            },
          ],
        },
      });
    },
  };
}

describe('calibration in the brief', () => {
  it('shows how past findings held up, before the signals, for agents and models alike', async () => {
    a = await analyze(
      { 'src/cart.ts': 'export const total = (xs) => xs.length;\n' },
      { 'src/cart.ts': 'export const total = (xs) => xs.reduce((s, x) => s + x, 0);\n' },
    );
    const options = { runDir: '.', runId: 'r', redactor: new Redactor(), maxDiffChars: 20_000 };
    const brief = renderBrief(a.change, a.context, a.findings, { ...options, calibration });
    expect(brief).toContain(
      [
        '## How past findings held up',
        '',
        'From 12 earlier reviewed changes in this repository (`covi outcomes report`):',
        '- Likely issue: 4 of 5 held up (80%)',
        '',
        "Let this temper how sure you are, not what you report: it changes no finding's certainty by itself. Classify each finding on its own evidence.",
      ].join('\n'),
    );
    expect(brief.indexOf('How past findings held up')).toBeLessThan(brief.indexOf('## Diff'));
    expect(renderBrief(a.change, a.context, a.findings, options)).not.toContain(
      'How past findings held up',
    );
    const korean = renderBrief(a.change, a.context, a.findings, {
      ...options,
      calibration,
      language: 'ko',
    });
    expect(korean).toContain('가능성 높은 문제: 5건 중 4건이 맞았습니다(80%)');

    const prompts: string[] = [];
    await analyzeWithModel(recordingModel(prompts), {
      change: a.change,
      context: a.context,
      ruleFindings: a.findings,
      redactor: new Redactor(),
      maxDiffChars: 20_000,
      runId: 'r',
      calibration,
    });
    expect(prompts[0]).toContain('- Likely issue: 4 of 5 held up (80%)');
  });

  it('is material for the model, never a change to what it reports', async () => {
    a = await analyze(
      { 'src/cart.ts': 'export const total = (xs) => xs.length;\n' },
      { 'src/cart.ts': 'export const total = (xs) => xs.reduce((s, x) => s + x, 0);\n' },
    );
    const input = {
      change: a.change,
      context: a.context,
      ruleFindings: a.findings,
      redactor: new Redactor(),
      maxDiffChars: 20_000,
      runId: 'r',
    };
    const poor: Calibration = {
      changes: 9,
      lines: [{ certainty: 'likely', right: 0, labeled: 9, percent: 0 }],
    };
    const prompts: string[] = [];
    const without = await analyzeWithModel(recordingModel(prompts), input);
    const withHint = await analyzeWithModel(recordingModel(prompts), {
      ...input,
      calibration: poor,
    });
    expect(prompts[1]).toContain('- Likely issue: 0 of 9 held up (0%)');
    // Even a certainty that never held up stays as the model reported it.
    expect(withHint).toEqual(without);
    expect(withHint.findings.findings[0]!.certainty).toBe('likely');
  });
});
