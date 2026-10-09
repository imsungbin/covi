import type { SymbolChange, SymbolKind } from '../model/context.ts';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
  /** A one-statement declaration (`const LIMIT = 280;`): edits further down are not about it. */
  oneLine?: boolean;
  /**
   * The first line of the comment that sits directly on the declaration, with the blank lines
   * above it: edits there are about this symbol, not the one before.
   */
  start?: number;
}

type Rule = {
  re: RegExp;
  kind: SymbolKind | ((name: string, path: string) => SymbolKind);
  exported?: boolean | ((name: string) => boolean);
};

const IDENT = '[A-Za-z_$][\\w$]*';

function jsKind(name: string, path: string): SymbolKind {
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  if (/^[A-Z]/.test(name) && /\.(tsx|jsx)$/.test(path)) return 'component';
  return 'function';
}

function jsConstKind(name: string, path: string): SymbolKind {
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  if (/^[A-Z][a-z]/.test(name) && /\.(tsx|jsx)$/.test(path)) return 'component';
  return 'constant';
}

const JS_RULES: Rule[] = [
  {
    re: new RegExp(`^export\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})`),
    kind: jsKind,
    exported: true,
  },
  {
    re: new RegExp(`^(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})`),
    kind: jsKind,
    exported: false,
  },
  {
    re: new RegExp(`^export\\s+(?:default\\s+)?(?:abstract\\s+)?class\\s+(${IDENT})`),
    kind: 'class',
    exported: true,
  },
  { re: new RegExp(`^(?:abstract\\s+)?class\\s+(${IDENT})`), kind: 'class', exported: false },
  {
    re: new RegExp(`^export\\s+(?:declare\\s+)?(?:const|let|var)\\s+(${IDENT})`),
    kind: jsConstKind,
    exported: true,
  },
  {
    re: new RegExp(`^(?:const|let|var)\\s+(${IDENT})\\s*(?::[^=]+)?=`),
    kind: jsConstKind,
    exported: false,
  },
  {
    re: new RegExp(`^export\\s+(?:declare\\s+)?interface\\s+(${IDENT})`),
    kind: 'interface',
    exported: true,
  },
  { re: new RegExp(`^interface\\s+(${IDENT})`), kind: 'interface', exported: false },
  { re: new RegExp(`^export\\s+(?:declare\\s+)?type\\s+(${IDENT})`), kind: 'type', exported: true },
  { re: new RegExp(`^type\\s+(${IDENT})\\s*(?:<[^=]*>)?\\s*=`), kind: 'type', exported: false },
  {
    re: new RegExp(`^export\\s+(?:declare\\s+)?(?:const\\s+)?enum\\s+(${IDENT})`),
    kind: 'enum',
    exported: true,
  },
  { re: new RegExp(`^exports\\.(${IDENT})\\s*=`), kind: 'function', exported: true },
  { re: new RegExp(`^module\\.exports\\.(${IDENT})\\s*=`), kind: 'function', exported: true },
];

const PY_RULES: Rule[] = [
  {
    re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    kind: 'function',
    exported: (n) => !n.startsWith('_'),
  },
  { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class', exported: (n) => !n.startsWith('_') },
  { re: /^([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/, kind: 'constant', exported: true },
];

const GO_RULES: Rule[] = [
  {
    re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
    kind: 'function',
    exported: (n) => /^[A-Z]/.test(n),
  },
  {
    re: /^type\s+([A-Za-z_]\w*)\s+interface\b/,
    kind: 'interface',
    exported: (n) => /^[A-Z]/.test(n),
  },
  { re: /^type\s+([A-Za-z_]\w*)\s+struct\b/, kind: 'class', exported: (n) => /^[A-Z]/.test(n) },
  { re: /^type\s+([A-Za-z_]\w*)\s/, kind: 'type', exported: (n) => /^[A-Z]/.test(n) },
  { re: /^(?:const|var)\s+([A-Za-z_]\w*)\s/, kind: 'constant', exported: (n) => /^[A-Z]/.test(n) },
];

const RUST_RULES: Rule[] = [
  {
    re: /^pub(?:\([^)]*\))?\s+(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(\w+)/,
    kind: 'function',
    exported: true,
  },
  { re: /^(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/, kind: 'function', exported: false },
  { re: /^pub(?:\([^)]*\))?\s+struct\s+(\w+)/, kind: 'class', exported: true },
  { re: /^pub(?:\([^)]*\))?\s+enum\s+(\w+)/, kind: 'enum', exported: true },
  { re: /^pub(?:\([^)]*\))?\s+trait\s+(\w+)/, kind: 'interface', exported: true },
  { re: /^pub(?:\([^)]*\))?\s+type\s+(\w+)/, kind: 'type', exported: true },
  { re: /^struct\s+(\w+)/, kind: 'class', exported: false },
  { re: /^enum\s+(\w+)/, kind: 'enum', exported: false },
];

