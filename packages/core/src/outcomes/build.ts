import { type ChangeSignals, type OutcomeFile, OutcomeFileSchema } from '../model/outcome.ts';
import { parseLedger } from './ledger.ts';

/** `notes` are the collector's, passed on so the caller can warn; they never reach the file. */
export type BuiltOutcome = (
  | { outcome: OutcomeFile; skipped?: undefined }
  | { outcome?: undefined; skipped: string }
) & { notes?: string[] };

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/**
 * Votes on a finding's anchor, one per person, without the change author's: they would rather their
 * code ship, so their vote on a finding about it says more about that wish than about the finding.
 * Someone who gave both 👍 and 👎 has not decided, so they count on neither side.
 */
function thumbsOf(anchor: ChangeSignals['anchors'][number], author: string) {
  const votes = new Map<string, Set<'up' | 'down'>>();
  for (const r of anchor.reactions)
    if (r.user !== author) votes.set(r.user, (votes.get(r.user) ?? new Set()).add(r.vote));
  const thumbs = { up: 0, down: 0 };
  for (const vote of votes.values()) if (vote.size === 1) thumbs[[...vote][0]!]++;
  return thumbs;
}

/**
 * One change's outcome: the ledger in Covi's comment says what Covi reported, push by push; the
 * platform's signals say what became of the change, the comment, and each finding's anchor.
 */
export function buildOutcome(signals: ChangeSignals, collectedAt: string): BuiltOutcome {
  const built = outcomeOf(signals, collectedAt);
  const notes = [...(signals.notes ?? [])];
  const outcome = built.outcome;
  if (outcome?.change.state === 'merged' && outcome.change.head !== outcome.head)
    notes.push(
      `Covi last reviewed ${outcome.head}, but the change merged at ${outcome.change.head ?? 'an unknown commit'}: findings still present then count neither way`,
    );
  return notes.length ? { ...built, notes } : built;
}

/** The first 7 characters of a commit id, or nothing when the platform sent something else. */
const shortSha = (sha: string | undefined) =>
  sha && /^[0-9a-f]{7,64}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : undefined;

function outcomeOf(signals: ChangeSignals, collectedAt: string): BuiltOutcome {
  if (!signals.comment) return { skipped: 'Covi has not commented on it' };
  const ledger = parseLedger(signals.comment.body);
  if (!ledger)
    return {
      skipped:
        "Covi's comment carries no outcome ledger (it was posted before Covi tracked outcomes, or edited)",
    };
  const anchors = new Map(signals.anchors.map((a) => [a.key, a]));
  const candidate = {
    schemaVersion: 1,
    runId: ledger.run,
    collectedAt,
    head: ledger.head,
    change: defined({
      platform: signals.platform,
      repository: signals.repository,
      number: signals.number,
      url: signals.url,
      state: signals.state,
      head: shortSha(signals.head),
      closedAt: signals.closedAt,
      revertedBy: signals.revertedBy ? defined(signals.revertedBy) : undefined,
    }),
    comment: defined({
      id: signals.comment.id,
      url: signals.comment.url,
      rating: { up: signals.comment.up, down: signals.comment.down },
      replies: signals.comment.replies,
    }),
    findings: ledger.findings.map((e) => {
      const anchor = anchors.get(e.k);
      return {
        key: e.k,
        certainty: e.c,
        firstHead: e.f,
        lastHead: e.l,
        fate: e.x === 'a' ? 'addressed' : e.x === 's' ? 'superseded' : 'present',
        ...(anchor ? { thumbs: thumbsOf(anchor, signals.author), replies: anchor.replies } : {}),
      };
    }),
  };
  const parsed = OutcomeFileSchema.safeParse(candidate);
  if (parsed.success) return { outcome: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    skipped: `its outcome does not fit the schema (${issue?.path.join('.')}: ${issue?.message})`,
  };
}
