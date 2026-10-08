import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Git,
  parseConfigInput,
  Redactor,
  Run,
  resolveChange,
  resolveConfig,
  understandChange,
} from '@covi/core';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { createChangeRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { startApp, waitForReady } from '../src/app.ts';
import { checkoutRevision, tempWorkspace } from '../src/checkout.ts';
import { comparePngs, cropPng } from '../src/pixels.ts';
import { flowViewport, planDemo } from '../src/plan.ts';
import { describeShapeChange } from '../src/requests.ts';

let repo: TempRepo | undefined;
let dir: string | undefined;
afterEach(() => {
  repo?.cleanup();
  if (dir) rmSync(dir, { recursive: true, force: true });
  repo = undefined;
  dir = undefined;
});

describe('describeShapeChange', () => {
  it.each([
    [
      '[1,2]',
      '{"items":[1,2],"next":null}',
      /from a JSON array to a JSON object with keys items, next/,
    ],
    ['{"id":1,"email":"a@b"}', '{"id":1}', /removed field email/],
    ['{"id":1}', '{"id":"1"}', /changed the type of id \(number → string\)/],
    ['{"users":[{"id":1,"name":"a"}]}', '{"users":[{"id":1}]}', /removed field users\[\]\.name/],
  ])('%s → %s', (before, after, expected) => {
    expect(describeShapeChange(before, after)).toMatch(expected);
  });

  it('treats added fields and non-JSON bodies as compatible', () => {
    expect(describeShapeChange('{"id":1}', '{"id":1,"name":"x"}')).toBeUndefined();
    expect(describeShapeChange('ok', 'fine')).toBeUndefined();
  });
});

describe('pixel diffs', () => {
  const png = (w: number, h: number, paint?: (x: number, y: number) => number[] | undefined) => {
    const img = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [r, g, b] = paint?.(x, y) ?? [255, 255, 255];
        img.data.set([r!, g!, b!, 255], i);
      }
    return PNG.sync.write(img);
  };

  it('finds where pixels changed and crops around it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-px-'));
    writeFileSync(join(dir, 'a.png'), png(100, 80));
    writeFileSync(
      join(dir, 'b.png'),
      png(100, 80, (x, y) => (x >= 40 && x < 60 && y >= 10 && y < 30 ? [0, 0, 255] : undefined)),
    );
    const diff = await comparePngs(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'diff.png'));
    expect(diff.bounds).toEqual({ x: 40, y: 10, width: 20, height: 20 });
    expect(diff.changedRatio).toBeCloseTo(400 / 8000, 3);
    expect(existsSync(join(dir, 'diff.png'))).toBe(true);
    expect(
      await cropPng(
        join(dir, 'b.png'),
        { x: 30, y: 0, width: 50, height: 50 },
        join(dir, 'crop.png'),
      ),
    ).toEqual({ width: 50, height: 50 });
  });

  it('reports no bounds for identical images', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-px-'));
    writeFileSync(join(dir, 'a.png'), png(20, 20));
    expect((await comparePngs(join(dir, 'a.png'), join(dir, 'a.png'))).bounds).toBeUndefined();
  });

  it('lists separate regions and writes the diff image only from minPixels', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-px-'));
    writeFileSync(join(dir, 'a.png'), png(100, 80));
    writeFileSync(
      join(dir, 'b.png'),
      png(100, 80, (x, y) => (x < 2 && y < 2 ? [0, 0, 255] : undefined)),
    );
    const diff = await comparePngs(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'd.png'), {
      minPixels: 64,
    });
    expect(diff.regions).toEqual([{ x: 0, y: 0, width: 2, height: 2 }]);
    expect(existsSync(join(dir, 'd.png'))).toBe(false);
  });

  it('writes the diff image when exactly minPixels changed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-px-'));
    writeFileSync(join(dir, 'a.png'), png(100, 80));
    writeFileSync(
      join(dir, 'b.png'),
      png(100, 80, (x, y) => (x >= 40 && x < 60 && y >= 10 && y < 30 ? [0, 0, 255] : undefined)),
    );
    const diff = await comparePngs(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'd.png'), {
      minPixels: 400,
    });
    expect(diff.changedPixels).toBe(400);
    expect(existsSync(join(dir, 'd.png'))).toBe(true);
  });
});

