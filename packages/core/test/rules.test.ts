import { afterEach, describe, expect, it } from 'vitest';
import { type Analysis, analyze } from '../../../tests/helpers/analyze.ts';

let a: Analysis | undefined;
afterEach(() => a?.repo.cleanup());

async function run(
  base: Record<string, string | null>,
  head: Record<string, string | null>,
  message = 'Change',
) {
  a = await analyze(base, head, { message });
  return a;
}

describe('review rules: hygiene and security', () => {
  it('flags committed credentials with masked evidence, ignores placeholders', async () => {
    const token = `ghp_${'R'.repeat(36)}`;
    const r = await run(
      { 'a.ts': 'x\n' },
      {
        'config.ts': `export const token = "${token}";\nexport const sample = "AKIA${'X'.repeat(16)}";\n`,
      },
    );
    const f = r.findings.find((x) => x.source.id === 'secret-in-diff')!;
    expect(f).toMatchObject({
      certainty: 'confirmed',
      severity: 'high',
      location: { path: 'config.ts', line: 1 },
    });
    expect(f.evidence).not.toContain(token);
    expect(r.findings.filter((x) => x.source.id === 'secret-in-diff')).toHaveLength(1);
  });

  it('flags merge conflict markers but not Markdown underlines', async () => {
    const r = await run(
      { 'a.ts': 'x\n', 'doc.md': 'x\n' },
      {
        'a.ts': '<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> main\n',
        'doc.md': 'Title\n=======\n',
      },
    );
    expect(
      r.findings
        .filter((x) => x.source.id === 'merge-conflict-markers')
        .map((x) => x.location?.path),
    ).toEqual(['a.ts']);
  });

  it('flags focused tests as confirmed and skipped tests as risks', async () => {
    const r = await run(
      { 'src/a.test.ts': "it('a', () => {});\n" },
      { 'src/a.test.ts': "it.only('a', () => {});\nit.skip('b', () => {});\n" },
    );
    expect(r.findings.find((x) => x.source.id === 'focused-test')).toMatchObject({
      certainty: 'confirmed',
    });
    expect(r.findings.find((x) => x.source.id === 'skipped-test')).toMatchObject({
      certainty: 'risk',
      severity: 'low',
    });
  });

  it('flags SQL built by interpolation, not parameterized queries', async () => {
    const r = await run(
      { 'src/db.ts': 'x\n' },
      {
        'src/db.ts':
          'export const q1 = (id: string) => db.query(`SELECT * FROM users WHERE id = ${id}`);\nexport const q2 = (id: string) => db.query("SELECT * FROM users WHERE id = $1", [id]);\n',
      },
    );
    const sql = r.findings.filter((x) => x.source.id === 'sql-string-building');
    expect(sql).toHaveLength(1);
    expect(sql[0]!.location?.line).toBe(1);
  });

  it('flags unsanitized HTML unless a sanitizer is used', async () => {
    const r = await run(
      { 'src/view.js': 'x\n', 'src/safe.js': 'x\n' },
      {
        'src/view.js': 'el.innerHTML = comment.body;\nel.innerHTML = "";\n',
        'src/safe.js':
          'import DOMPurify from "dompurify";\nel.innerHTML = DOMPurify.sanitize(comment.body);\n',
      },
    );
    expect(
      r.findings
        .filter((x) => x.source.id === 'dangerous-html')
        .map((x) => `${x.location?.path}:${x.location?.line}`),
    ).toEqual(['src/view.js:1']);
  });

  it('flags GitHub Actions script injection only inside run blocks', async () => {
    const workflow = [
      'on: pull_request',
      'jobs:',
      '  greet:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: Safe input',
      '        uses: actions/github-script@v7',
      '        with:',
      '          title: ${{ github.event.pull_request.title }}',
      '      - run: |',
      '          echo "Title: ${{ github.event.pull_request.title }}"',
      '',
    ].join('\n');
    const r = await run({ 'README.md': 'x\n' }, { '.github/workflows/greet.yml': workflow });
    const hits = r.findings.filter((x) => x.source.id === 'workflow-script-injection');
    expect(hits.map((x) => x.location?.line)).toEqual([11]);
  });

  it('flags pull_request_target workflows that check out the PR head', async () => {
    const workflow =
      'on: pull_request_target\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - run: npm test\n';
    const r = await run({ 'README.md': 'x\n' }, { '.github/workflows/t.yml': workflow });
    expect(r.findings.find((x) => x.source.id === 'workflow-pull-request-target')).toMatchObject({
      certainty: 'likely',
      severity: 'high',
      location: { line: 8 },
    });
  });
});

