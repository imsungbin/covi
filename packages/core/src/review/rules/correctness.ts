import { listOf, t } from '../../i18n/catalog.ts';
import type { ChangedFile } from '../../model/change.ts';
import type { FindingInput } from '../../model/finding.ts';
import { addedLines, isAppCode, messages, quote, type Rule, removedLines } from './types.ts';

export const asyncForEach: Rule = {
  id: 'async-foreach',
  checks: 'async callbacks passed to forEach (never awaited)',
  run({ files, language }) {
    const say = messages(language, 'async-foreach');
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      if (!/\.forEach\(\s*async\b/.test(line.text)) continue;
      out.push({
        title: say('title', { path: file.path }),
        certainty: 'likely',
        severity: 'medium',
        category: 'concurrency',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      });
    }
    return out.slice(0, 2);
  },
};

export const emptyCatch: Rule = {
  id: 'empty-catch',
  checks: 'errors that are caught and silently discarded',
  run({ files, language }) {
    const say = messages(language, 'empty-catch');
    const out: FindingInput[] = [];
    for (const file of files.filter(isAppCode)) {
      for (const h of file.hunks) {
        const lines = h.lines;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!;
          if (l.kind !== 'add') continue;
          const next = lines[i + 1];
          const oneLine =
            // An empty handler discards the error; `.catch(() => undefined)` names a fallback value
            // on purpose, so it is not reported.
            /\bcatch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/.test(
              l.text,
            );
          const twoLine =
            next?.kind === 'add' &&
            ((/\bcatch\s*(\([^)]*\))?\s*\{\s*$/.test(l.text) && /^\s*\}\s*$/.test(next.text)) ||
              (/^\s*except(\s+[\w.,() ]+)?(\s+as\s+\w+)?\s*:\s*$/.test(l.text) &&
                /^\s*pass\s*$/.test(next.text)));
          if (!oneLine && !twoLine) continue;
          out.push({
            title: say('title', { path: file.path }),
            certainty: 'risk',
            severity: 'medium',
            category: 'error-handling',
            location: { path: file.path, line: l.newLine },
            evidence: twoLine ? `${quote(l.text, 100)} ⏎ ${quote(next!.text, 40)}` : quote(l.text),
            explanation: say('explanation'),
            suggestion: say('suggestion'),
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
  run({ files, language }) {
    const say = messages(language, 'error-handling-removed');
    const out: FindingInput[] = [];
    for (const file of files.filter((f) => f.category === 'source' && f.status === 'modified')) {
      const removed = removedLines([file]).filter(
        ({ line }) => ERROR_HANDLING.test(line.text) && !/^\s*(\/\/|#)/.test(line.text),
      );
      const added = addedLines([file]).filter(({ line }) => ERROR_HANDLING.test(line.text));
      if (removed.length === 0 || removed.length <= added.length) continue;
      const first = removed[0]!;
      out.push({
        title: say('title', { path: file.path }),
        certainty: 'risk',
        severity: 'medium',
        category: 'error-handling',
        location: { path: file.path },
        evidence: say('evidence', {
          removed: say('lines', { count: removed.length }),
          added: added.length,
          line: quote(first.line.text, 120),
          number: String(first.line.oldLine),
        }),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      });
    }
    return out.slice(0, 2);
  },
};

export const removedExportStillReferenced: Rule = {
  id: 'removed-export-still-referenced',
  checks: 'removed or renamed exports that other files still use',
  async run({ context, reader, language }) {
    const say = messages(language, 'removed-export-still-referenced');
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
        title: say('title', { name: sym.name }),
        certainty: 'likely',
        severity: 'high',
        category: 'api-compatibility',
        location: { path: sym.path, line: sym.line },
        evidence: say('evidence', {
          name: sym.name,
          path: sym.path,
          references: say('references', { count: callers.length }),
          sample: sample.join('\n'),
        }),
        explanation: say('explanation'),
        suggestion: say('suggestion', { name: sym.name }),
      });
    }
    return out;
  },
};

export const routeRemoved: Rule = {
  id: 'route-removed',
  checks: 'API routes removed or renamed',
  run({ context, language }) {
    const say = messages(language, 'route-removed');
    const out: FindingInput[] = [];
    const added = new Set(context.routes.filter((r) => r.change === 'added').map((r) => r.path));
    for (const r of context.routes.filter((r) => r.change === 'removed')) {
      if (added.has(r.path)) continue;
      const route = `${r.method ? `${r.method} ` : ''}${r.path}`;
      out.push({
        title: say('title', { route }),
        certainty: 'risk',
        severity: 'high',
        category: 'api-compatibility',
        location: { path: r.file, line: r.line },
        evidence: say('evidence', { route, file: r.file }),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      });
    }
    return out;
  },
};

export const destructiveMigration: Rule = {
  id: 'destructive-migration',
  checks: 'destructive schema and data migrations',
  run({ context, language }) {
    const say = messages(language, 'destructive-migration');
    const destructive = context.data.filter((d) => d.destructive);
    if (destructive.length === 0) return [];
    const byFile = new Map<string, typeof destructive>();
    for (const d of destructive) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
    return [...byFile.entries()].map(([file, ops]) => ({
      title: say('title', { file }),
      certainty: 'risk' as const,
      severity: 'high' as const,
      category: 'data-integrity' as const,
      location: { path: file, line: ops[0]!.line },
      evidence: ops
        .slice(0, 3)
        .map((o) => o.statement)
        .join('\n'),
      explanation: say('explanation', {
        operations: listOf(
          language ?? 'en',
          ops.slice(0, 3).map((o) => t(language ?? 'en', `reading.operation.${o.operation}`)),
        ),
      }),
      suggestion: say('suggestion'),
    }));
  },
};

export const schemaWithoutMigration: Rule = {
  id: 'schema-without-migration',
  checks: 'ORM schema changes without a migration',
  run({ files, language }) {
    const say = messages(language, 'schema-without-migration');
    const out: FindingInput[] = [];
    const migrationAdded = (dir: RegExp) =>
      files.some((f) => f.status === 'added' && dir.test(f.path));
    const prisma = files.find(
      (f) => /(^|\/)schema\.prisma$/.test(f.path) && f.status !== 'deleted',
    );
    if (prisma && prismaModelChanged(prisma) && !migrationAdded(/prisma\/migrations\//)) {
      out.push(missingMigration(prisma, say('prisma'), say));
    }
    for (const f of files.filter((x) => /(^|\/)models\.py$/.test(x.path))) {
      const fieldChange = f.hunks.some((h) =>
        h.lines.some((l) => l.kind !== 'context' && /=\s*models\.\w+\(/.test(l.text)),
      );
      if (fieldChange && !migrationAdded(/(^|\/)migrations\/\d+_[\w]+\.py$/))
        out.push(missingMigration(f, say('django'), say));
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

function missingMigration(
  file: ChangedFile,
  kind: string,
  say: ReturnType<typeof messages>,
): FindingInput {
  const line = file.hunks.flatMap((h) => h.lines).find((l) => l.kind === 'add')?.newLine;
  return {
    title: say('title', { kind }),
    certainty: 'likely',
    severity: 'medium',
    category: 'data-integrity',
    location: { path: file.path, line },
    evidence: say('evidence', { path: file.path }),
    explanation: say('explanation'),
    suggestion: say('suggestion'),
  };
}
