import { t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import { CERTAINTIES, type Certainty, isBlockingCandidate } from '../model/finding.ts';
import type { OutcomeFile, OutcomeFinding, OutcomePlatform } from '../model/outcome.ts';

export type Label = 'right' | 'wrong' | 'unlabeled';
export type LabelSignal = 'thumbs' | 'addressed' | 'merged-unchanged' | 'none';

const UNLABELED = { label: 'unlabeled', signal: 'none' } as const;

/** Whether a finding held up, and what says so. The first rule that applies decides. */
export function labelFinding(
  finding: OutcomeFinding,
  change: OutcomeFile['change'],
): { label: Label; signal: LabelSignal } {
  const thumbs = finding.thumbs;
  // People's explicit votes on the finding win over anything inferred.
  if (thumbs && thumbs.up !== thumbs.down)
    return { label: thumbs.up > thumbs.down ? 'right' : 'wrong', signal: 'thumbs' };
  // Until a change closes, what happens to its findings is still in motion.
  if (change.state === 'open') return UNLABELED;
  if (finding.fate === 'addressed') return { label: 'right', signal: 'addressed' };
  // A reworded finding, or a stale entry an edited ledger left behind, was not fixed and did not
  // ship as reported: only votes can say how it held up.
  if (finding.fate === 'superseded') return UNLABELED;
  // Shipping code Covi called an issue says the team disagreed. A revert says the change was
  // wrong somehow, not that this finding was; risks and questions are not claims of a defect.
  // Only the commit that merged says what shipped: a fix pushed and merged before its review
  // finished leaves the finding in a ledger one push behind.
  if (
    change.state === 'merged' &&
    !change.revertedBy &&
    change.head !== undefined &&
    change.head === finding.lastHead &&
    isBlockingCandidate(finding)
  )
    return { label: 'wrong', signal: 'merged-unchanged' };
  return UNLABELED;
}

export interface CertaintyStats {
  reported: number;
  right: number;
  wrong: number;
  unlabeled: number;
  /** right / (right + wrong), 3 decimals; null when nothing is labeled. */
  precision: number | null;
}

export interface RepositoryOutcomes {
  platform: OutcomePlatform;
  repository: string;
  changes: number;
  open: number;
  merged: number;
  closed: number;
  reverted: number;
  rating: { up: number; down: number };
  certainty: Record<Certainty, CertaintyStats>;
  signals: { thumbs: number; addressed: number; mergedUnchanged: number };
}

export interface OutcomeReport {
  schemaVersion: 1;
  files: number;
  repositories: RepositoryOutcomes[];
}

function tally(files: readonly OutcomeFile[]): Pick<RepositoryOutcomes, 'certainty' | 'signals'> {
  const certainty = Object.fromEntries(
    CERTAINTIES.map((c) => [c, { reported: 0, right: 0, wrong: 0, unlabeled: 0, precision: null }]),
  ) as Record<Certainty, CertaintyStats>;
  const signals = { thumbs: 0, addressed: 0, mergedUnchanged: 0 };
  for (const file of files)
    for (const finding of file.findings) {
      const stats = certainty[finding.certainty];
      const { label, signal } = labelFinding(finding, file.change);
      stats.reported++;
      stats[label]++;
      if (signal === 'thumbs') signals.thumbs++;
      else if (signal === 'addressed') signals.addressed++;
      else if (signal === 'merged-unchanged') signals.mergedUnchanged++;
    }
  for (const stats of Object.values(certainty)) {
    const labeled = stats.right + stats.wrong;
    stats.precision = labeled ? Math.round((stats.right / labeled) * 1000) / 1000 : null;
  }
  return { certainty, signals };
}

/** Precision by certainty, per repository, from collected outcome files. */
export function outcomeReport(files: readonly OutcomeFile[]): OutcomeReport {
  const groups = new Map<string, OutcomeFile[]>();
  for (const file of files) {
    const key = `${file.change.platform}\u0000${file.change.repository}`;
    const group = groups.get(key);
    if (group) group.push(file);
    else groups.set(key, [file]);
  }
  const repositories = [...groups.values()]
    .map((group): RepositoryOutcomes => {
      const count = (state: OutcomeFile['change']['state']) =>
        group.filter((f) => f.change.state === state).length;
      return {
        platform: group[0]!.change.platform,
        repository: group[0]!.change.repository,
        changes: group.length,
        open: count('open'),
        merged: count('merged'),
        closed: count('closed'),
        reverted: group.filter((f) => f.change.revertedBy).length,
        rating: {
          up: group.reduce((n, f) => n + f.comment.rating.up, 0),
          down: group.reduce((n, f) => n + f.comment.rating.down, 0),
        },
        ...tally(group),
      };
    })
    .sort(
      (a, b) =>
        a.repository.localeCompare(b.repository, 'en') ||
        a.platform.localeCompare(b.platform, 'en'),
    );
  return { schemaVersion: 1, files: files.length, repositories };
}

/** A few lines for people: what happened to the changes, and how each certainty held up. */
export function summarizeOutcomes(report: OutcomeReport, language: Language): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `outcomes.${key}`, params);
  if (!report.repositories.length) return say('empty');
  const out: string[] = [];
  for (const r of report.repositories) {
    if (report.repositories.length > 1) out.push(say('repository', { repository: r.repository }));
    out.push(
      say('changes', {
        count: r.changes,
        merged: r.merged,
        reverted: r.reverted,
        closed: r.closed,
        open: r.open,
      }),
      say('rating', { up: r.rating.up, down: r.rating.down }),
    );
    for (const c of CERTAINTIES) {
      const s = r.certainty[c];
      if (!s.reported) continue;
      const certainty = t(language, `certainty.${c}`);
      const labeled = s.right + s.wrong;
      out.push(
        labeled
          ? say('precision', {
              certainty,
              right: s.right,
              labeled,
              percent: Math.round((100 * s.right) / labeled),
              unlabeled: s.unlabeled,
            })
          : say('noSignal', { certainty, count: s.reported }),
      );
    }
  }
  return out.join('\n');
}

/** Fewer labeled findings than this say too little to show in a brief. */
export const CALIBRATION_MIN_LABELED = 5;

export interface Calibration {
  /** Changes the outcomes come from. */
  changes: number;
  lines: Array<{ certainty: Certainty; right: number; labeled: number; percent: number }>;
}

/** What the brief shows: certainties with enough labeled findings, or nothing at all. */
export function calibrationOf(files: readonly OutcomeFile[]): Calibration | undefined {
  const { certainty } = tally(files);
  const lines = CERTAINTIES.map((c) => ({
    certainty: c,
    right: certainty[c].right,
    labeled: certainty[c].right + certainty[c].wrong,
  }))
    .filter((line) => line.labeled >= CALIBRATION_MIN_LABELED)
    .map((line) => ({ ...line, percent: Math.round((100 * line.right) / line.labeled) }));
  return lines.length ? { changes: files.length, lines } : undefined;
}
