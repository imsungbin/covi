import type { ChangedFile } from '../../model/change.ts';
import type { FindingInput } from '../../model/finding.ts';
import { joinList, plural } from '../../util/text.ts';
import { addedLines, isAppCode, quote, type Rule, removedLines } from './types.ts';

export const asyncForEach: Rule = {
  id: 'async-foreach',
  checks: 'async callbacks passed to forEach (never awaited)',
  run({ files }) {
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      if (!/\.forEach\(\s*async\b/.test(line.text)) continue;
      out.push({
        title: `forEach with an async callback in ${file.path}`,
        certainty: 'likely',
        severity: 'medium',
        category: 'concurrency',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation:
          'forEach ignores the promises its callback returns: the loop finishes before the work does, failures become unhandled rejections, and ordering is not guaranteed.',
        suggestion:
          'Use `for (const x of items) await ...` for sequential work or `await Promise.all(items.map(...))` for parallel work.',
      });
    }
    return out.slice(0, 2);
  },
};

export const emptyCatch: Rule = {
  id: 'empty-catch',
  checks: 'errors that are caught and silently discarded',
  run({ files }) {
    const out: FindingInput[] = [];
    for (const file of files.filter(isAppCode)) {
      for (const h of file.hunks) {
        const lines = h.lines;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!;
          if (l.kind !== 'add') continue;
          const next = lines[i + 1];
          const oneLine =
            /\bcatch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)|\.catch\(\s*\(\)\s*=>\s*(undefined|null)\s*\)/.test(
              l.text,
            );
          const twoLine =
            next?.kind === 'add' &&
            ((/\bcatch\s*(\([^)]*\))?\s*\{\s*$/.test(l.text) && /^\s*\}\s*$/.test(next.text)) ||
              (/^\s*except(\s+[\w.,() ]+)?(\s+as\s+\w+)?\s*:\s*$/.test(l.text) &&
                /^\s*pass\s*$/.test(next.text)));
          if (!oneLine && !twoLine) continue;
          out.push({
            title: `Error silently swallowed in ${file.path}`,
            certainty: 'risk',
            severity: 'medium',
            category: 'error-handling',
            location: { path: file.path, line: l.newLine },
            evidence: twoLine ? `${quote(l.text, 100)} ⏎ ${quote(next!.text, 40)}` : quote(l.text),
            explanation:
              'Failures in this block disappear without logging or recovery, which hides bugs and makes incidents hard to diagnose.',
            suggestion:
              'Handle the error explicitly, log it, or let it propagate; if ignoring is intentional, say why in a comment.',
          });
        }
      }
    }
    return out.slice(0, 3);
  },
};

