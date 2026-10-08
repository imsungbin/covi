import type { EvidenceIndex } from '../evidence/cite.ts';
import type { EvidenceItem } from '../model/evidence.ts';
import { DEMO_PATHS } from '../run/paths.ts';
import { truncate } from '../util/text.ts';

/** At most this many citations per finding in a report; review.json keeps them all. */
const MAX_REFS = 6;

/** A code span its content cannot close or break: ids, paths, and labels come from the run. */
function span(text: string): string {
  return `\`${truncate(text.replace(/`/g, "'").replace(/\s+/g, ' ').trim(), 120)}\``;
}

/**
 * The part of an item a citation names (`#n2`), read from the item's own refs: the cited id may
 * be written before redaction, so only its ending can be compared with the registry's.
 */
function partOf(id: string, item: EvidenceItem): string {
  if (id === item.id) return '';
  const parts = (item.refs ?? [])
    .filter((ref) => ref.startsWith(item.id))
    .map((ref) => ref.slice(item.id.length))
    .filter((part) => part && id.endsWith(part));
  return parts.sort((a, b) => b.length - a.length)[0] ?? '';
}

export interface EvidenceRefOptions {
  /** `path`: run-relative (review.md sits in the run); `name`: the file name, as attached to CI artifacts. */
  style: 'path' | 'name';
  /** A safe URL for a run file, where the platform serves the run's files one by one. */
  link?: (path: string) => string | undefined;
}

/**
 * How a finding's citations read in a report: the file and lines of a diff hunk, the label of a
 * request or a command, and the file of a capture (with the part cited), linked when the platform
 * can. An id the run's evidence does not have is shown as it is.
 */
export function evidenceRefs(
  ids: readonly string[] | undefined,
  index: EvidenceIndex | undefined,
  options: EvidenceRefOptions,
): string[] {
  return (ids ?? []).slice(0, MAX_REFS).map((id) => {
    const item = index?.find(id);
    if (!item) return span(id);
    if (item.kind === 'diff-hunk' || item.path === DEMO_PATHS.captures) return span(item.label);
    const file = options.style === 'path' ? item.path : (item.path.split('/').at(-1) ?? item.path);
    const text = span(`${file}${partOf(id, item)}`);
    const url = options.link?.(item.path);
    return url ? `[${text}](${url})` : text;
  });
}
