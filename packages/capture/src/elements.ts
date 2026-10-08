import { type Rect, SUBJECT_CONTROL, SUBJECT_LIMITS, screenPath, subjectKey } from '@covi/core';
import type { Locator, Page } from 'playwright';

/** What a screen is known by: what a user acts on, and the headings that name its regions. */
const PICK =
  'a[href],button,input:not([type=hidden]),select,textarea,summary,[role],[data-testid],[data-test],[data-cy],[data-qa],h1,h2,h3';

/** Nodes one scan may visit, elements and the text read for their names together. */
const SCAN_VISITS = 10_000;
/** How long a scan may take, in-page and counting its selectors, before it is given up. */
const SCAN_TIMEOUT = 5000;
/** How long reading a field's attributes may take; the page runs it, so it can stall. */
const FIELD_TIMEOUT = 2000;

/**
 * Lists the page's elements worth keeping (at most 60, in document order) with the attributes a
 * stable selector is built from, and boxes in CSS pixels from the top of the page. A name is
 * computed roughly as Playwright's role engine does (`scanPage` keeps it only when it finds the
 * element). Text a flow may have typed is never read: not a field's value, and not the text inside
 * an editable element, whether as the element's own name, inside a wrapper, or as a label. The
 * scan stops after `SCAN_VISITS` nodes, so a page cannot make it walk forever. Written as a string
 * because this package compiles without DOM types.
 */
export const SCAN_ELEMENTS = `(() => {
  let visits = ${SCAN_VISITS};
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  const TEST = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
  const SKIP = ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'];
  const typed = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || el.isContentEditable || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(el.getAttribute('role'));
  const read = (root) => {
    let out = '';
    const walk = (n) => {
      if (--visits < 0 || out.length > 200) return;
      if (n.nodeType === 3) { out += n.data; return; }
      if (n.nodeType !== 1 || typed(n) || SKIP.includes(n.tagName) || n.hidden
        || n.getAttribute('aria-hidden') === 'true') return;
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (n.tagName === 'IMG') { out += ' ' + (n.getAttribute('alt') || '') + ' '; return; }
      for (const child of n.childNodes) walk(child);
    };
    if (root) walk(root);
    return clean(out);
  };
  const out = [];
  for (const el of document.querySelectorAll(${JSON.stringify(PICK)})) {
    if (--visits < 0 || out.length >= ${SUBJECT_LIMITS.elements}) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const test = TEST.find((a) => el.hasAttribute(a));
    const type = (el.getAttribute('type') || '').toLowerCase();
    const field = typed(el);
    const button = el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(type);
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
      .slice(0, 8).map((id) => read(document.getElementById(id))).join(' ');
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const name = clean(el.getAttribute('aria-label')) || clean(labelledBy) || read(forLabel)
      || (field ? read(el.closest('label')) : '')
      || (button ? clean(el.value) : field ? '' : read(el))
      || clean(el.getAttribute('title'))
      || (field && !button ? clean(el.getAttribute('placeholder')) : '');
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

/**
 * The first element's `type` and `autocomplete`, without waiting for one to appear. It runs in
 * the page, so its parameter is typed by what it uses rather than the DOM's `Element`.
 */
const fieldAttributes = (elements: Array<{ getAttribute(name: string): string | null }>) =>
  elements[0] ? [elements[0].getAttribute('type'), elements[0].getAttribute('autocomplete')] : null;

/** `type` and `autocomplete` of the focused element, inside shadow roots too: keys go there. */
const FOCUSED_ATTRIBUTES = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el ? [el.getAttribute('type'), el.getAttribute('autocomplete')] : null;
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

/** Page text as one line within a limit, without control characters such as terminal escapes. */
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

/** Whether `type` and `autocomplete` say a field holds a password, one-time code, or card. */
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

interface Candidate {
  selector: string;
  key: string;
}

/**
 * The selectors Covi can build from attributes the page reported, never one the page wrote, best
 * first: a test id, a stable id, then the accessible role and exact name (Playwright's `role=`
 * engine, with `s` so `Go` does not also find `Go back`).
 */
function candidatesFor(raw: {
  test?: [string, string];
  id?: string;
  role?: string;
  name?: string;
}): Candidate[] {
  const out: Candidate[] = [];
  if (raw.test && /^data-(testid|test|cy|qa)$/.test(raw.test[0]))
    out.push({
      selector: `[${raw.test[0]}=${quoteSelector(raw.test[1])}]`,
      key: subjectKey(raw.test[1], 'element'),
    });
  if (raw.id && STABLE_ID.test(raw.id) && !/\d{3,}/.test(raw.id))
    out.push({ selector: `#${raw.id}`, key: subjectKey(raw.id, 'element') });
  if (raw.role && raw.name)
    out.push({
      selector: `role=${raw.role}[name=${quoteSelector(raw.name)}s]`,
      key: subjectKey(raw.name, raw.role),
    });
  return out.filter((c) => c.selector.length <= SUBJECT_LIMITS.selector);
}

