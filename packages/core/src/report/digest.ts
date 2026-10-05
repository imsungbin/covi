import type { ChangedFile, CodeChange, Hunk } from '../model/change.ts';
import type { ReviewContext } from '../model/context.ts';
import type { Redactor } from '../security/redact.ts';
import { fence } from '../util/text.ts';

export interface DiffDigest {
  text: string;
  included: string[];
  omitted: Array<{ path: string; reason: string }>;
}

export function renderHunk(h: Hunk): string {
  const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.section ? ` ${h.section}` : ''}`;
  const body = h.lines.map(
    (l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`,
  );
  return [header, ...body].join('\n');
}

export function renderFileDiff(file: ChangedFile, maxLines = Number.POSITIVE_INFINITY): string {
  const lines: string[] = [];
  let count = 0;
  for (const h of file.hunks) {
    const text = renderHunk(h).split('\n');
    if (count + text.length > maxLines) {
      const room = Math.max(0, maxLines - count);
      lines.push(...text.slice(0, room));
      const remaining =
        file.hunks.slice(file.hunks.indexOf(h)).reduce((n, x) => n + x.lines.length, 0) -
        Math.max(0, room - 1);
      lines.push(`… ${remaining} more lines omitted`);
      return lines.join('\n');
    }
    lines.push(...text);
    count += text.length;
  }
  return lines.join('\n');
}

const SKIP_REASON: Partial<Record<ChangedFile['category'], string>> = {
  lockfile: 'lockfile (mechanical)',
  generated: 'generated',
  vendored: 'vendored',
};

/**
 * A size-bounded diff excerpt in reading order, for agents and models. Lockfiles, generated and
 * binary files are listed but not inlined, and every byte passes through the redactor.
 */
export function renderDiffDigest(
  change: CodeChange,
  context: ReviewContext,
  options: { maxChars: number; redactor: Redactor; perFileMaxLines?: number },
): DiffDigest {
  const order = new Map(context.readingOrder.map((s, i) => [s.path, i]));
  const files = [...change.files].sort(
    (a, b) =>
      (order.get(a.path) ?? 1000) - (order.get(b.path) ?? 1000) ||
      b.additions + b.deletions - (a.additions + a.deletions),
  );
  const parts: string[] = [];
  const included: string[] = [];
  const omitted: DiffDigest['omitted'] = [];
  let used = 0;
  for (const f of files) {
    const reason = f.ignored
      ? `ignored (${f.ignoreReason})`
      : f.binary
        ? 'binary'
        : SKIP_REASON[f.category];
    if (reason) {
      omitted.push({ path: f.path, reason });
      continue;
    }
    const header = `### ${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ''} · ${f.status} · +${f.additions} −${f.deletions} · ${f.category}`;
    const body = f.hunks.length
      ? fence(renderFileDiff(f, options.perFileMaxLines ?? 400), 'diff')
      : '_(no textual changes)_';
    const block = options.redactor.redact(`${header}\n\n${body}\n`);
    if (used + block.length > options.maxChars && included.length > 0) {
      omitted.push({ path: f.path, reason: 'size budget' });
      continue;
    }
    parts.push(block);
    included.push(f.path);
    used += block.length;
  }
  return { text: parts.join('\n'), included, omitted };
}
