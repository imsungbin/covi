import type { CoviConfig } from '../../config/schema.ts';
import type { RevisionReader } from '../../git/reader.ts';
import { type Params, t } from '../../i18n/catalog.ts';
import type { Language } from '../../i18n/language.ts';
import type { ChangedFile, CodeChange, DiffLine } from '../../model/change.ts';
import type { ReviewContext } from '../../model/context.ts';
import type { FindingInput } from '../../model/finding.ts';

export interface RuleContext {
  change: CodeChange;
  context: ReviewContext;
  config: CoviConfig;
  reader: RevisionReader;
  /** Reviewable (non-ignored) files. */
  files: readonly ChangedFile[];
  /** The language findings are written in. Default: English. */
  language?: Language;
}

/** A rule's messages (`rule.<id>.<key>` in the catalogs), in the run's language. */
export function messages(
  language: Language | undefined,
  id: string,
): (key: string, params?: Params) => string {
  return (key, params) => t(language ?? 'en', `rule.${id}.${key}`, params);
}

/**
 * A review rule is a precise, evidence-producing check. Rules must prefer silence over noise:
 * a rule only reports when the diff itself (or a repository lookup) supports the claim.
 */
export interface Rule {
  id: string;
  /** What the rule checks, shown in the review's "What Covi checked" section. */
  checks: string;
  run(ctx: RuleContext): Promise<FindingInput[]> | FindingInput[];
}

export interface AddedLine {
  file: ChangedFile;
  line: DiffLine;
}

export function addedLines(
  files: readonly ChangedFile[],
  filter?: (f: ChangedFile) => boolean,
): AddedLine[] {
  const out: AddedLine[] = [];
  for (const file of files) {
    if (file.binary || (filter && !filter(file))) continue;
    for (const h of file.hunks)
      for (const line of h.lines) if (line.kind === 'add') out.push({ file, line });
  }
  return out;
}

export function removedLines(
  files: readonly ChangedFile[],
  filter?: (f: ChangedFile) => boolean,
): AddedLine[] {
  const out: AddedLine[] = [];
  for (const file of files) {
    if (file.binary || (filter && !filter(file))) continue;
    for (const h of file.hunks)
      for (const line of h.lines) if (line.kind === 'del') out.push({ file, line });
  }
  return out;
}

export function quote(text: string, max = 160): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const isCode = (f: ChangedFile) =>
  f.category === 'source' || f.category === 'markup' || f.category === 'test';
export const isAppCode = (f: ChangedFile) => f.category === 'source' || f.category === 'markup';
