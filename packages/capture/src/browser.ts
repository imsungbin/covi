import type { Flow, FlowStep, Rect } from '@covi/core';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { collectMutations, observe } from './observe.ts';
import type { TraceCollector } from './trace.ts';

export const VIEWPORT_PRESETS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false },
  tablet: { width: 834, height: 1112, deviceScaleFactor: 2, isMobile: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
} as const;

export type ViewportName = keyof typeof VIEWPORT_PRESETS;

export interface ContextOptions {
  /** Record a WebM of every page in the context into this directory. */
  recordDir?: string;
}

/** Context settings for a viewport, the same at base and head so their captures compare. */
export function contextOptions(
  viewport: ViewportName,
  options: ContextOptions = {},
): BrowserContextOptions {
  const v = VIEWPORT_PRESETS[viewport];
  return {
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.deviceScaleFactor,
    isMobile: v.isMobile,
    hasTouch: v.isMobile,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    // The viewport at CSS size; Playwright would otherwise shrink the video to fit 800×800.
    ...(options.recordDir
      ? { recordVideo: { dir: options.recordDir, size: { width: v.width, height: v.height } } }
      : {}),
  };
}

export async function newContext(
  browser: Browser,
  viewport: ViewportName,
  options: ContextOptions = {},
): Promise<BrowserContext> {
  return browser.newContext(contextOptions(viewport, options));
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
  title?: string;
}

/** Screenshots a page (full height, capped) and collects console and page errors. */
export async function capturePage(
  browser: Browser,
  url: string,
  viewport: ViewportName,
  file: string,
  trace?: TraceCollector,
): Promise<PageCapture> {
  const context = await newContext(browser, viewport);
  const page = await context.newPage();
  const v = VIEWPORT_PRESETS[viewport];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (trace) {
    trace.start();
    await observe(page, trace);
    trace.beginStep({ id: 'load', action: 'goto' });
  }
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
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
    trace?.frame(file);
    // The capture is the page's full height (capped), not only the viewport.
    trace?.endStep({
      mutations: await collectMutations(page, v.deviceScaleFactor, { width: v.width, height }),
    });
    return {
      file,
      width: v.width * v.deviceScaleFactor,
      height: height * v.deviceScaleFactor,
      scale: v.deviceScaleFactor,
      status: response?.status(),
      errors,
      title: await page.title().catch(() => undefined),
    };
  } catch (error) {
    trace?.endStep({ status: 'failed', error: (error as Error).message.split('\n')[0] });
    throw error;
  } finally {
    trace?.stop();
    await context.close();
  }
}

