import { describe, expect, it } from 'vitest';
import { outcomeFile } from '../../../tests/helpers/outcomes.ts';
import { type Finding, normalizeFinding } from '../src/model/finding.ts';
import type { ChangeSignals, OutcomeFinding } from '../src/model/outcome.ts';
import { buildOutcome } from '../src/outcomes/build.ts';
import { mergeLedger, outcomeKey, renderLedger } from '../src/outcomes/ledger.ts';
import {
  calibrationOf,
  labelFinding,
  outcomeReport,
  summarizeOutcomes,
} from '../src/outcomes/precision.ts';

const f = (over: Partial<OutcomeFinding> = {}): OutcomeFinding => ({
  key: '000000000001',
  certainty: 'likely',
  firstHead: 'aaaaaaa',
  lastHead: 'aaaaaaa',
  fate: 'present',
  ...over,
});
const change = (state: 'open' | 'merged' | 'closed', revertedBy?: { sha: string }) =>
  outcomeFile({ state, revertedBy }).change;
const unlabeled = { label: 'unlabeled', signal: 'none' };

describe('labels', () => {
  it('labels a finding by its thumbs first, then by what happened to the change', () => {
    expect(labelFinding(f({ thumbs: { up: 2, down: 1 } }), change('merged'))).toEqual({
      label: 'right',
      signal: 'thumbs',
    });
    expect(
      labelFinding(f({ thumbs: { up: 0, down: 1 }, fate: 'addressed' }), change('merged')),
    ).toEqual({ label: 'wrong', signal: 'thumbs' });
    // A tie says nothing; what happened to the code decides.
    expect(
      labelFinding(f({ thumbs: { up: 1, down: 1 }, fate: 'addressed' }), change('closed')),
    ).toEqual({ label: 'right', signal: 'addressed' });
    expect(labelFinding(f({ fate: 'addressed' }), change('open'))).toEqual(unlabeled);
    expect(labelFinding(f({ fate: 'superseded' }), change('merged'))).toEqual(unlabeled);
    expect(labelFinding(f(), change('merged'))).toEqual({
      label: 'wrong',
      signal: 'merged-unchanged',
    });
    expect(labelFinding(f({ certainty: 'confirmed' }), change('merged')).label).toBe('wrong');
    // Risks and questions inform; merging past them is not a verdict on them.
    expect(labelFinding(f({ certainty: 'risk' }), change('merged'))).toEqual(unlabeled);
    expect(labelFinding(f({ certainty: 'question' }), change('merged'))).toEqual(unlabeled);
    // A revert says the merged change was wrong somehow, not that this finding was.
    expect(labelFinding(f(), change('merged', { sha: 'f'.repeat(40) }))).toEqual(unlabeled);
    // Abandoned work says nothing either way.
    expect(labelFinding(f(), change('closed'))).toEqual(unlabeled);
  });

  it('counts a finding merged unchanged only when Covi reviewed the head that merged', () => {
    // A fix pushed and merged before its review finished: the ledger is a push behind.
    const later = outcomeFile({ changeHead: 'bbbbbbb' }).change;
    expect(labelFinding(f(), later)).toEqual(unlabeled);
    expect(labelFinding(f({ certainty: 'confirmed' }), later)).toEqual(unlabeled);
    // Votes still judge it, and a fix Covi saw still counts for it.
    expect(labelFinding(f({ thumbs: { up: 0, down: 1 } }), later).label).toBe('wrong');
    expect(labelFinding(f({ fate: 'addressed' }), later).label).toBe('right');
    // A platform that did not say which commit merged settles nothing either.
    expect(labelFinding(f(), outcomeFile({ changeHead: null }).change)).toEqual(unlabeled);
    expect(labelFinding(f(), outcomeFile({ changeHead: 'aaaaaaa' }).change)).toEqual({
      label: 'wrong',
      signal: 'merged-unchanged',
    });
  });

  it('labels a superseded finding only by its thumbs', () => {
    // A reworded finding was neither fixed nor shipped as reported; only votes judge it.
    const stale = f({ fate: 'superseded', certainty: 'confirmed' });
    expect(labelFinding({ ...stale, thumbs: { up: 3, down: 0 } }, change('merged'))).toEqual({
      label: 'right',
      signal: 'thumbs',
    });
    for (const state of ['merged', 'open'] as const)
      expect(labelFinding({ ...stale, thumbs: { up: 0, down: 3 } }, change(state))).toEqual({
        label: 'wrong',
        signal: 'thumbs',
      });
    expect(labelFinding({ ...stale, thumbs: { up: 2, down: 2 } }, change('merged'))).toEqual(
      unlabeled,
    );
    expect(labelFinding(stale, change('merged'))).toEqual(unlabeled);
  });
});

