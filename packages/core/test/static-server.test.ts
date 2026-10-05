import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../src/serve/static-server.ts';

const dir = mkdtempSync(join(tmpdir(), 'covi-static-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('serveStatic', () => {
  const site = join(dir, 'site');
  const outside = join(dir, 'outside');
  mkdirSync(join(site, 'docs'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(site, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(site, 'docs', 'index.html'), '<h1>docs</h1>');
  writeFileSync(join(outside, 'secret.txt'), 'top secret');
  writeFileSync(join(outside, 'index.html'), 'outside index');
  // What a reviewed repository could commit:
  symlinkSync(join(outside, 'secret.txt'), join(site, 'leak.txt'));
  symlinkSync(outside, join(site, 'escape'));
  symlinkSync(join(site, 'index.html'), join(site, 'alias.html'));

  it('serves files and directory indexes inside the root', async () => {
    const server = await serveStatic(site);
    try {
      expect(await (await fetch(`${server.url}/`)).text()).toBe('<h1>home</h1>');
      expect(await (await fetch(`${server.url}/docs/`)).text()).toBe('<h1>docs</h1>');
      // Symlinks that stay inside the root are fine.
      expect(await (await fetch(`${server.url}/alias.html`)).text()).toBe('<h1>home</h1>');
      expect((await fetch(`${server.url}/missing.html`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('never serves anything outside the root, through paths or symlinks', async () => {
    const server = await serveStatic(site);
    try {
      for (const path of [
        '/leak.txt',
        '/escape/secret.txt',
        '/escape/',
        '/%2e%2e/outside/secret.txt',
      ]) {
        const response = await fetch(`${server.url}${path}`);
        expect([403, 404], path).toContain(response.status);
        expect(await response.text(), path).not.toMatch(/secret|outside index/);
      }
    } finally {
      await server.close();
    }
  });
});