const ERROR_HANDLING =
  /\bcatch\b|\bexcept\b|\brescue\b|if\s+err\s*!=\s*nil|\.catch\(|\bfinally\b|\bon_error\b|\bRecover\(\)/;

export const errorHandlingRemoved: Rule = {
  id: 'error-handling-removed',
  checks: 'error handling removed without replacement',
  run({ files }) {
    const out: FindingInput[] = [];
    for (const file of files.filter((f) => f.category === 'source' && f.status === 'modified')) {
      const removed = removedLines([file]).filter(
        ({ line }) => ERROR_HANDLING.test(line.text) && !/^\s*(\/\/|#)/.test(line.text),
      );
      const added = addedLines([file]).filter(({ line }) => ERROR_HANDLING.test(line.text));
      if (removed.length === 0 || removed.length <= added.length) continue;
      const first = removed[0]!;
      out.push({
        title: `Error handling removed in ${file.path}`,
        certainty: 'risk',
        severity: 'medium',
        category: 'error-handling',
        location: { path: file.path },
        evidence: `${plural(removed.length, 'error-handling line')} removed, ${added.length} added. First removed: ${quote(first.line.text, 120)} (old line ${first.line.oldLine})`,
        explanation:
          'Failures that used to be handled here may now propagate to callers or crash the operation.',
        suggestion:
          'Confirm the failure cases are still handled somewhere (or are impossible now).',
      });
    }
    return out.slice(0, 2);
  },
};

export const removedExportStillReferenced: Rule = {
  id: 'removed-export-still-referenced',
  checks: 'removed or renamed exports that other files still use',
  async run({ context, reader }) {
    const out: FindingInput[] = [];
    const removed = context.symbols.filter(
      (s) =>
        s.change === 'removed' &&
        s.exported &&
        !['route', 'selector', 'test'].includes(s.kind) &&
        s.name.length >= 3,
    );
    for (const sym of removed.slice(0, 15)) {
      // Moved, not removed: defined again somewhere in this change.
      if (context.symbols.some((s) => s.name === sym.name && s.change === 'added')) continue;
      const hits = await reader.grep(sym.name, {
        at: 'head',
        fixed: true,
        word: true,
        pathspecs: [':(exclude,glob)**/node_modules/**'],
        maxHits: 50,
      });
      const callers = hits.filter(
        (h) =>
          h.path !== sym.path &&
          /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rs|rb|java|kt)$/.test(h.path),
      );
      if (callers.length === 0) continue;
      const sample = callers.slice(0, 3).map((h) => `${h.path}:${h.line}: ${quote(h.text, 90)}`);
      out.push({
        title: `Removed export ${sym.name} is still referenced`,
        certainty: 'likely',
        severity: 'high',
        category: 'api-compatibility',
        location: { path: sym.path, line: sym.line },
        evidence: `${sym.name} was removed from ${sym.path}, but ${plural(callers.length, 'reference')} remain:\n${sample.join('\n')}`,
        explanation:
          'Code that still imports or calls the removed symbol will fail to compile or throw at runtime.',
        suggestion: `Update the remaining references, or keep ${sym.name} as a deprecated alias.`,
      });
    }
    return out;
  },
};

export const routeRemoved: Rule = {
  id: 'route-removed',
  checks: 'API routes removed or renamed',
  run({ context }) {
    const out: FindingInput[] = [];
    const added = new Set(context.routes.filter((r) => r.change === 'added').map((r) => r.path));
    for (const r of context.routes.filter((r) => r.change === 'removed')) {
      if (added.has(r.path)) continue;
      out.push({
        title: `API route ${r.method ? `${r.method} ` : ''}${r.path} removed`,
        certainty: 'risk',
        severity: 'high',
        category: 'api-compatibility',
        location: { path: r.file, line: r.line },
        evidence: `The route definition for ${r.method ? `${r.method} ` : ''}${r.path} is gone from ${r.file}.`,
        explanation:
          'Existing clients, integrations, or cached frontends calling this route will start receiving errors.',
        suggestion: 'Confirm no clients depend on it, or keep it with a deprecation period.',
      });
    }
    return out;
  },
};

export const destructiveMigration: Rule = {
  id: 'destructive-migration',
  checks: 'destructive schema and data migrations',
  run({ context }) {
    const destructive = context.data.filter((d) => d.destructive);
    if (destructive.length === 0) return [];
    const byFile = new Map<string, typeof destructive>();
    for (const d of destructive) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
    return [...byFile.entries()].map(([file, ops]) => ({
      title: `Destructive migration in ${file}`,
      certainty: 'risk' as const,
      severity: 'high' as const,
      category: 'data-integrity' as const,
      location: { path: file, line: ops[0]!.line },
      evidence: ops
        .slice(0, 3)
        .map((o) => o.statement)
        .join('\n'),
      explanation: `${joinList(ops.slice(0, 3).map((o) => o.operation.replace('-', ' ')))} cannot be undone without a backup, and code still running the previous version during deploy may break.`,
      suggestion:
        'Use an expand/contract rollout (stop using the column first, drop it in a later release) and confirm backups.',
    }));
  },
};

export const schemaWithoutMigration: Rule = {
  id: 'schema-without-migration',
  checks: 'ORM schema changes without a migration',
  run({ files }) {
    const out: FindingInput[] = [];
    const migrationAdded = (dir: RegExp) =>
      files.some((f) => f.status === 'added' && dir.test(f.path));
    const prisma = files.find(
      (f) => /(^|\/)schema\.prisma$/.test(f.path) && f.status !== 'deleted',
    );
    if (prisma && prismaModelChanged(prisma) && !migrationAdded(/prisma\/migrations\//)) {
      out.push(missingMigration(prisma, 'Prisma schema'));
    }
    for (const f of files.filter((x) => /(^|\/)models\.py$/.test(x.path))) {
      const fieldChange = f.hunks.some((h) =>
        h.lines.some((l) => l.kind !== 'context' && /=\s*models\.\w+\(/.test(l.text)),
      );
      if (fieldChange && !migrationAdded(/(^|\/)migrations\/\d+_[\w]+\.py$/))
        out.push(missingMigration(f, 'Django model'));
    }
    return out;
  },
};

function prismaModelChanged(file: ChangedFile): boolean {
  return file.hunks.some((h) =>
    h.lines.some(
      (l) =>
        l.kind !== 'context' && /^\s*(\w+\s+\w+[?[\]]*(\s+@.*)?|model\s+\w+\s*\{)\s*$/.test(l.text),
    ),
  );
}

function missingMigration(file: ChangedFile, kind: string): FindingInput {
  const line = file.hunks.flatMap((h) => h.lines).find((l) => l.kind === 'add')?.newLine;
  return {
    title: `${kind} changed without a migration`,
    certainty: 'likely',
    severity: 'medium',
    category: 'data-integrity',
    location: { path: file.path, line },
    evidence: `${file.path} changes model fields, and no migration file is added in this change.`,
    explanation:
      'Deployed databases keep the old schema, so queries for the new fields fail at runtime.',
    suggestion: 'Generate and commit the migration alongside the schema change.',
  };
}
