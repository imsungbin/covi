import type { Finding } from '../model/finding.ts';
import { type Ledger, type LedgerEntry, LedgerSchema, OUTCOME_LIMITS } from '../model/outcome.ts';
import { shortHash } from '../util/hash.ts';

const LEDGER_OPEN = '<!-- covi:ledger v1 ';
const LEDGER = new RegExp(`^${LEDGER_OPEN}([A-Za-z0-9_-]{1,${OUTCOME_LIMITS.ledgerChars}}) -->$`);
const ANCHOR = /^\s*<!-- covi:finding ([0-9a-f]{12}) -->/;

/**
 * A finding's identity across pushes. A finding id includes its line, which moves whenever code
 * above it changes; this key leaves the line out, and the digits in the title too.
 */
export function outcomeKey(finding: Pick<Finding, 'title' | 'location' | 'source'>): string {
  const title = finding.title.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return shortHash(
    'finding',
    finding.source.id ?? finding.source.kind,
    finding.location?.path ?? '',
    title,
  );
}

/** Where a finding sits: a new finding in the same place rewords an old one rather than fixing it. */
export function areaKey(finding: Pick<Finding, 'category' | 'location'>): string {
  return shortHash('area', finding.category, finding.location?.path ?? '').slice(0, 8);
}

/**
 * Folds one review into the ledger its change's comment already carries. Undefined when the run
 * id or the head cannot be recorded (a run Covi did not name).
 */
export function mergeLedger(
  previous: Ledger | undefined,
  current: { runId: string; head: string; findings: readonly Finding[] },
): Ledger | undefined {
  const head = current.head.slice(0, 7).toLowerCase();
  const now = new Map<string, Finding>();
  for (const f of current.findings) if (!now.has(outcomeKey(f))) now.set(outcomeKey(f), f);
  const entries = new Map<string, LedgerEntry>(
    (previous?.findings ?? []).map((e) => [e.k, { ...e }]),
  );
  if (previous) {
    const sameHead = previous.head === head;
    const newAreas = new Set([...now].filter(([k]) => !entries.has(k)).map(([, f]) => areaKey(f)));
    for (const [k, e] of entries) {
      if (e.x || now.has(k)) continue;
      // Only new code fixes a finding: the same commit reviewed again proves nothing. Neither does
      // an entry left unresolved behind the head, which only an edited ledger holds.
      if (e.l !== previous.head || (sameHead && e.f !== head)) e.x = 's';
      else if (sameHead) entries.delete(k);
      else e.x = newAreas.has(e.a) ? 's' : 'a';
    }
  }
  for (const [k, f] of now) {
    const e = entries.get(k);
    if (e) {
      e.c = f.certainty;
      e.l = head;
      delete e.x;
    } else entries.set(k, { k, c: f.certainty, a: areaKey(f), f: head, l: head });
  }
  // Over the cap, resolved findings go first, oldest first. Present ones go only if nothing else is
  // left, from the end: a review lists its most blocking findings first.
  let drop = Math.max(0, entries.size - OUTCOME_LIMITS.findings);
  const findings = [...entries.values()]
    .filter((e) => {
      if (drop === 0 || e.x === undefined) return true;
      drop--;
      return false;
    })
    .slice(0, OUTCOME_LIMITS.findings);
  const parsed = LedgerSchema.safeParse({ v: 1, run: current.runId, head, findings });
  return parsed.success ? parsed.data : undefined;
}

/**
 * The ledger as a hidden HTML comment: base64url, so no text in it can end the comment early.
 * It must be the last thing in the comment body, since `parseLedger` reads nothing else.
 */
export function renderLedger(ledger: Ledger): string {
  return `${LEDGER_OPEN}${Buffer.from(JSON.stringify(ledger)).toString('base64url')} -->`;
}

/**
 * The ledger that ends a comment body, if it decodes and fits the schema. Only the trailing block
 * counts: a finding's evidence can quote a ledger, and a quoted one must never be believed.
 */
export function parseLedger(body: string): Ledger | undefined {
  const tail = body.trimEnd();
  const start = tail.lastIndexOf(LEDGER_OPEN);
  if (start === -1) return undefined;
  const match = LEDGER.exec(tail.slice(start));
  if (!match) return undefined;
  try {
    const decoded = Buffer.from(match[1]!, 'base64url').toString('utf8');
    const parsed = LedgerSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The hidden marker that opens an inline comment and makes it a finding's anchor. */
export function anchorMarker(key: string): string {
  return `<!-- covi:finding ${key} -->`;
}

/** The finding key of an anchor comment, read only from the marker that opens it. */
export function anchorKeyOf(body: string): string | undefined {
  return ANCHOR.exec(body)?.[1];
}
