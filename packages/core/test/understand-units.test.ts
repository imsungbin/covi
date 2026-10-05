import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../src/model/change.ts';
import { areaKey } from '../src/understand/areas.ts';
import { classifyFile } from '../src/understand/classify.ts';
import { pagePathFor } from '../src/understand/demonstration.ts';
import { diffManifest } from '../src/understand/dependencies.ts';
import { extractEnvVars } from '../src/understand/env-vars.ts';
import { cleanSubject, inferIntent } from '../src/understand/intent.ts';
import { extractDataChanges, rollbackLineSet } from '../src/understand/migrations.ts';
import {
  countTestCases,
  diffSymbols,
  extractRoutes,
  extractSymbols,
} from '../src/understand/symbols.ts';

describe('classifyFile', () => {
  it.each([
    ['src/components/CommentList.tsx', 'source', ['ui']],
    ['app/api/users/route.ts', 'source', ['api']],
    ['styles/main.css', 'style', ['ui']],
    ['bin/cli.js', 'source', ['cli']],
    ['src/store/cart.ts', 'source', ['state']],
    ['src/auth/session.ts', 'source', ['security']],
    ['db/migrate/20260101_add_users.rb', 'migration', ['data']],
    ['prisma/schema.prisma', 'schema', ['data']],
    ['.github/workflows/ci.yml', 'ci', ['ci']],
    ['package-lock.json', 'lockfile', ['dependency']],
    ['package.json', 'manifest', ['dependency']],
    ['src/cart.test.ts', 'test', ['test']],
    ['tests/test_cart.py', 'test', ['test']],
    ['README.md', 'docs', ['docs']],
    ['Dockerfile', 'infra', ['build']],
    ['vite.config.ts', 'build', ['build']],
    ['public/logo.png', 'asset', []],
  ])('%s → %s', (path, category, surfaces) => {
    const c = classifyFile(path);
    expect(c.category).toBe(category);
    for (const s of surfaces) expect(c.surfaces).toContain(s);
  });
});

describe('symbols', () => {
  it('extracts exported and local TypeScript symbols with kinds', () => {
    const src = [
      'export function formatPrice(n: number) {}',
      'export const useCart = () => {};',
      'export default function CommentList() {}',
      'function helper() {}',
      'export interface Cart {}',
      'export type Id = string;',
      'export class Store {}',
      'const local = 1;',
      'export { helper as publicHelper };',
    ].join('\n');
    const symbols = extractSymbols(src, 'typescript', 'src/CommentList.tsx');
    expect(symbols.map((s) => `${s.name}:${s.kind}:${s.exported}`)).toEqual([
      'formatPrice:function:true',
      'useCart:hook:true',
      'CommentList:component:true',
      'helper:function:false',
      'Cart:interface:true',
      'Id:type:true',
      'Store:class:true',
      'local:constant:false',
    ]);
  });

  it('extracts routes from common frameworks', () => {
    expect(
      extractRoutes('app.get(\'/api/users\', handler);\nrouter.post("/login", h)', 'server.js').map(
        (r) => r.name,
      ),
    ).toEqual(['GET /api/users', 'POST /login']);
    expect(
      extractRoutes(
        "if (req.method === 'GET' && url.pathname === '/api/items') {",
        'server.js',
      ).map((r) => r.name),
    ).toEqual(['GET /api/items']);
    expect(
      extractRoutes('@app.get("/health")\ndef health(): ...', 'main.py').map((r) => r.name),
    ).toEqual(['GET /health']);
    expect(
      extractRoutes('export async function GET() {}', 'app/api/users/[id]/route.ts').map(
        (r) => r.name,
      ),
    ).toEqual(['GET /api/users/[id]']);
  });

  it('extracts Python, Go, and CSS symbols', () => {
    expect(
      extractSymbols(
        'def total(items):\n    pass\nclass Cart:\n    pass\n_PRIVATE = 1\nMAX_ITEMS = 3',
        'python',
        'cart.py',
      ).map((s) => `${s.name}:${s.exported}`),
    ).toEqual(['total:true', 'Cart:true', 'MAX_ITEMS:true']);
    expect(
      extractSymbols(
        'func Total() int {}\nfunc (c *Cart) add() {}\ntype Cart struct {}',
        'go',
        'cart.go',
      ).map((s) => `${s.name}:${s.kind}:${s.exported}`),
    ).toEqual(['Total:function:true', 'add:function:false', 'Cart:class:true']);
    expect(
      extractSymbols('.card {\n  color: red;\n}\n.card__title, .badge {\n}', 'css', 'a.css').map(
        (s) => s.name,
      ),
    ).toEqual(['.card', '.card__title', '.badge']);
  });

  it('diffs symbols into added, removed, and modified', () => {
    const base = extractSymbols(
      'export function a() {\n  return 1;\n}\nexport function b() {}\n',
      'typescript',
      'x.ts',
    );
    const head = extractSymbols(
      'export function a() {\n  return 2;\n}\nexport function c() {}\n',
      'typescript',
      'x.ts',
    );
    const changes = diffSymbols({
      path: 'x.ts',
      base: { symbols: base, lines: 5, changed: new Set([2]) },
      head: { symbols: head, lines: 5, changed: new Set([2]) },
    });
    expect(changes.map((c) => `${c.name}:${c.change}`).sort()).toEqual([
      'a:modified',
      'b:removed',
      'c:added',
    ]);
  });

  it('counts test cases', () => {
    expect(
      countTestCases([
        "it('works', () => {",
        "  test.each([1])('x %s', () => {",
        'def test_total():',
        'func TestTotal(t *testing.T) {',
        'const x = 1;',
      ]),
    ).toBe(4);
  });
});