export interface FlowFrame {
  file: string;
  label: string;
  /** The step the frame belongs to (`open`, `s1`…, `end`): the same at base and head. */
  step: string;
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

/** A flow step's id: `s1`… in plan order, so base and head steps pair up. */
export function stepId(index: number): string {
  return `s${index + 1}`;
}

const ACTIONS = [
  'goto',
  'click',
  'fill',
  'press',
  'hover',
  'select',
  'check',
  'scroll',
  'wait',
  'screenshot',
] as const;

function actionOf(step: FlowStep): string {
  return ACTIONS.find((a) => a in step) ?? 'step';
}

function traceTarget(step: FlowStep): string | undefined {
  if ('goto' in step) return step.goto;
  if ('scroll' in step) return typeof step.scroll === 'string' ? step.scroll : undefined;
  if ('wait' in step) return typeof step.wait === 'string' ? step.wait : undefined;
  return targetOf(step);
}

export interface FlowOptions {
  /** Record the flow as WebM into this directory (Playwright picks the file name). */
  recordDir?: string;
  trace?: TraceCollector;
}

export interface FlowRun {
  frames: FlowFrame[];
  error?: string;
  errors: string[];
  title?: string;
  /** The WebM Playwright wrote, when the flow was recorded. */
  video?: string;
  /** Why recording was asked for and could not start; the flow still ran, unrecorded. */
  recordError?: string;
}

/**
 * Opens a page, recording it when asked. Playwright records with its own ffmpeg build; when that
 * is missing the page cannot open with recording on, so the flow runs unrecorded and says why.
 */
async function openPage(
  browser: Browser,
  viewport: ViewportName,
  recordDir?: string,
): Promise<{ context: BrowserContext; page: Page; recordError?: string }> {
  if (recordDir) {
    let context: BrowserContext | undefined;
    try {
      context = await newContext(browser, viewport, { recordDir });
      return { context, page: await context.newPage() };
    } catch (error) {
      await context?.close().catch(() => undefined);
      const plain = await newContext(browser, viewport);
      return {
        context: plain,
        page: await plain.newPage(),
        recordError: (error as Error).message.split('\n')[0]!,
      };
    }
  }
  const context = await newContext(browser, viewport);
  return { context, page: await context.newPage() };
}

/**
 * Runs a scripted flow. Each interactive step is captured *before* it happens (so the video can
 * move the cursor to the target and click), and the flow ends with the resulting state. With a
 * trace, every step is timed from the start of the recording, with what it changed in the DOM.
 */
export async function runFlow(
  browser: Browser,
  baseUrl: string,
  flow: Flow,
  viewport: ViewportName,
  fileFor: (index: number) => string,
  options: FlowOptions = {},
): Promise<FlowRun> {
  const { context, page, recordError } = await openPage(browser, viewport, options.recordDir);
  const video = page.video();
  const scale = VIEWPORT_PRESETS[viewport].deviceScaleFactor;
  const trace = options.trace;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (trace) {
    trace.start();
    await observe(page, trace);
  }
  const frames: FlowFrame[] = [];
  let current = 'open';
  const shoot = async (label: string, target?: string) => {
    let click: FlowFrame['click'];
    let focus: FlowFrame['focus'];
    let box: Rect | undefined;
    if (target) {
      const found = await page
        .locator(target)
        .first()
        .boundingBox({ timeout: 5000 })
        .catch(() => null);
      if (found) {
        click = {
          x: Math.round((found.x + found.width / 2) * scale),
          y: Math.round((found.y + found.height / 2) * scale),
        };
        const pad = 12;
        focus = {
          x: Math.round((found.x - pad) * scale),
          y: Math.round((found.y - pad) * scale),
          width: Math.round((found.width + pad * 2) * scale),
          height: Math.round((found.height + pad * 2) * scale),
        };
        box = {
          x: Math.round(found.x * scale),
          y: Math.round(found.y * scale),
          width: Math.round(found.width * scale),
          height: Math.round(found.height * scale),
        };
      }
    }
    const file = fileFor(frames.length);
    await page.screenshot({ path: file });
    frames.push({ file, label, step: current, click, focus });
    trace?.frame(file, box);
  };
  // Read after each step, so the DOM changes describe what that step's action caused.
  const endStep = async () =>
    trace?.endStep({ mutations: await collectMutations(page, scale, VIEWPORT_PRESETS[viewport]) });
  let result: FlowRun;
  try {
    trace?.beginStep({ id: 'open', action: 'goto', target: flow.path });
    await page.goto(`${baseUrl}${flow.path}`, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
    const first = flow.steps[0];
    if (!first || !describe(first)) await shoot(flow.description ?? `Open ${flow.path}`);
    await endStep();
    for (const [index, step] of flow.steps.entries()) {
      current = stepId(index);
      const label = describe(step);
      const target = targetOf(step);
      trace?.beginStep({
        id: current,
        action: actionOf(step),
        target: traceTarget(step),
        label: label ?? ('screenshot' in step ? (step.note ?? step.screenshot) : undefined),
      });
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
        await endStep();
        continue;
      }
      await page.waitForTimeout(200);
      await endStep();
    }
    const last = flow.steps.at(-1);
    if (!last || !('screenshot' in last)) {
      current = 'end';
      trace?.beginStep({ id: 'end', action: 'end', label: flow.name });
      await settle(page);
      await shoot(flow.name);
      await endStep();
    }
    result = { frames, errors, title: await page.title().catch(() => undefined) };
  } catch (error) {
    const message = (error as Error).message.split('\n')[0]!;
    trace?.endStep({ status: 'failed', error: message });
    result = { frames, error: message, errors };
  } finally {
    trace?.stop();
    await context.close();
  }
  if (recordError) result.recordError = recordError;
  // Playwright finishes writing the video when the context closes.
  const recorded = await video?.path().catch(() => undefined);
  if (recorded) result.video = recorded;
  return result;
}
