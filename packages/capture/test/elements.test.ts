import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StaticServer, serveStatic } from '@covi/core';
import { type Browser, chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { capturePage, runFlow } from '../src/browser.ts';
import { isSecretField, parseScan, selectorFor } from '../src/elements.ts';

const browserAvailable = await canUseBrowser();
let dir: string | undefined;
let server: StaticServer | undefined;
let browser: Browser | undefined;
afterEach(async () => {
  await browser?.close();
  await server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  browser = undefined;
  server = undefined;
  dir = undefined;
});

const ACCOUNT = `<!doctype html><html><head><title>Account</title></head><body>
<h1>Sign in</h1>
<button data-testid="save-draft">Save draft</button>
<label for="email">Email</label><input id="email">
<input id="pw" type="password" aria-label="Password">
<a href="#help">Get "help"</a>
<button id="ember1234">Generated</button>
<div hidden><button id="ghost">Hidden</button></div>
<div style="height:3000px"></div>
<button id="far">Far below</button>
</body></html>`;

const FIELDS = `<!doctype html><html><body>
<input id="name" autocomplete="name">
<input id="holder" autocomplete="cc-name">
<input id="hint" autocomplete="password-hint">
<input id="code" autocomplete="one-time-code">
<input id="card" autocomplete="section-pay billing cc-number">
<input id="pw" type="PassWord">
<select id="month" autocomplete="cc-exp-month"><option>01</option><option>02</option></select>
<select id="size"><option>S</option><option>M</option></select>
<div id="note" role="textbox" contenteditable="true" title="Note"></div>
</body></html>`;

describe('parseScan', () => {
  it('keeps only what a hostile page cannot use: single lines, finite boxes, 60 elements', () => {
    expect(parseScan(undefined)).toBeUndefined();
    expect(parseScan('nope')).toBeUndefined();
    const scan = parseScan({
      path: '/a/?q=1',
      scroll: { x: Number.NaN, y: -5 },
      elements: [
        { tag: 'button', id: 'ok', name: 'Fine\u001b[31m\nline', x: 1, y: 2, width: 3, height: 4 },
        { tag: 'button', id: 'nan', x: Number.NaN, y: 0, width: 1, height: 1 },
        { tag: 'button', id: 'flat', x: 0, y: 0, width: 0, height: 10 },
        { tag: 'div', x: 0, y: 0, width: 5, height: 5 },
        { tag: 'button', id: 'ok', x: 9, y: 9, width: 9, height: 9 },
        { tag: 'a', test: ['onclick', 'x'], name: 'Link', x: 0, y: 0, width: 5, height: 5 },
        { tag: 'input', type: 'password', id: 'pin', x: 0, y: 0, width: 5, height: 5 },
        { tag: 'input', id: 'card', autocomplete: 'cc-number', x: 0, y: 0, width: 5, height: 5 },
        ...Array.from({ length: 80 }, (_, i) => ({
          tag: 'button',
          id: `b${i}x`,
          x: 0,
          y: i,
          width: 5,
          height: 5,
        })),
      ],
    })!;
    expect(scan.path).toBe('/a');
    expect(scan.scroll).toEqual({ x: 0, y: 0 });
    expect(scan.elements[0]).toEqual({
      selector: '#ok',
      key: 'ok',
      role: 'button',
      label: 'Fine [31m line',
      box: { x: 1, y: 2, width: 3, height: 4 },
    });
    const selectors = scan.elements.map((e) => e.selector);
    expect(selectors.slice(1, 4)).toEqual(['role=link[name="Link"]', '#pin', '#card']);
    expect(scan.elements.filter((e) => e.secret).map((e) => e.selector)).toEqual(['#pin', '#card']);
    // The first 60 raw entries are read: 8 above (4 kept) and 52 buttons.
    expect(scan.elements).toHaveLength(56);
  });

  it('caps what the page reported and drops a scan whose path the model cannot keep', () => {
    const huge = { tag: 'button', id: 'big', x: 1e12, y: 2e6, width: 1e9, height: 5 };
    const scan = parseScan({ path: '/', scroll: { x: 1e9, y: 10 }, elements: [huge] })!;
    expect(scan.scroll).toEqual({ x: 100_000, y: 10 });
    expect(scan.elements[0]!.box).toEqual({ x: 100_000, y: 100_000, width: 100_000, height: 5 });
    // Bidi overrides in page text are control characters too.
    const bidi = parseScan({
      path: '/',
      elements: [{ tag: 'button', name: 'Pay‮now', x: 0, y: 0, width: 5, height: 5 }],
    })!;
    expect(bidi.elements[0]!.label).toBe('Pay now');
    expect(parseScan({ path: `/${'a'.repeat(600)}`, elements: [] })).toBeUndefined();
    expect(parseScan({ path: 42, elements: [] })).toBeUndefined();
    expect(parseScan({ path: '/', elements: 'many' })).toEqual({
      path: '/',
      scroll: { x: 0, y: 0 },
      elements: [],
    });
  });

  it('flags a secret field by its type or an exact autocomplete token, never a substring', () => {
    const field = (id: string, more: Record<string, unknown>) => ({
      tag: 'input',
      id,
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      ...more,
    });
    const scan = parseScan({
      path: '/',
      elements: [
        field('pw', { type: 'PASSWORD' }),
        field('code', { autocomplete: 'one-time-code' }),
        field('card', { autocomplete: 'section-pay billing cc-number' }),
        field('exp', { autocomplete: 'cc-exp' }),
        field('holder', { autocomplete: 'cc-name' }),
        field('hint', { autocomplete: 'password-hint' }),
        field('user', { autocomplete: 'username' }),
      ],
    })!;
    expect(scan.elements.filter((e) => e.secret).map((e) => e.selector)).toEqual([
      '#pw',
      '#code',
      '#card',
      '#exp',
    ]);
  });

  it('builds selectors only from stable attributes, quoted', () => {
    expect(selectorFor({ test: ['data-testid', 'a"b'] })).toEqual({
      selector: '[data-testid="a\\"b"]',
      key: 'a-b',
    });
    expect(selectorFor({ id: 'save' })).toEqual({ selector: '#save', key: 'save' });
    expect(selectorFor({ id: 'ember1234', role: 'button', name: 'Go' })).toEqual({
      selector: 'role=button[name="Go"]',
      key: 'go',
    });
    expect(selectorFor({ id: ':r1:' })).toBeUndefined();
    expect(selectorFor({ role: 'button' })).toBeUndefined();
  });
});

describe('scans in the browser', () => {
  it.skipIf(!browserAvailable)(
    'builds a selector for each element that finds it again, and flags the password',
    async () => {
      dir = mkdtempSync(join(tmpdir(), 'covi-scan-'));
      writeFileSync(join(dir, 'index.html'), ACCOUNT);
      server = await serveStatic(dir);
      browser = await chromium.launch();
      const capture = await capturePage(
        browser,
        `${server.url}/`,
        'desktop',
        join(dir, 'page.png'),
      );
      const scan = capture.scan!;
      expect(scan.path).toBe('/');
      expect(
        scan.elements.map((e) => [e.selector, e.key, e.role, e.label, e.secret ?? false]),
      ).toEqual([
        ['role=heading[name="Sign in"]', 'sign-in', 'heading', 'Sign in', false],
        ['[data-testid="save-draft"]', 'save-draft', 'button', 'Save draft', false],
        ['#email', 'email', 'textbox', 'Email', false],
        ['#pw', 'pw', 'textbox', 'Password', true],
        ['role=link[name="Get \\"help\\""]', 'get-help', 'link', 'Get "help"', false],
        ['role=button[name="Generated"]', 'generated', 'button', 'Generated', false],
        ['#far', 'far', 'button', 'Far below', false],
      ]);
      expect(scan.elements.at(-1)!.box.y).toBeGreaterThan(3000);
      // Each selector finds its element again, Playwright's role engine included.
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      for (const e of scan.elements)
        expect(await page.locator(e.selector).count(), e.selector).toBe(1);
      await page.close();
    },
  );

  it.skipIf(!browserAvailable)(
    'tells a secret field by its type or an exact autocomplete token',
    async () => {
      dir = mkdtempSync(join(tmpdir(), 'covi-scan-fields-'));
      writeFileSync(join(dir, 'index.html'), FIELDS);
      server = await serveStatic(dir);
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      const secret: string[] = [];
      for (const id of ['name', 'holder', 'hint', 'code', 'card', 'pw', 'month', 'size'])
        if (await isSecretField(page.locator(`#${id}`))) secret.push(id);
      expect(secret).toEqual(['code', 'card', 'pw', 'month']);
      await page.close();
    },
  );

  it.skipIf(!browserAvailable)(
    'scans each flow frame where it was scrolled, and notes a flow that types a password',
    async () => {
      dir = mkdtempSync(join(tmpdir(), 'covi-scan-flow-'));
      writeFileSync(join(dir, 'index.html'), ACCOUNT);
      server = await serveStatic(dir);
      browser = await chromium.launch();
      const outcome = await runFlow(
        browser,
        server.url,
        {
          name: 'Sign in',
          path: '/',
          steps: [
            { fill: '#pw', text: 'hunter2' },
            { scroll: '#far' },
            { click: '#far', note: 'Go far' },
          ],
        },
        'desktop',
        (i) => join(dir!, `f-${i}.png`),
      );
      expect(outcome.error).toBeUndefined();
      expect(outcome.secret).toBe(true);
      const far = outcome.frames.find((f) => f.step === 's3')!;
      expect(far.scan!.scroll.y).toBeGreaterThan(0);
      expect(far.scan!.elements.find((e) => e.selector === '#far')!.box.y).toBeGreaterThan(3000);
      const plain = await runFlow(
        browser,
        server.url,
        { name: 'Email', path: '/', steps: [{ fill: '#email', text: 'a@example.com' }] },
        'desktop',
        (i) => join(dir!, `g-${i}.png`),
      );
      expect(plain.secret).toBeUndefined();
    },
  );

  it.skipIf(!browserAvailable)(
    'notes a flow that presses keys in or chooses from a secret field',
    async () => {
      dir = mkdtempSync(join(tmpdir(), 'covi-scan-press-'));
      writeFileSync(join(dir, 'index.html'), FIELDS);
      server = await serveStatic(dir);
      browser = await chromium.launch();
      const run = (name: string, steps: Parameters<typeof runFlow>[2]['steps']) =>
        runFlow(browser!, server!.url, { name, path: '/', steps }, 'desktop', (i) =>
          join(dir!, `${name}-${i}.png`),
        );
      const pressed = await run('press', [{ press: 'Digit1', selector: '#code' }]);
      expect(pressed.error).toBeUndefined();
      expect(pressed.secret).toBe(true);
      const chosen = await run('choose', [{ select: '#month', value: '02' }]);
      expect(chosen.error).toBeUndefined();
      expect(chosen.secret).toBe(true);
      const plain = await run('plain', [
        { press: 'KeyA', selector: '#name' },
        { select: '#size', value: 'M' },
        { press: 'Tab' },
        { fill: '#note', text: 'typed words' },
      ]);
      expect(plain.error).toBeUndefined();
      expect(plain.secret).toBeUndefined();
      // What a flow typed into an editable element is never read as its label.
      const note = plain.frames.at(-1)!.scan!.elements.find((e) => e.selector === '#note')!;
      expect(note.label).toBe('Note');
    },
  );
});