describe('dependencies', () => {
  it('detects added, removed, and major upgrades in package.json', () => {
    const before = JSON.stringify({
      dependencies: { react: '^18.2.0', lodash: '4.17.21' },
      devDependencies: { vitest: '^1.0.0' },
    });
    const after = JSON.stringify({
      dependencies: { react: '^19.0.0', zod: '^4.0.0' },
      devDependencies: { vitest: '^1.2.0' },
    });
    const changes = diffManifest('package.json', before, after);
    expect(changes.map((c) => `${c.name}:${c.change}:${c.major}:${c.dev}`)).toEqual([
      'lodash:removed:false:false',
      'react:upgraded:true:false',
      'vitest:upgraded:false:true',
      'zod:added:false:false',
    ]);
  });

  it('parses requirements.txt and go.mod', () => {
    expect(
      diffManifest('requirements.txt', 'flask==2.0\n', 'flask==3.0\nrequests>=2\n').map(
        (c) => `${c.name}:${c.change}:${c.major}`,
      ),
    ).toEqual(['flask:upgraded:true', 'requests:added:false']);
    expect(
      diffManifest(
        'go.mod',
        'require github.com/a/b v1.2.0\n',
        'require github.com/a/b v1.3.0\n',
      )[0],
    ).toMatchObject({ change: 'upgraded', major: false });
  });
});

describe('env vars and migrations', () => {
  it('finds env var reads across languages, skipping universal ones', () => {
    expect(
      extractEnvVars(
        'const k = process.env.STRIPE_KEY ?? process.env.NODE_ENV; os.getenv("FOO_BAR"); ENV["RAILS_X"]',
      ).sort(),
    ).toEqual(['FOO_BAR', 'RAILS_X', 'STRIPE_KEY']);
  });

  it('extracts destructive and additive data operations', () => {
    const ops = extractDataChanges('db/001.sql', [
      { text: 'ALTER TABLE users DROP COLUMN legacy_id;', line: 1 },
      { text: 'ALTER TABLE users ADD COLUMN archived_at timestamptz;', line: 2 },
      { text: '-- DROP TABLE comments; (commented out)', line: 3 },
      { text: 'remove_column :orders, :coupon', line: 4 },
      { text: "migrations.AddField(model_name='post', name='slug')", line: 5 },
    ]);
    expect(
      ops.map((o) => `${o.operation}:${o.table ?? ''}:${o.column ?? ''}:${o.destructive}`),
    ).toEqual([
      'drop-column:users:legacy_id:true',
      'add-column:users:archived_at:false',
      'drop-column:orders:coupon:true',
      'add-column:post:slug:false',
    ]);
  });

  it('recognizes down/rollback sections', () => {
    const lines = rollbackLineSet(
      'exports.up = (knex) => knex.schema.createTable("a");\nexports.down = (knex) =>\n  knex.schema.dropTable("a");\n',
    );
    expect([...lines]).toEqual([2, 3]);
  });
});

