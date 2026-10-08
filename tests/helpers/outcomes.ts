import type { OutcomeFile, OutcomeFinding } from '../../packages/core/src/model/outcome.ts';

export interface OutcomeOverrides {
  number?: number;
  repository?: string;
  state?: OutcomeFile['change']['state'];
  revertedBy?: { sha: string; url?: string };
  /** The change's head when collected; `null` leaves it out. Default: the head Covi reviewed. */
  changeHead?: string | null;
  runId?: string;
  collectedAt?: string;
  rating?: { up: number; down: number };
  /** Each entry overrides a likely finding that was still present at the last review. */
  findings?: Array<Partial<OutcomeFinding>>;
}

let counter = 0;

/** A valid outcome file for a merged change on acme/shop, with one likely finding by default. */
export function outcomeFile(over: OutcomeOverrides = {}): OutcomeFile {
  const number = over.number ?? ++counter;
  return {
    schemaVersion: 1,
    runId: over.runId ?? `20261009-1200${String(number % 100).padStart(2, '0')}-ci-aaaaaaa`,
    collectedAt: over.collectedAt ?? '2026-10-09T12:00:00.000Z',
    head: 'aaaaaaa',
    change: {
      platform: 'github',
      repository: over.repository ?? 'acme/shop',
      number,
      url: `https://github.com/acme/shop/pull/${number}`,
      state: over.state ?? 'merged',
      ...(over.changeHead === null ? {} : { head: over.changeHead ?? 'aaaaaaa' }),
      ...(over.revertedBy ? { revertedBy: over.revertedBy } : {}),
    },
    comment: { id: String(1000 + number), rating: over.rating ?? { up: 0, down: 0 }, replies: 0 },
    findings: (over.findings ?? [{}]).map((f, i) => ({
      key: (i + 1).toString(16).padStart(12, '0'),
      certainty: 'likely',
      firstHead: 'aaaaaaa',
      lastHead: 'aaaaaaa',
      fate: 'present',
      ...f,
    })),
  };
}
