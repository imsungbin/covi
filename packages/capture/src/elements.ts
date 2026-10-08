import { type Rect, SUBJECT_CONTROL, SUBJECT_LIMITS, screenPath, subjectKey } from '@covi/core';
import type { Locator, Page } from 'playwright';

/** What a screen is known by: what a user acts on, and the headings that name its regions. */
const PICK =
  'a[href],button,input:not([type=hidden]),select,textarea,summary,[role],[data-testid],[data-test],[data-cy],[data-qa],h1,h2,h3';

/**
 * Lists the page's elements worth keeping (at most 60, in document order) with the attributes a
 * stable selector is built from, and boxes in CSS pixels from the top of the page. Text fields'
 * values are never read, nor the text of an editable element: they may hold what a flow typed.
 * Written as a string because this
 * package compiles without DOM types.
 */
export const SCAN_ELEMENTS = `(() => {
  const text = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  const TEST = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
  const out = [];
  for (const el of document.querySelectorAll(${JSON.stringify(PICK)})) {
    if (out.length >= ${SUBJECT_LIMITS.elements}) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const test = TEST.find((a) => el.hasAttribute(a));
    const by = el.getAttribute('aria-labelledby');
    const labelledBy = by ? document.getElementById(by.split(' ')[0]) : null;
    const forId = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      || el.isContentEditable || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(el.getAttribute('role'));
    const button = el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(type);
    const name = text(el.getAttribute('aria-label')) || text(labelledBy && labelledBy.textContent)
      || text(forId && forId.textContent)
      || (field ? (button ? text(el.value) : text(el.getAttribute('placeholder'))) : text(el.textContent))
      || text(el.getAttribute('title'));
    out.push({
      tag: el.tagName.toLowerCase(),
      type: type || undefined,
      role: el.getAttribute('role') || undefined,
      test: test ? [test, el.getAttribute(test)] : undefined,
      id: el.id || undefined,
      name: name || undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height,
    });
  }
  return { path: location.pathname, scroll: { x: scrollX, y: scrollY }, elements: out };
})()`;

export interface ScannedElement {
  selector: string;
  key: string;
  role?: string;
  label?: string;
  secret?: true;
  /** CSS pixels from the top of the page. */
  box: Rect;
}

export interface PageScan {
  /** `location.pathname` when the scan ran. */
  path: string;
  /** CSS pixels the page was scrolled by. */
  scroll: { x: number; y: number };
  elements: ScannedElement[];
}

const IMPLICIT_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  summary: 'button',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
};
const INPUT_ROLE: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  submit: 'button',
  button: 'button',
  reset: 'button',
  range: 'slider',
  search: 'searchbox',
  number: 'spinbutton',
};
/**
 * Autocomplete tokens of fields that hold a password, one-time code, or card secret. Matched as
 * whole tokens: `cc-name` and `password-hint` are ordinary fields.
 */
const SECRET_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
]);
/** Ids frameworks generate (`ember1234`, `:r1:`) change between builds; they make poor selectors. */
const STABLE_ID = /^[A-Za-z][\w-]{0,63}$/;
const CONTROLS = new RegExp(`${SUBJECT_CONTROL.source}+`, 'g');
/** The largest coordinate the model keeps; page geometry past it is page input, not layout. */
const MAX_PIXELS = 100_000;

/** Page text as one line within a limit (control characters, terminal escapes among them, removed). */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