describe('review rules: correctness and compatibility', () => {
  it('flags removed exports that other files still import', async () => {
    const r = await run(
      {
        'src/price.ts': 'export function formatPrice(n: number) {\n  return `$${n}`;\n}\n',
        'src/cart.ts':
          "import { formatPrice } from './price';\nexport const label = formatPrice(1);\n",
      },
      { 'src/price.ts': 'export function formatAmount(n: number) {\n  return `$${n}`;\n}\n' },
    );
    const f = r.findings.find((x) => x.source.id === 'removed-export-still-referenced')!;
    expect(f).toMatchObject({ certainty: 'likely', category: 'api-compatibility' });
    expect(f.evidence).toContain('src/cart.ts:1');
  });

  it('does not flag a symbol that moved to another file', async () => {
    const r = await run(
      {
        'src/a.ts': 'export function shared() {}\n',
        'src/use.ts': "import { shared } from './a';\nshared();\n",
      },
      {
        'src/a.ts': 'export const other = 1;\n',
        'src/b.ts': 'export function shared() {}\n',
        'src/use.ts': "import { shared } from './b';\nshared();\n",
      },
    );
    expect(r.ruleIds).not.toContain('removed-export-still-referenced');
  });

  it('flags async forEach and swallowed errors', async () => {
    const r = await run(
      { 'src/sync.ts': 'x\n' },
      {
        'src/sync.ts':
          'items.forEach(async (i) => {\n  await save(i);\n});\ntry {\n  run();\n} catch (e) {}\nfetchData().catch(() => {});\n',
      },
    );
    expect(r.ruleIds).toContain('async-foreach');
    expect(r.findings.filter((x) => x.source.id === 'empty-catch')).toHaveLength(2);
  });

  it('flags removed routes and destructive migrations', async () => {
    const r = await run(
      { 'server.js': "app.get('/api/users', list);\napp.get('/api/teams', teams);\n" },
      {
        'server.js': "app.get('/api/users', list);\n",
        'migrations/002_drop.sql': 'ALTER TABLE teams DROP COLUMN legacy;\n',
      },
    );
    expect(r.findings.find((x) => x.source.id === 'route-removed')?.title).toBe(
      'API route GET /api/teams removed',
    );
    expect(r.findings.find((x) => x.source.id === 'destructive-migration')).toMatchObject({
      certainty: 'risk',
      severity: 'high',
      category: 'data-integrity',
    });
  });

  it('flags package.json dependency changes without a lockfile update', async () => {
    const pkg = (deps: object) => `${JSON.stringify({ name: 'x', dependencies: deps }, null, 2)}\n`;
    const r = await run(
      { 'package.json': pkg({ a: '1.0.0' }), 'package-lock.json': '{}\n' },
      { 'package.json': pkg({ a: '1.0.0', zod: '^4.0.0' }) },
    );
    expect(r.findings.find((x) => x.source.id === 'lockfile-out-of-sync')).toMatchObject({
      certainty: 'likely',
      category: 'dependency',
    });
    const ok = await analyze(
      { 'package.json': pkg({ a: '1.0.0' }), 'package-lock.json': '{}\n' },
      { 'package.json': pkg({ a: '1.0.0', zod: '^4.0.0' }), 'package-lock.json': '{"v":2}\n' },
    );
    expect(ok.ruleIds).not.toContain('lockfile-out-of-sync');
    ok.repo.cleanup();
  });

  it('flags a bug fix without a regression test when the repo has tests', async () => {
    const r = await run(
      {
        'src/cart.ts': 'export const qty = (n: number) => n;\n',
        'test/other.test.ts': "it('x', () => {});\n",
      },
      { 'src/cart.ts': 'export const qty = (n: number) => Math.max(0, n);\n' },
      'fix: prevent negative quantities',
    );
    expect(r.findings.find((x) => x.source.id === 'missing-tests')).toMatchObject({
      title: 'Bug fix without a regression test',
      severity: 'medium',
    });
  });

  it('flags undocumented env vars only when the repo keeps an env example', async () => {
    const r = await run(
      { '.env.example': 'PORT=3000\n', 'src/a.ts': 'x\n' },
      { 'src/a.ts': 'export const key = process.env.PAYMENTS_KEY;\n' },
    );
    expect(r.findings.find((x) => x.source.id === 'env-var-undocumented')?.evidence).toContain(
      'PAYMENTS_KEY',
    );
    const none = await analyze(
      { 'src/a.ts': 'x\n' },
      { 'src/a.ts': 'export const key = process.env.PAYMENTS_KEY;\n' },
    );
    expect(none.ruleIds).not.toContain('env-var-undocumented');
    none.repo.cleanup();
  });
});

describe('review rules: accessibility', () => {
  it('flags images without alt, clickable divs, and removed focus outlines', async () => {
    const r = await run(
      { 'src/Card.tsx': 'x\n', 'src/card.css': '.x {}\n' },
      {
        'src/Card.tsx':
          'export function Card() {\n  return <div onClick={open}><img src={src} className="hero" /><img src={a} alt="" /></div>;\n}\n',
        'src/card.css': '.card button:focus {\n  outline: none;\n}\n',
      },
    );
    expect(r.ruleIds).toEqual(
      expect.arrayContaining([
        'img-missing-alt',
        'click-on-static-element',
        'focus-outline-removed',
      ]),
    );
    expect(r.findings.filter((x) => x.source.id === 'img-missing-alt')).toHaveLength(1);
  });

  it('accepts outline removal paired with :focus-visible', async () => {
    const r = await run(
      { 'a.css': '.x {}\n' },
      {
        'a.css':
          'button:focus { outline: none; }\nbutton:focus-visible { outline: 2px solid #3B5BFF; }\n',
      },
    );
    expect(r.ruleIds).not.toContain('focus-outline-removed');
  });
});

describe('a sound change', () => {
  it('produces no findings', async () => {
    const r = await run(
      {
        'src/format.ts': 'export function format(n: number): string {\n  return n.toFixed(2);\n}\n',
        'src/format.test.ts': "it('formats', () => {});\n",
      },
      {
        'src/format.ts':
          'export function format(n: number, digits = 2): string {\n  return n.toFixed(digits);\n}\n',
        'src/format.test.ts':
          "it('formats', () => {});\nit('formats with custom digits', () => {});\n",
      },
      'feat: allow custom precision in format()',
    );
    expect(r.findings).toEqual([]);
  });
});