const RUBY_RULES: Rule[] = [
  {
    re: /^\s{0,4}def\s+(?:self\.)?([a-z_]\w*[?!=]?)/,
    kind: 'function',
    exported: (n) => !n.startsWith('_'),
  },
  { re: /^\s{0,2}class\s+([A-Z]\w*(?:::\w+)*)/, kind: 'class', exported: true },
  { re: /^\s{0,2}module\s+([A-Z]\w*(?:::\w+)*)/, kind: 'class', exported: true },
];

const JVM_RULES: Rule[] = [
  {
    re: /^(?:public\s+|internal\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|data\s+|sealed\s+|open\s+|static\s+|enum\s+(?=class))*(?:class|interface|enum|object|record)\s+(\w+)/,
    kind: 'class',
    exported: true,
  },
  {
    re: /^(?:public\s+|internal\s+)?(?:suspend\s+)?fun\s+(?:<[^>]+>\s*)?(\w+)/,
    kind: 'function',
    exported: true,
  },
];

const RULES: Record<string, Rule[]> = {
  typescript: JS_RULES,
  javascript: JS_RULES,
  python: PY_RULES,
  go: GO_RULES,
  rust: RUST_RULES,
  ruby: RUBY_RULES,
  java: JVM_RULES,
  kotlin: JVM_RULES,
};