/** A value used as-is in a selector: kept only when short and free of control characters. */
function exact(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value && value.length <= max && !SUBJECT_CONTROL.test(value)
    ? value
    : undefined;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const pixels = (n: number) => Math.min(MAX_PIXELS, Math.max(0, n));

/** Whether a field's `type` and `autocomplete` say it holds a password, one-time code, or card secret. */
function secretField(type: string | null | undefined, autocomplete: string | null | undefined) {
  return (
    type?.toLowerCase() === 'password' ||
    (autocomplete ?? '')
      .toLowerCase()
      .split(/\s+/)
      .some((token) => SECRET_AUTOCOMPLETE.has(token))
  );
}

/** A string literal in a selector, with quotes and backslashes escaped. */
export function quoteSelector(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * A selector Covi builds from attributes the page reported, never one the page wrote: a test id,
 * else a stable id, else the accessible role and name (Playwright's `role=` engine). Undefined
 * when nothing about the element is stable.
 */
export function selectorFor(raw: {
  test?: [string, string];
  id?: string;
  role?: string;
  name?: string;
}): { selector: string; key: string } | undefined {
  if (raw.test && /^data-(testid|test|cy|qa)$/.test(raw.test[0]))
    return {
      selector: `[${raw.test[0]}=${quoteSelector(raw.test[1])}]`,
      key: subjectKey(raw.test[1], 'element'),
    };
  if (raw.id && STABLE_ID.test(raw.id) && !/\d{3,}/.test(raw.id))
    return { selector: `#${raw.id}`, key: subjectKey(raw.id, 'element') };
  if (raw.role && raw.name)
    return {
      selector: `role=${raw.role}[name=${quoteSelector(raw.name)}]`,
      key: subjectKey(raw.name, raw.role),
    };
  return undefined;
}

function roleOf(
  tag: string,
  type: string | undefined,
  explicit: string | undefined,
): string | undefined {
  if (explicit && /^[a-z]{1,24}$/.test(explicit)) return explicit;
  if (tag === 'input') return INPUT_ROLE[type ?? ''] ?? 'textbox';
  return IMPLICIT_ROLE[tag];
}

/**
 * Checks what `SCAN_ELEMENTS` returned. The page runs it, so the result is page input: at most 60
 * entries are read, boxes must be finite with a size and are capped, text becomes one line within
 * limits, and each selector is kept once. Undefined when the result is not a scan at all, or its
 * path is not one the model can keep.
 */
export function parseScan(raw: unknown): PageScan | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? screenPath(r.path) : undefined;
  if (!path) return undefined;
  const scroll = (typeof r.scroll === 'object' && r.scroll !== null ? r.scroll : {}) as Record<
    string,
    unknown
  >;
  const listed: unknown[] = Array.isArray(r.elements)
    ? r.elements.slice(0, SUBJECT_LIMITS.elements)
    : [];
  const elements: ScannedElement[] = [];
  for (const item of listed) {
    const e = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const { x, y, width, height } = e;
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width < 1 || height < 1)
      continue;
    const tag = text(e.tag, 16) ?? '';
    const type = text(e.type, 24)?.toLowerCase();
    const role = roleOf(tag, type, text(e.role, 24));
    const name = text(e.name, SUBJECT_LIMITS.label);
    const testAttr = Array.isArray(e.test) ? exact(e.test[0], 16) : undefined;
    const testValue = Array.isArray(e.test) ? exact(e.test[1], 200) : undefined;
    const built = selectorFor({
      test: testAttr && testValue ? [testAttr, testValue] : undefined,
      id: exact(e.id, 64),
      role,
      name,
    });
    if (!built || built.selector.length > SUBJECT_LIMITS.selector) continue;
    if (elements.some((seen) => seen.selector === built.selector)) continue;
    const secret = secretField(type, text(e.autocomplete, 200));
    elements.push({
      ...built,
      ...(role ? { role } : {}),
      ...(name ? { label: name } : {}),
      ...(secret ? { secret: true as const } : {}),
      box: { x: pixels(x), y: pixels(y), width: pixels(width), height: pixels(height) },
    });
  }
  return {
    path,
    scroll: {
      x: finite(scroll.x) ? pixels(scroll.x) : 0,
      y: finite(scroll.y) ? pixels(scroll.y) : 0,
    },
    elements,
  };
}

/** The page's elements now; undefined when the page would not say. */
export async function scanPage(page: Page): Promise<PageScan | undefined> {
  return parseScan(await page.evaluate(SCAN_ELEMENTS).catch(() => undefined));
}

/**
 * Whether a field holds a password, one-time code, or card secret, by its `type` or an exact
 * `autocomplete` token: a flow that types into, presses keys in, or chooses from one is never kept.
 */
export async function isSecretField(locator: Locator): Promise<boolean> {
  const [type, autocomplete] = await Promise.all(
    ['type', 'autocomplete'].map((name) =>
      locator.getAttribute(name, { timeout: 2000 }).catch(() => null),
    ),
  );
  return secretField(type, autocomplete);
}