describe('outcome report', () => {
  it('reports precision per certainty and repository, with counts', () => {
    const report = outcomeReport([
      outcomeFile({
        number: 1,
        rating: { up: 3, down: 1 },
        findings: [{ fate: 'addressed' }, {}],
      }),
      outcomeFile({
        number: 2,
        state: 'closed',
        findings: [{ certainty: 'risk', fate: 'addressed' }],
      }),
      outcomeFile({
        number: 3,
        revertedBy: { sha: 'f'.repeat(40) },
        findings: [{ certainty: 'confirmed', thumbs: { up: 1, down: 0 } }],
      }),
      outcomeFile({ number: 4, repository: 'acme/api', state: 'open' }),
    ]);
    expect(report.files).toBe(4);
    expect(report.repositories.map((r) => r.repository)).toEqual(['acme/api', 'acme/shop']);
    const shop = report.repositories[1]!;
    expect(shop).toMatchObject({
      platform: 'github',
      changes: 3,
      open: 0,
      merged: 2,
      closed: 1,
      reverted: 1,
      rating: { up: 3, down: 1 },
      signals: { thumbs: 1, addressed: 2, mergedUnchanged: 1 },
    });
    expect(shop.certainty.likely).toEqual({
      reported: 2,
      right: 1,
      wrong: 1,
      unlabeled: 0,
      precision: 0.5,
    });
    expect(shop.certainty.confirmed).toMatchObject({ right: 1, wrong: 0, precision: 1 });
    expect(shop.certainty.risk).toMatchObject({ right: 1, precision: 1 });
    expect(shop.certainty.question).toEqual({
      reported: 0,
      right: 0,
      wrong: 0,
      unlabeled: 0,
      precision: null,
    });
    expect(summarizeOutcomes(report, 'en')).toBe(
      [
        'acme/api:',
        '1 reviewed change: 0 merged (0 reverted later), 0 closed unmerged, 1 still open.',
        "Covi's comments: 👍 0 · 👎 0.",
        'Likely issue: 1 reported, no signal yet.',
        'acme/shop:',
        '3 reviewed changes: 2 merged (1 reverted later), 1 closed unmerged, 0 still open.',
        "Covi's comments: 👍 3 · 👎 1.",
        'Confirmed issue: 1 of 1 held up (100%); 0 without a signal.',
        'Likely issue: 1 of 2 held up (50%); 0 without a signal.',
        'Risk worth checking: 1 of 1 held up (100%); 0 without a signal.',
      ].join('\n'),
    );
  });

  it('gives no precision and no hint without enough signal', () => {
    const empty = outcomeReport([]);
    expect(empty.repositories).toEqual([]);
    expect(summarizeOutcomes(empty, 'en')).toMatch(/^No outcomes yet\./);
    expect(calibrationOf([])).toBeUndefined();

    const open = outcomeReport([outcomeFile({ state: 'open' })]);
    expect(open.repositories[0]!.certainty.likely).toEqual({
      reported: 1,
      right: 0,
      wrong: 0,
      unlabeled: 1,
      precision: null,
    });
    expect(JSON.stringify(open)).not.toMatch(/NaN/);
    expect(summarizeOutcomes(open, 'en')).toContain('Likely issue: 1 reported, no signal yet.');

    // Four labeled findings are not enough for a hint; five are.
    const four = Array.from({ length: 4 }, () => ({ fate: 'addressed' as const }));
    expect(calibrationOf([outcomeFile({ findings: four })])).toBeUndefined();
    expect(calibrationOf([outcomeFile({ findings: [...four, {}] })])).toEqual({
      changes: 1,
      lines: [{ certainty: 'likely', right: 4, labeled: 5, percent: 80 }],
    });
  });

  it('summarizes in every language without leftover placeholders', () => {
    const report = outcomeReport([
      outcomeFile({ findings: [{ fate: 'addressed' }, {}, { certainty: 'question' }] }),
    ]);
    for (const language of ['ko', 'ja', 'zh'] as const) {
      const text = summarizeOutcomes(report, language);
      expect(text, language).not.toMatch(/[{}]/);
      expect(text, language).toContain('50');
    }
  });
});