const ROUTE_RULES: Array<{ re: RegExp; method?: number; path: number }> = [
  // Express, Fastify, Hono, Koa routers.
  {
    re: /\b(?:app|router|server|api|route|routes|fastify|r)\.(get|post|put|patch|delete|all|options|head)\(\s*['"`]([^'"`]+)['"`]/i,
    method: 1,
    path: 2,
  },
  // Plain Node http handlers: `req.url === '/x'`, `pathname === '/x'`.
  { re: /(?:req\.url|url\.pathname|pathname)\s*===?\s*['"`](\/[^'"`]*)['"`]/, path: 1 },
  { re: /(?:req\.url|url\.pathname|pathname)\.startsWith\(\s*['"`](\/[^'"`]*)['"`]/, path: 1 },
  // Flask, FastAPI.
  {
    re: /@(?:app|router|bp|blueprint|api)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/,
    method: 1,
    path: 2,
  },
  // Go net/http, chi, gin, echo.
  {
    re: /\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/,
    method: 1,
    path: 2,
  },
  // Spring.
  {
    re: /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]+)"/,
    method: 1,
    path: 2,
  },
  // Rails.
  { re: /^\s*(get|post|put|patch|delete)\s+['"](\/?[^'"]+)['"]/, method: 1, path: 2 },
  // Axum, actix.
  { re: /\.route\(\s*"(\/[^"]*)"/, path: 1 },
  { re: /#\[(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/, method: 1, path: 2 },
];

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']);

function normalizeMethod(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase().replace(/MAPPING$/, '');
  if (upper === 'HANDLEFUNC' || upper === 'HANDLE' || upper === 'ROUTE' || upper === 'REQUEST')
    return undefined;
  return HTTP_METHODS.has(upper) ? upper : undefined;
}

/** Route key used as the symbol name: `GET /api/users` or just `/api/users`. */
export function routeName(method: string | undefined, path: string): string {
  return method ? `${method} ${path}` : path;
}

export function extractRoutes(content: string, filePath: string): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  const seen = new Set<string>();
  const nextRoute = /(^|\/)app\/(.*)\/route\.[cm]?[jt]s$/.exec(filePath);
  const lines = content.split('\n');
  lines.forEach((text, index) => {
    if (nextRoute) {
      const m = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(
        text,
      );
      if (m) {
        const routePath = `/${nextRoute[2]!.replace(/\([^)]*\)\/?/g, '')}`.replace(/\/+/g, '/');
        const name = routeName(m[1], routePath);
        if (!seen.has(name)) out.push({ name, kind: 'route', line: index + 1, exported: true });
        seen.add(name);
      }
    }
    for (const rule of ROUTE_RULES) {
      const m = rule.re.exec(text);
      if (!m) continue;
      let method = normalizeMethod(rule.method ? m[rule.method] : undefined);
      // Plain handlers often check the method on the same line: `req.method === 'POST' && ...`.
      if (!method) method = normalizeMethod(/method\s*===?\s*['"`](\w+)['"`]/.exec(text)?.[1]);
      const path = m[rule.path]!;
      if (!path.startsWith('/') && !/^[a-z]/i.test(path)) continue;
      const name = routeName(method, path.startsWith('/') ? path : `/${path}`);
      if (!seen.has(name)) out.push({ name, kind: 'route', line: index + 1, exported: true });
      seen.add(name);
      break;
    }
  });
  return out;
}

function extractCssSelectors(content: string): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  content.split('\n').forEach((text, index) => {
    const m = /^\s*([^{}@/][^{}]*?)\s*\{\s*(?:\/\*.*\*\/\s*)?$/.exec(text);
    if (!m) return;
    for (const selector of m[1]!.split(',')) {
      const s = selector.trim();
      if (s && s.length <= 80 && !/^(from|to|\d+%)$/.test(s))
        out.push({ name: s, kind: 'selector', line: index + 1, exported: false });
    }
  });
  return out;
}

/** How a language writes comments: its line-comment marker, and whether it has `/* … *\/` blocks. */
const COMMENTS: Record<string, { line?: string; block: boolean }> = {
  typescript: { line: '//', block: true },
  javascript: { line: '//', block: true },
  go: { line: '//', block: true },
  rust: { line: '//', block: true },
  java: { line: '//', block: true },
  kotlin: { line: '//', block: true },
  python: { line: '#', block: false },
  ruby: { line: '#', block: false },
  css: { block: true },
  scss: { line: '//', block: true },
  sass: { line: '//', block: true },
  less: { line: '//', block: true },
};

function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

/**
 * The line a `/* … *\/` comment that ends on line `close` opens on, or 0 when it shares a line
 * with code or opens no lower than `floor`.
 */
function blockOpener(lines: readonly string[], close: number, floor: number): number {
  const last = lines[close - 1]!.trim();
  if (last.startsWith('/*')) return close;
  // `x(); /* note */` is code with a comment; ` * reads src/**\/*.ts */` is still the comment.
  if (last.includes('/*') && !last.startsWith('*')) return 0;
  for (let i = close - 1; i > floor; i--) {
    const text = lines[i - 1]!.trim();
    if (text.startsWith('/*')) return i;
    if (text.includes('*/')) return 0;
  }
  return 0;
}

/**
 * Where the comment directly above a declaration begins, with the blank lines above it, or
 * undefined when there is none. A comment indented deeper than the declaration ends the body above
 * it (a Python function's last line), and none reaches back past `floor`, the previous symbol.
 */
function leadingStart(
  lines: readonly string[],
  line: number,
  floor: number,
  style: { line?: string; block: boolean },
): number | undefined {
  const indent = indentOf(lines[line - 1] ?? '');
  let top = line;
  while (top - 1 > floor) {
    const above = top - 1;
    const text = lines[above - 1]!.trim();
    let open = 0;
    if (style.line && text.startsWith(style.line)) open = above;
    else if (style.block && text.endsWith('*/')) open = blockOpener(lines, above, floor);
    if (open <= floor || indentOf(lines[open - 1]!) > indent) break;
    top = open;
  }
  if (top === line) return undefined;
  while (top - 1 > floor && lines[top - 2]!.trim() === '') top--;
  return top;
}

function withLeadingComments(
  symbols: ExtractedSymbol[],
  content: string,
  language: string,
): ExtractedSymbol[] {
  const style = COMMENTS[language];
  if (!style) return symbols;
  const lines = content.split('\n');
  const taken = [...new Set(symbols.map((s) => s.line))].sort((a, b) => a - b);
  const floor = new Map(taken.map((line, i) => [line, taken[i - 1] ?? 0]));
  for (const symbol of symbols) {
    const start = leadingStart(lines, symbol.line, floor.get(symbol.line)!, style);
    if (start !== undefined) symbol.start = start;
  }
  return symbols;
}

export function extractSymbols(
  content: string,
  language: string | undefined,
  path: string,
): ExtractedSymbol[] {
  if (!language) return [];
  if (['css', 'scss', 'sass', 'less'].includes(language))
    return withLeadingComments(extractCssSelectors(content), content, language);
  if (language === 'vue' || language === 'svelte' || language === 'astro') {
    const name = (path.split('/').pop() ?? path).replace(/\.\w+$/, '');
    return [{ name, kind: 'component', line: 1, exported: true }];
  }
  const rules = RULES[language];
  const out: ExtractedSymbol[] = [];
  if (rules) {
    const exportedNames = new Set<string>();
    const lines = content.split('\n');
    lines.forEach((text, index) => {
      if (language === 'typescript' || language === 'javascript') {
        const reexport = /^export\s*\{([^}]*)\}/.exec(text);
        if (reexport) {
          for (const part of reexport[1]!.split(',')) {
            const alias = part
              .trim()
              .split(/\s+as\s+/)
              .pop()
              ?.trim();
            if (alias) exportedNames.add(alias);
          }
          return;
        }
        const defaultExport = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(text);
        if (defaultExport) {
          exportedNames.add(defaultExport[1]!);
          return;
        }
        const cjs = /^module\.exports\s*=\s*\{([^}]*)\}/.exec(text);
        if (cjs) {
          for (const part of cjs[1]!.split(',')) {
            const name = part.split(':')[0]?.trim();
            if (name) exportedNames.add(name);
          }
          return;
        }
      }
      for (const rule of rules) {
        const m = rule.re.exec(text);
        if (!m) continue;
        const name = m[1]!;
        const kind = typeof rule.kind === 'function' ? rule.kind(name, path) : rule.kind;
        const exported =
          typeof rule.exported === 'function' ? rule.exported(name) : (rule.exported ?? false);
        const oneLine =
          (kind === 'constant' || kind === 'variable') &&
          !/(=>|\bfunction\b|[{([,=]\s*)$/.test(text.trim());
        out.push({ name, kind, line: index + 1, exported, ...(oneLine ? { oneLine } : {}) });
        break;
      }
    });
    for (const symbol of out) if (exportedNames.has(symbol.name)) symbol.exported = true;
  }
  return withLeadingComments([...out, ...extractRoutes(content, path)], content, language);
}

function rangeMap(
  symbols: readonly ExtractedSymbol[],
  totalLines: number,
): Map<ExtractedSymbol, [number, number]> {
  const map = new Map<ExtractedSymbol, [number, number]>();
  const declarations = [...symbols]
    .filter((s) => s.kind !== 'route')
    .sort((a, b) => a.line - b.line);
  // A symbol ends where the next one's leading comment begins: that comment documents the next one.
  declarations.forEach((s, i) => {
    const next = declarations[i + 1];
    const end = s.oneLine
      ? s.line
      : next
        ? Math.max(s.line, (next.start ?? next.line) - 1)
        : totalLines;
    map.set(s, [s.start ?? s.line, end]);
  });
  // A route's handler follows its definition: it spans until the next route or the end of the
  // enclosing declaration, so edits inside the handler count as changes to the route.
  const routes = [...symbols].filter((s) => s.kind === 'route').sort((a, b) => a.line - b.line);
  routes.forEach((route, i) => {
    const enclosing = declarations.filter((d) => d.line <= route.line).at(-1);
    const enclosingEnd = enclosing ? map.get(enclosing)![1] : totalLines;
    const nextRoute = routes[i + 1];
    const end = Math.min(
      enclosingEnd,
      nextRoute ? (nextRoute.start ?? nextRoute.line) - 1 : totalLines,
    );
    map.set(route, [route.start ?? route.line, Math.max(route.line, end)]);
  });
  return map;
}

const KIND_GROUP: Record<SymbolKind, string> = {
  function: 'callable',
  component: 'callable',
  hook: 'callable',
  class: 'type',
  interface: 'type',
  type: 'type',
  enum: 'type',
  constant: 'callable',
  variable: 'callable',
  route: 'route',
  selector: 'selector',
  test: 'test',
};

function keyOf(s: ExtractedSymbol): string {
  return `${KIND_GROUP[s.kind]}:${s.name}`;
}

export interface SymbolDiffInput {
  path: string;
  base?: { symbols: ExtractedSymbol[]; lines: number; changed: Set<number> };
  head?: { symbols: ExtractedSymbol[]; lines: number; changed: Set<number> };
}

/** Compares symbol sets of two file versions; "modified" means changed lines fall inside the symbol. */
export function diffSymbols(input: SymbolDiffInput): SymbolChange[] {
  const out: SymbolChange[] = [];
  const base = new Map((input.base?.symbols ?? []).map((s) => [keyOf(s), s]));
  const head = new Map((input.head?.symbols ?? []).map((s) => [keyOf(s), s]));
  const headRanges = input.head ? rangeMap(input.head.symbols, input.head.lines) : new Map();
  const baseRanges = input.base ? rangeMap(input.base.symbols, input.base.lines) : new Map();

  for (const [key, s] of head) {
    const before = base.get(key);
    if (!before) {
      out.push({
        name: s.name,
        kind: s.kind,
        change: 'added',
        path: input.path,
        line: s.line,
        exported: s.exported,
      });
      continue;
    }
    const [from, to] = headRanges.get(s) ?? [s.line, s.line];
    const [bFrom, bTo] = baseRanges.get(before) ?? [before.line, before.line];
    const touched =
      [...(input.head?.changed ?? [])].some((l) => l >= from && l <= to) ||
      [...(input.base?.changed ?? [])].some((l) => l >= bFrom && l <= bTo);
    if (touched) {
      out.push({
        name: s.name,
        kind: s.kind,
        change: 'modified',
        path: input.path,
        line: s.line,
        exported: s.exported || before.exported,
      });
    }
  }
  for (const [key, s] of base) {
    if (!head.has(key)) {
      out.push({
        name: s.name,
        kind: s.kind,
        change: 'removed',
        path: input.path,
        line: s.line,
        exported: s.exported,
      });
    }
  }
  return out;
}

/** Counts test cases declared in a set of lines (used for added vs removed test cases). */
export function countTestCases(lines: readonly string[]): number {
  let count = 0;
  for (const text of lines) {
    if (
      /^\s*(it|test|specify)(\.(only|skip|todo|concurrent|each\([^)]*\)))?\s*\(\s*['"`]/.test(
        text,
      ) ||
      /^\s*(async\s+)?def\s+test_\w+/.test(text) ||
      /^func\s+Test\w+\s*\(/.test(text) ||
      /^\s*(it|specify|scenario)\s+['"]/.test(text) ||
      /^\s*@Test\b/.test(text) ||
      /^\s*#\[test\]/.test(text)
    ) {
      count++;
    }
  }
  return count;
}
