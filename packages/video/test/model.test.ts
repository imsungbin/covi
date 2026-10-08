import { DEFAULT_CONFIG, type GenerateRequest, type ModelProvider } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec } from '../src/spec.ts';
import { lineBudget, refineNarration } from '../src/storyboard/model.ts';
import type { Storyboard } from '../src/storyboard/schema.ts';

/** A provider that answers with `answer` and remembers what it was asked. */
function stub(answer: () => unknown): ModelProvider & { requests: GenerateRequest<unknown>[] } {
  const requests: GenerateRequest<unknown>[] = [];
  return {
    id: 'anthropic',
    requests,
    async generate<T>(request: GenerateRequest<T>): Promise<T> {
      requests.push(request as GenerateRequest<unknown>);
      return request.schema.parse(answer());
    },
  };
}

const words = (n: number) => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}.`;
const storyboard = {
  schemaVersion: 1,
  title: 'T',
  template: 'bug-fix',
  draft: true,
  scenes: Array.from({ length: 6 }, (_, i) => ({
    id: `s${i + 1}`,
    beat: 'b',
    narration: words(30),
    visual: { kind: 'callout', tone: 'info', title: 'C' },
  })),
} as Storyboard;
const materials = {
  explanation: { headline: 'H', summary: 'S' },
  review: { verdict: 'looks-good', findings: [] },
  spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
} as unknown as Parameters<typeof refineNarration>[2];

describe('narration refinement', () => {
  it('budgets one 15-word line per scene, as six seconds of speech in other languages', () => {
    expect([lineBudget('en'), lineBudget('ko'), lineBudget('ja'), lineBudget('zh')]).toEqual([
      15, 26, 24, 18,
    ]);
  });

  it('asks for lines the skill allows, and a total those lines can hold', async () => {
    const provider = stub(() => ({ scenes: [] }));
    await refineNarration(provider, storyboard, materials);
    const prompt = provider.requests[0]!.prompt;
    const scenes = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!) as Array<{
      maxWords: number;
    }>;
    expect(scenes.map((s) => s.maxWords)).toEqual([15, 15, 15, 15, 15, 15]);
    expect(Number(/total narration budget about (\d+) words/.exec(prompt)![1])).toBe(90);
  });

  it('keeps the draft for broken [[…]] markup, or a line over budget and longer than the draft', async () => {
    const provider = stub(() => ({
      scenes: [
        { id: 's1', narration: 'The fix [[clamps]] the quantity at zero.' },
        // Over its 15-word line, but shorter than the 30-word draft it replaces.
        { id: 's2', narration: words(25) },
        { id: 's3', narration: 'Two [[marks]] in [[one]] line.' },
        { id: 's4', narration: 'An [[unclosed mark.' },
        { id: 's5', narration: words(35) },
      ],
    }));
    const refined = await refineNarration(provider, storyboard, materials);
    expect(refined.scenes[0]!.narration).toBe('The fix [[clamps]] the quantity at zero.');
    expect(refined.scenes[1]!.narration).toBe(words(25));
    for (const i of [2, 3, 4])
      expect(refined.scenes[i]!.narration).toBe(storyboard.scenes[i]!.narration);
  });
});