describe('buildOutcome', () => {
  const discount: Finding = normalizeFinding(
    {
      title: 'Total ignores discounts',
      certainty: 'likely',
      severity: 'medium',
      category: 'correctness',
      evidence: 'x',
      explanation: 'y',
      location: { path: 'src/cart.ts', line: 3 },
    },
    { kind: 'model' },
  );
  const ledger = mergeLedger(undefined, {
    runId: '20261001-090000-ci-aaaaaaa',
    head: 'a'.repeat(40),
    findings: [discount],
  })!;
  const signals = (over: Partial<ChangeSignals> = {}): ChangeSignals => ({
    platform: 'github',
    repository: 'acme/shop',
    number: 7,
    url: 'https://github.com/acme/shop/pull/7',
    state: 'merged',
    closedAt: '2026-10-02T09:00:00Z',
    head: 'a'.repeat(40),
    author: '9001',
    comment: {
      id: '201',
      body: `<!-- covi:review -->\n${renderLedger(ledger)}`,
      up: 2,
      down: 1,
      replies: 1,
    },
    anchors: [
      {
        key: outcomeKey(discount),
        id: '301',
        reactions: [
          { user: '11', vote: 'down' },
          { user: '12', vote: 'down' },
          { user: '9001', vote: 'up' },
        ],
        replies: 1,
      },
    ],
    ...over,
  });

  it("builds an outcome from a change's signals and its comment's ledger", () => {
    const built = buildOutcome(signals(), '2026-10-09T12:00:00.000Z');
    expect(built.outcome).toEqual({
      schemaVersion: 1,
      runId: '20261001-090000-ci-aaaaaaa',
      collectedAt: '2026-10-09T12:00:00.000Z',
      head: 'aaaaaaa',
      change: {
        platform: 'github',
        repository: 'acme/shop',
        number: 7,
        url: 'https://github.com/acme/shop/pull/7',
        state: 'merged',
        head: 'aaaaaaa',
        closedAt: '2026-10-02T09:00:00Z',
      },
      comment: { id: '201', rating: { up: 2, down: 1 }, replies: 1 },
      findings: [
        {
          key: outcomeKey(discount),
          certainty: 'likely',
          firstHead: 'aaaaaaa',
          lastHead: 'aaaaaaa',
          fate: 'present',
          thumbs: { up: 0, down: 2 },
          replies: 1,
        },
      ],
    });
  });

  it("leaves the change author's own votes out of a finding's thumbs", () => {
    const key = outcomeKey(discount);
    // The author would rather their code shipped: their vote on a finding about it is biased.
    const own = signals({
      anchors: [{ key, id: '301', reactions: [{ user: '9001', vote: 'down' }], replies: 0 }],
    });
    expect(buildOutcome(own, '2026-10-09T12:00:00Z').outcome!.findings[0]!.thumbs).toEqual({
      up: 0,
      down: 0,
    });
    const others = signals({
      anchors: [
        {
          key,
          id: '301',
          reactions: [
            { user: '9001', vote: 'down' },
            { user: '11', vote: 'up' },
          ],
          replies: 0,
        },
      ],
    });
    const outcome = buildOutcome(others, '2026-10-09T12:00:00Z').outcome!;
    expect(outcome.findings[0]!.thumbs).toEqual({ up: 1, down: 0 });
    expect(labelFinding(outcome.findings[0]!, outcome.change).label).toBe('right');
  });

  it('counts one vote per person, and none from someone who gave both', () => {
    const key = outcomeKey(discount);
    const torn = signals({
      anchors: [
        {
          key,
          id: '301',
          reactions: [
            { user: '11', vote: 'up' },
            { user: '11', vote: 'down' },
            { user: '12', vote: 'down' },
            { user: '12', vote: 'down' },
          ],
          replies: 0,
        },
      ],
    });
    expect(buildOutcome(torn, '2026-10-09T12:00:00Z').outcome!.findings[0]!.thumbs).toEqual({
      up: 0,
      down: 1,
    });
  });

  it('records the head the change ended at, and says when Covi reviewed an older one', () => {
    const stale = buildOutcome(signals({ head: 'B'.repeat(40) }), '2026-10-09T12:00:00Z');
    expect(stale.outcome!.change.head).toBe('bbbbbbb');
    expect(stale.outcome!.head).toBe('aaaaaaa');
    expect(stale.notes).toEqual([
      'Covi last reviewed aaaaaaa, but the change merged at bbbbbbb: findings still present then count neither way',
    ]);
    expect(labelFinding(stale.outcome!.findings[0]!, stale.outcome!.change).signal).not.toBe(
      'merged-unchanged',
    );
    // A head that is not a commit id is left out, so nothing counts as merged unchanged.
    const odd = buildOutcome(signals({ head: 'main' }), '2026-10-09T12:00:00Z');
    expect(odd.outcome!.change.head).toBeUndefined();
    expect(odd.notes?.[0]).toMatch(/merged at an unknown commit/);
    // Open or closed without merging: nothing would count as merged unchanged, so no note.
    expect(
      buildOutcome(signals({ state: 'open', head: 'b'.repeat(40) }), '2026-10-09T12:00:00Z').notes,
    ).toBeUndefined();
  });

  it('says why it skips a change', () => {
    expect(buildOutcome(signals({ comment: undefined }), '2026-10-09T12:00:00Z').skipped).toMatch(
      /has not commented/,
    );
    const old = signals({
      comment: { id: '1', body: '<!-- covi:review -->', up: 0, down: 0, replies: 0 },
    });
    expect(buildOutcome(old, '2026-10-09T12:00:00Z').skipped).toMatch(/no outcome ledger/);
    const odd = signals({ url: 'javascript:alert(1)' });
    expect(buildOutcome(odd, '2026-10-09T12:00:00Z').skipped).toMatch(/change\.url/);
  });

  it("passes on the collector's notes, and keeps them out of the outcome file", () => {
    const notes = ['review comments: only the first 10 pages were read'];
    const built = buildOutcome(signals({ notes }), '2026-10-09T12:00:00Z');
    expect(built.notes).toEqual(notes);
    expect(JSON.stringify(built.outcome)).not.toContain('pages');
    expect(buildOutcome(signals({ comment: undefined, notes }), '2026-10-09T12:00:00Z')).toEqual({
      skipped: 'Covi has not commented on it',
      notes,
    });
    expect(buildOutcome(signals(), '2026-10-09T12:00:00Z').notes).toBeUndefined();
  });
});
