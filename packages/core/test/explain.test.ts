import { describe, expect, it } from 'vitest';
import { intentSentence, intentStatement } from '../src/explain/heuristic.ts';
import type { Intent, ReviewContext } from '../src/model/context.ts';

function context(intent: Partial<Intent>, title?: string): ReviewContext {
  return {
    intent: {
      kind: 'feature',
      summary: title ?? '',
      confidence: 'low',
      evidence: [],
      secondary: [],
      basis: 'title',
      ...intent,
    },
    change: { metadata: { title }, commits: [] },
  } as unknown as ReviewContext;
}

describe('intent phrasing', () => {
  it('credits the title only when the kind came from it', () => {
    const typed = context(
      { evidence: ['title "feat: add export" uses the feat prefix'], summary: 'Add export' },
      'feat: add export',
    );
    expect(intentStatement(typed)).toBe(
      'The title describes it as a new feature: “feat: add export”.',
    );

    const inferred = context({}, 'Initial commit: Covi');
    expect(intentStatement(inferred)).toBe(
      'The title says “Initial commit: Covi”. Calling it a new feature is inferred from the files.',
    );
  });

  it('quotes a summary that has its own colon instead of stacking colons', () => {
    expect(intentSentence(context({}, 'Initial commit: Covi'))).toBe(
      'This change is a new feature, titled “Initial commit: Covi”.',
    );
    expect(intentSentence(context({ kind: 'performance' }, 'Faster cart totals'))).toBe(
      'This change is a performance improvement: faster cart totals.',
    );
  });
});
