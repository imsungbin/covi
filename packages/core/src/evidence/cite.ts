import type { EvidenceFile, EvidenceItem } from '../model/evidence.ts';
import type { Explanation } from '../model/explanation.ts';
import { type Certainty, type FindingsFile, isBlockingCandidate } from '../model/finding.ts';
import { truncate } from '../util/text.ts';

/** A run's evidence by every id a claim may cite: each item's own id and each of its parts. */
export interface EvidenceIndex {
  readonly items: readonly EvidenceItem[];
  readonly byId: ReadonlyMap<string, EvidenceItem>;
  /** The item a cited id names, looked up as `byId` holds it: after the registry's redaction. */
  find(id: string): EvidenceItem | undefined;
}

/**
 * `redact` is the redaction the registry's ids went through. A claim may cite an id computed from
 * the raw change (a rule's hunk), so it is redacted the same way before it is looked up.
 */
export function indexEvidence(
  file: Pick<EvidenceFile, 'items'>,
  redact: (text: string) => string = (text) => text,
): EvidenceIndex {
  const byId = new Map<string, EvidenceItem>();
  for (const item of file.items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
    for (const part of item.refs ?? []) if (!byId.has(part)) byId.set(part, item);
  }
  return { items: file.items, byId, find: (id) => byId.get(redact(id)) };
}

export function unknownCitations(
  index: EvidenceIndex,
  ids: readonly string[] | undefined,
): string[] {
  return (ids ?? []).filter((id) => !index.find(id));
}

interface Cites {
  evidenceIds?: readonly string[];
}

/**
 * Every cited id the run's evidence does not have, as `where: id, id` lines that name the claim:
 * an author can only fix what the message points at.
 */
export function citationProblems(
  index: EvidenceIndex,
  claims: {
    explanation?: {
      intent?: Cites;
      behavior?: Cites;
      changes?: ReadonlyArray<Cites & { area: string }>;
    };
    findings?: ReadonlyArray<Cites & { title: string }>;
  },
): string[] {
  const out: string[] = [];
  const check = (where: string, cites: Cites | undefined) => {
    const unknown = unknownCitations(index, cites?.evidenceIds);
    if (unknown.length) out.push(`${where}: ${unknown.join(', ')}`);
  };
  const e = claims.explanation;
  check('explanation.json intent', e?.intent);
  check('explanation.json behavior', e?.behavior);
  for (const [i, c] of (e?.changes ?? []).entries())
    check(`explanation.json changes[${i}] (${truncate(c.area, 40)})`, c);
  for (const [i, f] of (claims.findings ?? []).entries())
    check(`findings.json findings[${i}] (${truncate(f.title, 60)})`, f);
  return out;
}

const hunksIn = (index: EvidenceIndex, path: string) =>
  index.items.filter((i) => i.kind === 'diff-hunk' && i.location?.path === path);

/** Every hunk of a file, in diff order. */
export function hunksOf(index: EvidenceIndex, path: string): string[] {
  return hunksIn(index, path).map((h) => h.id);
}

/**
 * The diff hunks at a location: those its lines overlap (at most three), else the nearest hunk in
 * its file, else none. Without a line, the file's first hunk.
 */
export function hunksAt(
  index: EvidenceIndex,
  location: { path: string; line?: number; endLine?: number } | undefined,
): string[] {
  if (!location) return [];
  const hunks = hunksIn(index, location.path);
  if (!hunks.length) return [];
  if (location.line === undefined) return [hunks[0]!.id];
  const from = location.line;
  const to = Math.max(from, location.endLine ?? from);
  const overlapping = hunks.filter(
    (h) => h.location!.side === 'head' && h.location!.line <= to && from <= h.location!.endLine,
  );
  if (overlapping.length) return overlapping.slice(0, 3).map((h) => h.id);
  const distance = (h: EvidenceItem) =>
    Math.min(Math.abs(h.location!.line - from), Math.abs(h.location!.endLine - from));
  return [[...hunks].sort((a, b) => distance(a) - distance(b))[0]!.id];
}

export interface GroundableFinding {
  certainty: Certainty;
  location?: { path: string; line?: number; endLine?: number };
  evidenceIds?: string[];
}

export interface Grounded<T> {
  finding: T;
  /** Cited ids the run's evidence does not have; they are dropped. */
  dropped: string[];
  /** The certainty of a finding that had nothing to cite, now reported as a risk. */
  demoted?: Certainty;
}

/**
 * Grounds a finding Covi wrote (a rule's or a model's). It keeps the ids the evidence has, cites
 * the diff hunk at its location when nothing remains, and reports a confirmed or likely finding
 * that still cites nothing as a risk: no evidence, no confirmed issue. Agents ground their own
 * findings, and Covi checks them instead.
 */
export function groundFinding<T extends GroundableFinding>(
  finding: T,
  index: EvidenceIndex,
): Grounded<T> {
  const cited = finding.evidenceIds ?? [];
  const kept = cited.filter((id) => index.find(id));
  const dropped = cited.filter((id) => !index.find(id));
  const evidenceIds = kept.length ? kept : hunksAt(index, finding.location);
  const { evidenceIds: _cited, ...rest } = finding;
  const grounded = (evidenceIds.length ? { ...rest, evidenceIds } : rest) as T;
  if (evidenceIds.length || !isBlockingCandidate(finding)) return { finding: grounded, dropped };
  return { finding: { ...grounded, certainty: 'risk' } as T, dropped, demoted: finding.certainty };
}

/** Covi's own explanation cites the hunks of each change's files; an agent's cites its own. */
export function citeChanges(explanation: Explanation, index: EvidenceIndex): Explanation {
  return {
    ...explanation,
    changes: explanation.changes.map((c) => {
      if (c.evidenceIds?.length) return c;
      const ids = c.files.flatMap((path) => hunksOf(index, path)).slice(0, 6);
      return ids.length ? { ...c, evidenceIds: ids } : c;
    }),
  };
}

/**
 * Explanation statements that claim something about the change and cite nothing: the intent, the
 * behavior when it states a before or an after, and every entry under changes. The intent's prose
 * `evidence` list is not a citation.
 */
export function ungroundedStatements(
  explanation: Pick<Explanation, 'intent' | 'behavior' | 'changes'>,
): string[] {
  const out: string[] = [];
  if (!explanation.intent.evidenceIds?.length) out.push('intent');
  const b = explanation.behavior;
  if (b && (b.before || b.after) && !b.evidenceIds?.length) out.push('behavior');
  for (const [i, c] of explanation.changes.entries())
    if (!c.evidenceIds?.length) out.push(`changes[${i}] (${truncate(c.area, 40)})`);
  return out;
}

/** A model's findings, grounded like Covi's own; the notes say what changed, for run warnings. */
export function groundModelFindings(
  file: FindingsFile,
  index: EvidenceIndex,
): { findings: FindingsFile; notes: string[] } {
  const notes: string[] = [];
  const findings = file.findings.map((f) => {
    const grounded = groundFinding(f, index);
    const title = truncate(f.title, 80);
    if (grounded.dropped.length)
      notes.push(
        `Model finding "${title}" cited evidence the run does not have (${grounded.dropped.join(', ')}); those ids were dropped.`,
      );
    if (grounded.demoted)
      notes.push(
        `Model finding "${title}" cited no evidence, so it is reported as a risk rather than ${grounded.demoted}.`,
      );
    return grounded.finding;
  });
  return { findings: { ...file, schemaVersion: 2, findings }, notes };
}
