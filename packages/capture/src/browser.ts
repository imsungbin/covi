import type { Flow, FlowStep } from '@covi/core';
import type { Browser, BrowserContext, Page } from 'playwright';

export const VIEWPORT_PRESETS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false },
  tablet: { width: 834, height: 1112, deviceScaleFactor: 2, isMobile: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
} as const;

export type ViewportName = keyof typeof VIEWPORT_PRESETS;

export async function newContext(
  browser: Browser,
  viewport: ViewportName,
): Promise<BrowserContext> {
  const v = VIEWPORT_PRESETS[viewport];
  return browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.deviceScaleFactor,
    isMobile: v.isMobile,
    hasTouch: v.isMobile,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  // Evaluated in the page; written as strings because this module is compiled without DOM types.
  await page
    .evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    .catch(() => undefined);
  // Disable carets and lingering transitions so before/after screenshots compare cleanly.
  await page
    .addStyleTag({
      content:
        '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
    })
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

export interface PageCapture {
  file: string;
  width: number;
  height: number;
  scale: number;
  status?: number;
  errors: string[];
}

/** Screenshots a page (full height, capped) and collects console and page errors. */
export async function capturePage(
  browser: Browser,
  url: string,
  viewport: ViewportName,
  file: string,
): Promise<PageCapture> {
  const context = await newContext(browser, viewport);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
    const v = VIEWPORT_PRESETS[viewport];
    const fullHeight = Number(
      await page.evaluate(
        'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
      ),
    );
    const height = Math.min(Math.max(v.height, fullHeight), v.height * 3);
    await page.screenshot({
      path: file,
      fullPage: true,
      clip: { x: 0, y: 0, width: v.width, height },
    });
    return {
      file,
      width: v.width * v.deviceScaleFactor,
      height: height * v.deviceScaleFactor,
      scale: v.deviceScaleFactor,
      status: response?.status(),
      errors,
    };
  } finally {
    await context.close();
  }
}

export interface FlowFrame {
  file: string;
  label: string;
  click?: { x: number; y: number };
  focus?: { x: number; y: number; width: number; height: number };
}

function describe(step: FlowStep): string | undefined {
  if ('click' in step) return step.note ?? `Click ${shortSelector(step.click)}`;
  if ('fill' in step)
    return (
      step.note ?? `Type “${step.text.length > 28 ? `${step.text.slice(0, 27)}…` : step.text}”`
    );
  if ('press' in step) return `Press ${step.press}`;
  if ('select' in step) return `Choose “${step.value}”`;
  if ('check' in step) return `Check ${shortSelector(step.check)}`;
  if ('hover' in step) return `Hover ${shortSelector(step.hover)}`;
  return undefined;
}

function shortSelector(selector: string): string {
  const text =
    /^(?:text=|text\/|role=\w+\[name=)["']?([^"'\]]+)/.exec(selector)?.[1] ??
    /has-text\(["']([^"']+)["']\)/.exec(selector)?.[1];
  return text ? `“${text}”` : selector.length > 30 ? `${selector.slice(0, 29)}…` : selector;
}

function targetOf(step: FlowStep): string | undefined {
  if ('click' in step) return step.click;
  if ('fill' in step) return step.fill;
  if ('select' in step) return step.select;
  if ('check' in step) return step.check;
  if ('hover' in step) return step.hover;
  if ('press' in step) return step.selector;
  if ('screenshot' in step) return step.focus;
  return undefined;
}

/**
 * Runs a scripted flow. Each interactive step is captured *before* it happens (so the video can
 * move the cursor to the target and click), and the flow ends with the resulting state.
 */
export async function runFlow(
  browser: Browser,
  baseUrl: string,
  flow: Flow,
  viewport: ViewportName,
  fileFor: (index: number) => string,
): Promise<{ frames: FlowFrame[]; error?: string; errors: string[] }> {
  const context = await newContext(browser, viewport);
  const page = await context.newPage();
  const scale = VIEWPORT_PRESETS[viewport].deviceScaleFactor;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const frames: FlowFrame[] = [];
  const shoot = async (label: string, target?: string) => {
    let click: FlowFrame['click'];
    let focus: FlowFrame['focus'];
    if (target) {
      const box = await page
        .locator(target)
        .first()
        .boundingBox({ timeout: 5000 })
        .catch(() => null);
      if (box) {
        click = {
          x: Math.round((box.x + box.width / 2) * scale),
          y: Math.round((box.y + box.height / 2) * scale),
        };
        const pad = 12;
        focus = {
          x: Math.round((box.x - pad) * scale),
          y: Math.round((box.y - pad) * scale),
          width: Math.round((box.width + pad * 2) * scale),
          height: Math.round((box.height + pad * 2) * scale),
        };
      }
    }
    const file = fileFor(frames.length);
    await page.screenshot({ path: file });
    frames.push({ file, label, click, focus });
  };
  try {
    await page.goto(`${baseUrl}${flow.path}`, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
    const first = flow.steps[0];
    if (!first || !describe(first)) await shoot(flow.description ?? `Open ${flow.path}`);
    for (const step of flow.steps) {
      const label = describe(step);
      const target = targetOf(step);
      if (label && target) await shoot(label, target);
      if ('goto' in step) await page.goto(`${baseUrl}${step.goto}`, { waitUntil: 'load' });
      else if ('click' in step) await page.locator(step.click).first().click({ timeout: 8000 });
      else if ('fill' in step)
        await page.locator(step.fill).first().fill(step.text, { timeout: 8000 });
      else if ('press' in step)
        await (step.selector
          ? page.locator(step.selector).first().press(step.press)
          : page.keyboard.press(step.press));
      else if ('hover' in step) await page.locator(step.hover).first().hover({ timeout: 8000 });
      else if ('select' in step)
        await page.locator(step.select).first().selectOption(step.value, { timeout: 8000 });
      else if ('check' in step) await page.locator(step.check).first().check({ timeout: 8000 });
      else if ('scroll' in step) {
        if (typeof step.scroll === 'number') await page.mouse.wheel(0, step.scroll);
        else await page.locator(step.scroll).first().scrollIntoViewIfNeeded();
      } else if ('wait' in step) {
        if (typeof step.wait === 'number') await page.waitForTimeout(Math.min(step.wait, 10_000));
        else await page.locator(step.wait).first().waitFor({ timeout: 10_000 });
      } else if ('screenshot' in step) {
        await settle(page);
        await shoot(step.note ?? step.screenshot, step.focus);
        continue;
      }
      await page.waitForTimeout(200);
    }
    const last = flow.steps.at(-1);
    if (!last || !('screenshot' in last)) {
      await settle(page);
      await shoot(flow.name);
    }
    return { frames, errors };
  } catch (error) {
    return { frames, error: (error as Error).message.split('\n')[0], errors };
  } finally {
    await context.close();
  }
}