/** The best selector for an element; undefined when nothing about it is stable. */
export function selectorFor(raw: {
  test?: [string, string];
  id?: string;
  role?: string;
  name?: string;
}): Candidate | undefined {
  return candidatesFor(raw)[0];
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

interface ReadElement extends Omit<ScannedElement, 'selector' | 'key'> {
  candidates: Candidate[];
}

/**
 * Checks what `SCAN_ELEMENTS` returned. The page runs it, so the result is page input: at most 60
 * entries are read, boxes must be finite with a size and are capped, and text becomes one line
 * within limits. Undefined when the result is not a scan at all, or its path is not one the model
 * can keep.
 */
function readScan(
  raw: unknown,
): (Omit<PageScan, 'elements'> & { elements: ReadElement[] }) | undefined {
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
  const elements: ReadElement[] = [];
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
    const candidates = candidatesFor({
      test: testAttr && testValue ? [testAttr, testValue] : undefined,
      id: exact(e.id, 64),
      role,
      name,
    });
    if (candidates.length === 0) continue;
    const secret = secretField(type, text(e.autocomplete, 200));
    elements.push({
      candidates,
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

/** One element per selector, each with the first of its candidates that `usable` accepts. */
function choose(elements: ReadElement[], usable: (selector: string) => boolean): ScannedElement[] {
  const chosen: ScannedElement[] = [];
  const taken = new Set<string>();
  for (const { candidates, ...rest } of elements) {
    const pick = candidates.find((c) => !taken.has(c.selector) && usable(c.selector));
    if (!pick) continue;
    taken.add(pick.selector);
    chosen.push({ ...pick, ...rest });
  }
  return chosen;
}

/**
 * `SCAN_ELEMENTS`'s result checked as page input, each element with its best selector, kept
 * once. Without a page to count in, a selector is not known to find exactly one element; `scanPage`
 * checks that.
 */
export function parseScan(raw: unknown): PageScan | undefined {
  const read = readScan(raw);
  return read && { ...read, elements: choose(read.elements, () => true) };
}

/** Settles with the work's result, or undefined when it fails or outlasts `ms`. */
async function within<T>(ms: number, work: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, ms, undefined);
  });
  try {
    return await Promise.race([work().catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The page's elements now; undefined when the page would not say in time. Each element keeps the
 * first of its selectors that finds exactly one element on the page: a duplicated id or test id
 * falls back to the role and name, and a name Covi computed differently from Playwright (or one
 * two elements share) finds none or several, so the element is left out.
 */
export async function scanPage(page: Page, timeout = SCAN_TIMEOUT): Promise<PageScan | undefined> {
  return within(timeout, async () => {
    const read = readScan(await page.evaluate(SCAN_ELEMENTS));
    if (!read) return undefined;
    const selectors = [
      ...new Set(read.elements.flatMap((e) => e.candidates.map((c) => c.selector))),
    ];
    const counts = await Promise.all(
      selectors.map((selector) =>
        page
          .locator(selector)
          .count()
          .catch(() => 0),
      ),
    );
    const unique = new Set(selectors.filter((_, i) => counts[i] === 1));
    return { ...read, elements: choose(read.elements, (selector) => unique.has(selector)) };
  });
}

/**
 * `[type, autocomplete]` as the page reported it, judged by `secretField`. `null` means no element
 * to judge. Anything else (a page that threw, stalled past its time, or returned something odd)
 * counts as secret: a flow is kept only when its fields were seen to be ordinary.
 */
function secretAttributes(raw: unknown): boolean {
  if (raw === null) return false;
  if (!Array.isArray(raw)) return true;
  const [type, autocomplete] = raw;
  return secretField(
    typeof type === 'string' ? type.slice(0, 64) : null,
    typeof autocomplete === 'string' ? autocomplete.slice(0, 500) : null,
  );
}

/**
 * Whether a field holds a password, one-time code, or card secret, by its `type` or an exact
 * `autocomplete` token: a flow that types into, presses keys in, or chooses from one is never kept.
 * It does not wait for the field; the caller waits as the step would. A field the page does not
 * report in time counts as secret.
 */
export async function isSecretField(locator: Locator): Promise<boolean> {
  return secretAttributes(await within(FIELD_TIMEOUT, () => locator.evaluateAll(fieldAttributes)));
}

/**
 * Whether the element that has focus, in any frame, is a secret field: a key pressed without a
 * selector goes there, so a flow can type a password key by key. A frame that does not report in
 * time counts as secret.
 */
export async function isFocusSecret(page: Page): Promise<boolean> {
  const focused = await Promise.all(
    page.frames().map((frame) => within(FIELD_TIMEOUT, () => frame.evaluate(FOCUSED_ATTRIBUTES))),
  );
  return focused.some(secretAttributes);
}