describe('intent', () => {
  const file = (
    path: string,
    category: ChangedFile['category'],
    surfaces: ChangedFile['surfaces'] = [],
  ): ChangedFile => ({
    path,
    status: 'modified',
    binary: false,
    additions: 5,
    deletions: 2,
    hunks: [],
    category,
    surfaces,
    ignored: false,
  });
  const base = { symbols: [], routes: [], hasDataChanges: false };

  it('reads conventional commits, titles, and branch names', () => {
    const intent = inferIntent({
      ...base,
      change: {
        commits: [
          {
            sha: '1',
            subject: 'fix(cart): prevent negative quantities',
            body: '',
            author: 'a',
            date: '',
          },
        ],
        metadata: { sourceBranch: 'fix/cart-qty' },
        includesUncommitted: false,
      },
      files: [file('src/cart.ts', 'source')],
    });
    expect(intent).toMatchObject({
      kind: 'bug-fix',
      confidence: 'high',
      summary: 'Prevent negative quantities',
    });
    expect(cleanSubject('feat(api)!: drop v1 (#123)')).toEqual({
      text: 'drop v1',
      type: 'feat',
      scope: 'api',
      breaking: true,
    });
  });

  it('infers from files alone and says so', () => {
    const intent = inferIntent({
      ...base,
      change: { commits: [], metadata: {}, includesUncommitted: true },
      files: [file('docs/a.md', 'docs'), file('README.md', 'docs')],
    });
    expect(intent.kind).toBe('docs');
    expect(intent.ambiguity).toMatch(/Uncommitted work has no commit message/);
  });

  it('names the areas with the most change when nothing describes it', () => {
    const big = (path: string) => ({ ...file(path, 'source'), additions: 400 });
    const intent = inferIntent({
      ...base,
      change: { commits: [], metadata: {}, includesUncommitted: true },
      files: [file('.config/a.json', 'config'), big('packages/core/x.ts'), big('src/app/y.ts')],
    });
    expect(intent.summary).toMatch(
      / in (packages\/core|src\/app), (packages\/core|src\/app), \.config$/,
    );
  });

  it('flags a refactor that changes API routes', () => {
    const intent = inferIntent({
      ...base,
      routes: [{ path: '/api/users', change: 'removed', file: 'server.js' }],
      change: {
        commits: [{ sha: '1', subject: 'refactor: tidy server', body: '', author: 'a', date: '' }],
        metadata: {},
        includesUncommitted: false,
      },
      files: [file('server.js', 'source', ['api'])],
    });
    expect(intent.kind).toBe('refactor');
    expect(intent.ambiguity).toMatch(/^Described as refactor, but it also changes API routes/);
  });

  it('reports mixed intent when signals conflict', () => {
    const intent = inferIntent({
      ...base,
      change: {
        commits: [
          { sha: '1', subject: 'feat: add export button', body: '', author: 'a', date: '' },
          { sha: '2', subject: 'fix: crash on empty cart', body: '', author: 'a', date: '' },
        ],
        metadata: {},
        includesUncommitted: false,
      },
      files: [file('src/a.ts', 'source')],
    });
    expect(intent.kind).toBe('mixed');
    expect(intent.ambiguity).toMatch(/both/);
  });
});

describe('areas and pages', () => {
  it('groups paths into meaningful areas', () => {
    expect(areaKey('src/components/comments/List.tsx')).toBe('components/comments');
    expect(areaKey('packages/core/src/git/diff.ts')).toBe('core/git');
    expect(areaKey('server.js')).toBe('(root)');
    expect(areaKey('.github/workflows/ci.yml')).toBe('.github');
  });

  it('maps changed files to the pages that render them', () => {
    expect(pagePathFor('public/pricing.html', 'public')).toBe('/pricing.html');
    expect(pagePathFor('index.html', '.')).toBe('/');
    expect(pagePathFor('app/settings/page.tsx')).toBe('/settings');
    expect(pagePathFor('src/pages/about.tsx')).toBe('/about');
    expect(pagePathFor('src/pages/api/x.ts')).toBeUndefined();
  });
});

describe('groupAreas', () => {
  it('stays bounded and terminates when changes span many top-level directories', async () => {
    const { groupAreas } = await import('../src/understand/areas.ts');
    const file = (path: string, lines: number) =>
      ({
        path,
        status: 'added',
        binary: false,
        additions: lines,
        deletions: 0,
        hunks: [],
        category: 'source',
        surfaces: [],
        ignored: false,
      }) as ChangedFile;
    // Twenty single-file top-level directories plus a few nested ones: the catch-all "other"
    // becomes the smallest group, which used to loop forever.
    const files = [
      ...Array.from({ length: 20 }, (_, i) => file(`dir${i}/a.ts`, 1)),
      file('pkg/core/x.ts', 500),
      file('pkg/cli/y.ts', 400),
    ];
    const areas = groupAreas(files, 8);
    expect(areas.length).toBeLessThanOrEqual(8);
    expect(areas.flatMap((a) => a.files).sort()).toEqual(files.map((f) => f.path).sort());
  });

  it('names the root, GitHub, and catch-all areas in the run language', async () => {
    const { groupAreas } = await import('../src/understand/areas.ts');
    const file = (path: string) =>
      ({
        path,
        status: 'modified',
        binary: false,
        additions: 1,
        deletions: 0,
        hunks: [],
        category: 'config',
        surfaces: [],
        ignored: false,
      }) as ChangedFile;
    const files = [file('package.json'), file('README.md'), file('.github/workflows/ci.yml')];
    const names = (language: 'en' | 'ko' | 'ja' | 'zh') =>
      groupAreas(files, 8, language)
        .map((a) => a.name)
        .sort();
    expect(names('en')).toEqual(['GitHub configuration', 'project root']);
    expect(names('ko')).toEqual(['GitHub 설정', '프로젝트 루트']);
    expect(names('ja')).toEqual(['GitHub の設定', 'プロジェクトのルート']);
    expect(names('zh')).toEqual(['GitHub 配置', '项目根目录']);
  });
});
