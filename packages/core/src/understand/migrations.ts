import type { DataChange, DataOperation } from '../model/context.ts';

interface Pattern {
  re: RegExp;
  operation: DataOperation;
  destructive: boolean;
  table?: number;
  column?: number;
}

const IDENT = '[`"\\[]?([\\w.]+)[`"\\]]?';

const PATTERNS: Pattern[] = [
  // SQL.
  {
    re: new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i'),
    operation: 'create-table',
    destructive: false,
    table: 1,
  },
  {
    re: new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i'),
    operation: 'drop-table',
    destructive: true,
    table: 1,
  },
  {
    re: new RegExp(`\\bALTER\\s+TABLE\\s+${IDENT}\\s+RENAME\\s+TO\\s+${IDENT}`, 'i'),
    operation: 'rename-table',
    destructive: true,
    table: 1,
  },
  {
    re: new RegExp(
      `\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`,
      'i',
    ),
    operation: 'add-column',
    destructive: false,
    table: 1,
    column: 2,
  },
  {
    re: new RegExp(
      `\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?${IDENT}`,
      'i',
    ),
    operation: 'drop-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: new RegExp(
      `\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+RENAME\\s+(?:COLUMN\\s+)?${IDENT}\\s+TO`,
      'i',
    ),
    operation: 'rename-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: new RegExp(
      `\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE`,
      'i',
    ),
    operation: 'alter-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: new RegExp(
      `\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+SET\\s+NOT\\s+NULL`,
      'i',
    ),
    operation: 'alter-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: new RegExp(
      `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s+ON\\s+${IDENT}`,
      'i',
    ),
    operation: 'add-index',
    destructive: false,
    table: 2,
  },
  {
    re: new RegExp(`\\bDROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i'),
    operation: 'drop-index',
    destructive: false,
  },
  {
    re: new RegExp(`\\b(?:DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+${IDENT}`, 'i'),
    operation: 'data',
    destructive: true,
    table: 1,
  },
  {
    re: new RegExp(`\\bUPDATE\\s+${IDENT}\\s+SET\\b`, 'i'),
    operation: 'data',
    destructive: false,
    table: 1,
  },
  // Rails.
  { re: /\bcreate_table\s+:?["']?(\w+)/, operation: 'create-table', destructive: false, table: 1 },
  { re: /\bdrop_table\s+:?["']?(\w+)/, operation: 'drop-table', destructive: true, table: 1 },
  {
    re: /\badd_column\s+:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/,
    operation: 'add-column',
    destructive: false,
    table: 1,
    column: 2,
  },
  {
    re: /\bremove_column\s+:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/,
    operation: 'drop-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: /\brename_column\s+:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/,
    operation: 'rename-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: /\bchange_column\s+:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/,
    operation: 'alter-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  { re: /\badd_index\s+:?["']?(\w+)/, operation: 'add-index', destructive: false, table: 1 },
  // Django.
  {
    re: /migrations\.CreateModel\(\s*name=['"](\w+)['"]/,
    operation: 'create-table',
    destructive: false,
    table: 1,
  },
  {
    re: /migrations\.DeleteModel\(\s*name=['"](\w+)['"]/,
    operation: 'drop-table',
    destructive: true,
    table: 1,
  },
  {
    re: /migrations\.AddField\(\s*model_name=['"](\w+)['"]\s*,\s*name=['"](\w+)['"]/,
    operation: 'add-column',
    destructive: false,
    table: 1,
    column: 2,
  },
  {
    re: /migrations\.RemoveField\(\s*model_name=['"](\w+)['"]\s*,\s*name=['"](\w+)['"]/,
    operation: 'drop-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: /migrations\.RenameField\(\s*model_name=['"](\w+)['"]\s*,\s*old_name=['"](\w+)['"]/,
    operation: 'rename-column',
    destructive: true,
    table: 1,
    column: 2,
  },
  {
    re: /migrations\.AlterField\(\s*model_name=['"](\w+)['"]\s*,\s*name=['"](\w+)['"]/,
    operation: 'alter-column',
    destructive: false,
    table: 1,
    column: 2,
  },
  // Knex / Sequelize.
  {
    re: /\.dropTable(?:IfExists)?\(\s*['"](\w+)['"]/,
    operation: 'drop-table',
    destructive: true,
    table: 1,
  },
  {
    re: /\.createTable\(\s*['"](\w+)['"]/,
    operation: 'create-table',
    destructive: false,
    table: 1,
  },
  { re: /\.dropColumn\(\s*['"](\w+)['"]/, operation: 'drop-column', destructive: true, column: 1 },
  {
    re: /\.renameColumn\(\s*['"](\w+)['"]/,
    operation: 'rename-column',
    destructive: true,
    column: 1,
  },
  {
    re: /\.removeColumn\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]/,
    operation: 'drop-column',
    destructive: true,
    table: 1,
    column: 2,
  },
];

/** Extracts schema/data operations from added migration lines. */
export function extractDataChanges(
  file: string,
  lines: ReadonlyArray<{ text: string; line?: number }>,
): DataChange[] {
  const out: DataChange[] = [];
  for (const { text, line } of lines) {
    if (/^\s*(--|#|\/\/)/.test(text)) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      out.push({
        operation: p.operation,
        table: p.table ? m[p.table] : undefined,
        column: p.column ? m[p.column] : undefined,
        file,
        line,
        destructive: p.destructive,
        statement: text.trim().slice(0, 200),
      });
      break;
    }
  }
  return out;
}

/**
 * Down/rollback sections reverse the "up" operations, so destructive statements inside them are
 * expected. This detects whether a line sits inside such a section.
 */
export function rollbackLineSet(content: string): Set<number> {
  const lines = content.split('\n');
  const out = new Set<number>();
  let inside = false;
  lines.forEach((text, i) => {
    if (
      /(def\s+down\b|exports\.down\b|export\s+(async\s+)?function\s+down\b|async\s+down\s*\(|down\s*\(\s*\)\s*\{|--\s*\+migrate\s+Down|--\s*down\b|def\s+backwards)/i.test(
        text,
      )
    ) {
      inside = true;
    } else if (
      inside &&
      /(def\s+up\b|exports\.up\b|function\s+up\b|async\s+up\s*\(|--\s*\+migrate\s+Up|--\s*up\b)/i.test(
        text,
      )
    ) {
      inside = false;
    }
    if (inside && text.trim()) out.add(i + 1);
  });
  return out;
}
