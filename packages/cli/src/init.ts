import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectBaseBranch, ensureDir, exists, Git } from '@covi/core';

export interface InitResult {
  path: string;
  created: boolean;
  content: string;
  detected: string[];
}

/** Writes a small, commented .covi/config.yml based on what Covi can detect safely. */
export async function initConfig(
  root: string,
  options: { force?: boolean } = {},
): Promise<InitResult> {
  const path = join(root, '.covi', 'config.yml');
  if ((await exists(path)) && !options.force) {
    return { path, created: false, content: await readFile(path, 'utf8'), detected: [] };
  }
  const detected: string[] = [];
  const base = (await detectBaseBranch(new Git(root)))?.replace(/^origin\//, '');
  if (base) detected.push(`base branch ${base}`);

  let scripts: Record<string, string> = {};
  let needsBuild = false;
  const pkgText = await readFile(join(root, 'package.json'), 'utf8').catch(() => undefined);
  if (pkgText) {
    const pkg = JSON.parse(pkgText) as {
      scripts?: Record<string, string>;
      dependencies?: object;
      devDependencies?: object;
    };
    scripts = pkg.scripts ?? {};
    needsBuild = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) =>
      /^(vite|next|nuxt|react-scripts|webpack|parcel|@sveltejs\/kit|astro|@angular\/core|gatsby)$/.test(
        d,
      ),
    );
  }
  let staticRoot: string | undefined;
  if (!needsBuild) {
    for (const dir of ['.', 'public', 'static', 'site', 'www']) {
      if (await exists(join(root, dir === '.' ? 'index.html' : `${dir}/index.html`))) {
        staticRoot = dir;
        detected.push(`static site in ${dir === '.' ? 'the repository root' : `${dir}/`}`);
        break;
      }
    }
  }
  const startScript = ['dev', 'start', 'preview', 'serve'].find((s) => scripts[s]);
  const lockfile = (await exists(join(root, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await exists(join(root, 'yarn.lock')))
      ? 'yarn'
      : 'npm';
  const install = {
    npm: 'npm ci',
    pnpm: 'pnpm install --frozen-lockfile',
    yarn: 'yarn install --frozen-lockfile',
  }[lockfile];
  const run = (s: string) => (lockfile === 'npm' ? `npm run ${s}` : `${lockfile} ${s}`);
  if (startScript) detected.push(`"${startScript}" script`);
  const testCommand =
    scripts.test && !/no test specified/.test(scripts.test)
      ? lockfile === 'npm'
        ? 'npm test'
        : `${lockfile} test`
      : undefined;
  if (testCommand) detected.push('test script');

  const lines = [
    '# Covi configuration. Every key is optional; see docs/configuration.md.',
    '# Commands here run with an allowlisted environment (no tokens or keys). On your machine they',
    '# run only after `covi trust` (covi init trusts what it writes); in CI, Covi reads this file',
    '# from the base revision, so a change cannot alter the commands that review it.',
    base ? `base: ${base}` : '# base: main',
    '',
    'app:',
  ];
  if (staticRoot !== undefined)
    lines.push(
      `  static: ${staticRoot === '.' ? '.' : staticRoot}   # served as-is; no project code runs`,
    );
  else if (startScript) {
    lines.push(
      `  install: ${install}`,
      `  start: ${run(startScript)} -- --port {port}`,
      '  url: http://127.0.0.1:{port}',
    );
  } else {
    lines.push(
      '  # install: npm ci',
      '  # start: npm run dev -- --port {port}',
      '  # url: http://127.0.0.1:{port}',
    );
  }
  lines.push(
    '',
    'test:',
    testCommand ? `  command: ${testCommand}` : '  # command: npm test',
    '',
    'review:',
    '  failOn: none        # none | low | medium | high (confirmed and likely findings only)',
    '',
    '# Unset video settings are asked about in interactive sessions and default to short in CI.',
    '# video:',
    '#   mode: short       # short | standard | custom',
    '#   duration: auto',
    '',
  );
  const content = `${lines.join('\n')}\n`;
  await ensureDir(join(root, '.covi'));
  await writeFile(path, content);
  return { path, created: true, content, detected };
}