describe('demo planning', () => {
  it('combines authored plans, configuration, and safe candidates', async () => {
    repo = createChangeRepo(
      { 'server.js': "app.get('/api/users', list);\n" },
      {
        'server.js':
          "app.get('/api/users', list);\napp.get('/api/users/:id', one);\napp.post('/api/users', create);\n",
        'public/index.html': '<h1>hi</h1>\n',
      },
    );
    const { config } = resolveConfig([
      {
        name: 'repository',
        values: parseConfigInput({ demo: { pages: ['/about'], viewports: ['mobile'] } }, 't'),
      },
    ]);
    const change = await resolveChange({ repo: repo.root });
    const context = await understandChange(change, { git: new Git(repo.root), config });
    const plan = planDemo(context, config, { pages: ['/pricing'], notes: 'from the agent' });
    expect(plan.pages).toEqual(['/pricing', '/about', '/']);
    expect(plan.viewports).toEqual(['mobile']);
    // Only parameter-free GET routes are called without configuration; POST and :id routes are not.
    expect(plan.requests.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    expect(() => planDemo(context, config, { pages: 'nope' })).toThrow(
      /demo\/plan\.json is invalid/,
    );
  });
});

describe('flowViewport', () => {
  it("runs a flow at its own viewport, else the preferred one if planned, else the plan's first", () => {
    expect(flowViewport({ viewports: ['tablet'] }, ['desktop', 'mobile'], 'mobile')).toBe('tablet');
    expect(flowViewport({}, ['desktop', 'mobile'], 'mobile')).toBe('mobile');
    expect(flowViewport({}, ['desktop'], 'mobile')).toBe('desktop');
    expect(flowViewport({}, ['tablet', 'desktop'])).toBe('tablet');
    expect(flowViewport({}, [])).toBe('desktop');
  });
});

describe('checkouts', () => {
  it('materializes base, head, and uncommitted work without touching the repository', async () => {
    repo = createChangeRepo({ 'a.txt': 'base\n' }, { 'a.txt': 'head\n' });
    repo.write({ 'a.txt': 'worktree\n', 'new.txt': 'untracked\n' });
    const before = repo.git('status', '--porcelain');
    const change = await resolveChange({ repo: repo.root });
    const ws = await tempWorkspace();
    try {
      const base = await checkoutRevision(change, 'base', ws.dir);
      const head = await checkoutRevision(change, 'head', ws.dir);
      expect(readFileSync(join(base.dir, 'a.txt'), 'utf8')).toBe('base\n');
      expect(readFileSync(join(head.dir, 'a.txt'), 'utf8')).toBe('worktree\n');
      expect(readFileSync(join(head.dir, 'new.txt'), 'utf8')).toBe('untracked\n');
    } finally {
      await ws.dispose();
    }
    expect(repo.git('status', '--porcelain')).toBe(before);
    expect(repo.git('stash', 'list')).toBe('');
  });

  it('checks out staged changes as a dangling commit, even without a git identity', async () => {
    repo = createChangeRepo({ 'a.txt': 'base\n' }, {});
    repo.write({ 'a.txt': 'staged\n' });
    repo.git('add', 'a.txt');
    repo.write({ 'a.txt': 'unstaged\n' });
    const change = await resolveChange({ repo: repo.root, scope: 'staged' });
    const ws = await tempWorkspace();
    // CI runners and fresh containers have no user.name; useConfigOnly stops git from guessing one.
    dir = mkdtempSync(join(tmpdir(), 'covi-no-identity-'));
    writeFileSync(join(dir, 'gitconfig'), '[user]\n\tuseConfigOnly = true\n');
    const saved = { ...process.env };
    process.env.GIT_CONFIG_GLOBAL = join(dir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      const head = await checkoutRevision(change, 'head', ws.dir);
      expect(readFileSync(join(head.dir, 'a.txt'), 'utf8')).toBe('staged\n');
    } finally {
      process.env = saved;
      await ws.dispose();
    }
  });
});

describe('app runner', () => {
  it('starts a configured command with a scrubbed environment and stops its process group', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-app-'));
    writeFileSync(
      join(dir, 'server.js'),
      "require('node:http').createServer((req, res) => res.end(JSON.stringify({ token: process.env.GITHUB_TOKEN ?? null, flag: process.env.FEATURE_FLAG ?? null }))).listen(Number(process.env.PORT), '127.0.0.1');\n",
    );
    const run = await Run.create({
      root: dir,
      workflow: 'demo',
      entryPoint: 'cli',
      interactive: false,
      coviVersion: 'test',
      redactor: new Redactor(),
    });
    const { config } = resolveConfig([
      {
        name: 'repository',
        values: parseConfigInput(
          { app: { start: 'node server.js', env: { FEATURE_FLAG: 'on' }, timeout: 20 } },
          't',
        ),
      },
    ]);
    process.env.GITHUB_TOKEN = 'ghs_should_not_leak_0123456789';
    try {
      const app = await startApp(dir, config, {
        mode: 'command',
        run,
        logger: {
          debug() {},
          info() {},
          warn() {},
          error() {},
          step() {},
          child() {
            return this;
          },
        },
        revision: 'head',
      });
      const body = (await (await fetch(app.url)).json()) as { token: string | null; flag: string };
      expect(body).toEqual({ token: null, flag: 'on' });
      await app.stop();
      await expect(fetch(app.url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('times out with the app output when it never becomes ready', async () => {
    await expect(waitForReady('http://127.0.0.1:9/', 600)).rejects.toThrow(/was not ready within/);
  });
});
