import { type FlowStep, SUBJECT_EXPIRE_AFTER, VIEWPORTS } from '../config/schema.ts';
import type { Rect } from '../model/demo.ts';
import {
  type ObservedCommand,
  type ObservedScreen,
  SUBJECT_CONTROL,
  SUBJECT_LIMITS,
  type Subject,
  type SubjectElement,
  type SubjectFlow,
  type SubjectFlowObservation,
  SubjectFlowSchema,
  type SubjectObservation,
  SubjectSchema,
  screenKeyOf,
  screenPath,
  subjectKey,
  uniqueKey,
} from '../model/subject.ts';

/**
 * Words a field's selector or note uses when it holds a secret. A flow that types into one is never
 * kept: the model is committed, and the text a flow types would be committed with it. Matched on
 * whole words so `#passenger-name` or `#footprint` stay ordinary while `#pinCode` does not.
 */
const SECRET_WORDS = new Set([
  'password',
  'passwd',
  'pwd',
  'pass',
  'passcode',
  'passphrase',
  'secret',
  'token',
  'otp',
  'totp',
  'mfa',
  'pin',
  'cvc',
  'cvv',
  'csc',
  'ssn',
  // Compounds written as one word, which no split finds.
  'apikey',
  'cardnum',
  'cardnumber',
  'ccnum',
  'creditcard',
]);
/** Adjacent words that name a secret together; `2fa` splits at its digit, so it is a pair too. */
const SECRET_PHRASES = new Set([
  '2 fa',
  'one time',
  'security code',
  'verification code',
  'card number',
  'card num',
  'credit card',
  'cc number',
  'cc num',
  'cc csc',
  'cc exp',
  'api key',
]);
/** Selector syntax rather than what the field is: `input[name=card]` is a field named card. */
const SELECTOR_WORDS = new Set([
  'input',
  'textarea',
  'name',
  'id',
  'data',
  'testid',
  'test',
  'aria',
  'label',
  'placeholder',
  'role',
  'textbox',
  'field',
  'type',
  'text',
]);
const CONTROLS = new RegExp(`${SUBJECT_CONTROL.source}+`, 'g');

export function emptySubject(): Subject {
  return { schemaVersion: 1, revisions: [], screens: [], flows: [], commands: [] };
}

export function hasObservations(observation: SubjectObservation): boolean {
  return observation.screens.length + observation.flows.length + observation.commands.length > 0;
}

/** Lowercase words, split at anything not a letter or digit, at camelCase, and at digits. */
function words(text: string): string[] {
  return text
    .replace(/([a-z])(?=[A-Z])/g, '$1 ')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .replace(/([A-Za-z])(?=[0-9])|([0-9])(?=[A-Za-z])/g, '$1$2 ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function namesSecret(text: string, selector: boolean): boolean {
  const all = words(text);
  if (all.some((w, i) => SECRET_WORDS.has(w) || SECRET_PHRASES.has(`${w} ${all[i + 1]}`)))
    return true;
  // Alone, `card` names a card field; beside other words it is usually a pricing card or the like.
  const own = selector ? all.filter((w) => !SELECTOR_WORDS.has(w)) : all;
  return own.length === 1 && own[0] === 'card';
}

/** The field a step types into, presses keys in, or chooses from, when it names one. */
function fieldOf(step: FlowStep): string | undefined {
  if ('fill' in step) return step.fill;
  if ('press' in step) return step.selector;
  if ('select' in step) return step.select;
  return undefined;
}

/**
 * A step that types into, presses keys in, or chooses from a secret field: one its selector or note
 * names as secret, or one whose selector is an element the page marked secret (`secretSelectors`).
 * A key pressed without a selector goes to the focused field, which only capture can see.
 */
export function actsOnSecret(
  step: FlowStep,
  secretSelectors: ReadonlySet<string> = new Set(),
): boolean {
  const field = fieldOf(step);
  if (field === undefined) return false;
  return (
    secretSelectors.has(field) ||
    namesSecret(field, true) ||
    ('note' in step && step.note !== undefined && namesSecret(step.note, false))
  );
}

/** Why a flow is or is not remembered; a warning names the flow and this, never its values. */
export type FlowOutcome = 'kept' | 'failed' | 'secret' | 'invalid';

const FlowEntrySchema = SubjectFlowSchema.omit({ key: true, passed: true });

/** The flow as the model keeps it, without its key and revision, or why it is not kept. */
function flowEntry(
  flow: SubjectFlowObservation,
  secretSelectors: ReadonlySet<string>,
):
  | { outcome: 'kept'; entry: Omit<SubjectFlow, 'key' | 'passed'> }
  | { outcome: Exclude<FlowOutcome, 'kept'> } {
  // Only a flow that passed at head is worth replaying; one that types a secret is never kept.
  if (!flow.passed) return { outcome: 'failed' };
  if (flow.secret || flow.steps.some((s) => actsOnSecret(s.action, secretSelectors)))
    return { outcome: 'secret' };
  const candidate = FlowEntrySchema.safeParse({
    name: oneLine(flow.name, SUBJECT_LIMITS.label),
    path: flow.path,
    viewport: flow.viewport,
    steps: flow.steps.map((s) => {
      const label = oneLine(s.label, SUBJECT_LIMITS.label);
      return { action: s.action, ...(label ? { label } : {}) };
    }),
  });
  // No name, too many steps, a value over the limit or on several lines, or a goto off the app:
  // not a flow Covi would replay.
  return candidate.success ? { outcome: 'kept', entry: candidate.data } : { outcome: 'invalid' };
}

/** Whether the model would remember this flow, given the selectors of fields marked secret. */
export function flowKept(
  flow: SubjectFlowObservation,
  secretSelectors: ReadonlySet<string> = new Set(),
): FlowOutcome {
  return flowEntry(flow, secretSelectors).outcome;
}

/** Page or user text as one line within a limit; undefined when nothing is left. */
function oneLine(text: string | undefined, max: number): string | undefined {
  const t = text?.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  // The limit counts UTF-16 units; never keep half of a surrogate pair.
  const cut = t.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '');
  return `${cut}…`;
}

/** Page geometry is page input too: whole pixels within the schema's range, whatever it reported. */
const pixels = (n: number) =>
  Number.isFinite(n) ? Math.min(100_000, Math.max(0, Math.round(n))) : 0;
const boxOf = (r: Rect, seen: string) => ({
  x: pixels(r.x),
  y: pixels(r.y),
  width: Math.max(1, pixels(r.width)),
  height: Math.max(1, pixels(r.height)),
  seen,
});
const byKey = <T extends { key: string }>(a: T, b: T) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
const keepsSelector = (selector: string) =>
  selector.length > 0 &&
  selector.length <= SUBJECT_LIMITS.selector &&
  !SUBJECT_CONTROL.test(selector);

function upsertScreen(model: Subject, seen: ObservedScreen, revision: string): void {
  const path = screenPath(seen.path);
  if (!path) return;
  let screen = model.screens.find((s) => s.path === path);
  if (!screen) {
    screen = {
      key: uniqueKey(screenKeyOf(path), new Set(model.screens.map((s) => s.key))),
      path,
      viewports: [],
      elements: [],
      seen: revision,
    };
    model.screens.push(screen);
  }
  screen.seen = revision;
  const title = oneLine(seen.title, SUBJECT_LIMITS.label);
  if (title) screen.title = title;
  // One entry per viewport, in preset order; its size is the one seen last.
  const size = {
    name: seen.viewport,
    width: Math.max(1, pixels(seen.size.width)),
    height: Math.max(1, pixels(seen.size.height)),
  };
  const known = screen.viewports;
  screen.viewports = VIEWPORTS.flatMap((v) =>
    v === seen.viewport ? [size] : known.filter((k) => k.name === v),
  );
  const bySelector = new Map(screen.elements.map((e) => [e.selector, e]));
  const taken = new Set(screen.elements.map((e) => e.key));
  const observed = new Set<SubjectElement>();
  for (const el of seen.elements) {
    if (!keepsSelector(el.selector)) continue;
    let entry = bySelector.get(el.selector);
    if (entry && observed.has(entry)) continue;
    if (!entry) {
      entry = {
        key: uniqueKey(subjectKey(el.key, 'element'), taken),
        selector: el.selector,
        boxes: {},
        seen: revision,
      };
      taken.add(entry.key);
      bySelector.set(entry.selector, entry);
      screen.elements.push(entry);
    }
    entry.seen = revision;
    const role = el.role && /^[a-z]{1,24}$/.test(el.role) ? el.role : undefined;
    const label = oneLine(el.label, SUBJECT_LIMITS.label);
    if (role) entry.role = role;
    else delete entry.role;
    if (label) entry.label = label;
    else delete entry.label;
    if (el.secret) entry.secret = true;
    else delete entry.secret;
    entry.boxes[seen.viewport] = boxOf(el.box, revision);
    observed.add(entry);
  }
  // What the screen shows now comes first, so the element cap keeps it over what it used to show.
  screen.elements = [...observed, ...screen.elements.filter((e) => !observed.has(e))];
}

/** Selectors of the fields the model marks secret, on any screen. */
function secretSelectorsOf(model: Subject): Set<string> {
  return new Set(
    model.screens.flatMap((s) => s.elements.filter((e) => e.secret).map((e) => e.selector)),
  );
}

/**
 * The secret fields the merge judges a run's flows by: the model's, once these screens are merged
 * into it. Capture asks the same before it lets a flow's frames into an observation, so a flow the
 * merge will drop gives the model nothing it saw.
 */
export function secretSelectors(
  model: Subject,
  screens: readonly ObservedScreen[] = [],
): Set<string> {
  if (screens.length === 0) return secretSelectorsOf(model);
  const next = structuredClone(model);
  // The revision is only stamped on entries of this throwaway copy.
  for (const screen of screens) upsertScreen(next, screen, '');
  return secretSelectorsOf(next);
}

function upsertFlow(model: Subject, flow: SubjectFlowObservation, revision: string): FlowOutcome {
  const judged = flowEntry(flow, secretSelectorsOf(model));
  if (judged.outcome !== 'kept') return judged.outcome;
  const { entry } = judged;
  const existing = model.flows.find((f) => f.name === entry.name);
  const key =
    existing?.key ??
    uniqueKey(subjectKey(entry.name, 'flow'), new Set(model.flows.map((f) => f.key)));
  const kept = { key, ...entry, passed: revision };
  if (existing) model.flows[model.flows.indexOf(existing)] = kept;
  else model.flows.push(kept);
  return 'kept';
}

function upsertCommand(model: Subject, seen: ObservedCommand, revision: string): void {
  const name = oneLine(seen.name, SUBJECT_LIMITS.label);
  if (!name) return;
  const existing = model.commands.find((c) => c.kind === seen.kind && c.name === name);
  const http = seen.kind === 'http';
  // The path without its query: a query can carry a token, and the model is committed.
  const path = http && seen.path ? screenPath(seen.path) : undefined;
  const { status, exitCode } = seen;
  const entry = {
    key:
      existing?.key ??
      uniqueKey(subjectKey(name, seen.kind), new Set(model.commands.map((c) => c.key))),
    kind: seen.kind,
    name,
    ...(http && seen.method && /^[A-Za-z]{1,10}$/.test(seen.method)
      ? { method: seen.method.toUpperCase() }
      : {}),
    ...(path ? { path } : {}),
    ...(http && status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
    ...(!http && exitCode !== undefined && (exitCode === null || Number.isInteger(exitCode))
      ? { exitCode }
      : {}),
    seen: revision,
  };
  if (existing) model.commands[model.commands.indexOf(existing)] = entry;
  else model.commands.push(entry);
}

/** Drops entries (and per-viewport boxes) last seen at a revision the model no longer keeps. */
function expire(model: Subject): Subject {
  const live = new Set(model.revisions);
  return {
    ...model,
    screens: model.screens
      .filter((s) => live.has(s.seen))
      .map((s) => ({
        ...s,
        elements: s.elements
          .filter((e) => live.has(e.seen))
          .map((e) => ({
            ...e,
            boxes: Object.fromEntries(
              Object.entries(e.boxes).filter(([, b]) => b && live.has(b.seen)),
            ),
          })),
      })),
    flows: model.flows.filter((f) => live.has(f.passed)),
    commands: model.commands.filter((c) => live.has(c.seen)),
  };
}

const bytes = (model: Subject) => Buffer.byteLength(`${JSON.stringify(model, null, 2)}\n`);

/** Caps every list, then the file size; what was seen longest ago goes first. Sorted by key. */
function bound(model: Subject): Subject {
  const age = (revision: string) => model.revisions.indexOf(revision);
  // Stable sorts: among equally recent entries, the order they had (what was just seen first) wins.
  const newestFirst = <T>(items: readonly T[], seen: (item: T) => string) =>
    [...items].sort((a, b) => age(seen(a)) - age(seen(b)));
  const out: Subject = {
    ...model,
    screens: newestFirst(model.screens, (s) => s.seen)
      .slice(0, SUBJECT_LIMITS.screens)
      .map((s) => ({
        ...s,
        elements: newestFirst(s.elements, (e) => e.seen).slice(0, SUBJECT_LIMITS.elements),
      })),
    flows: newestFirst(model.flows, (f) => f.passed).slice(0, SUBJECT_LIMITS.flows),
    commands: newestFirst(model.commands, (c) => c.seen).slice(0, SUBJECT_LIMITS.commands),
  };
  // A dropped entry's own JSON is shorter than its share of the indented file, so this stops at or
  // under the budget, never over it.
  let size = bytes(out);
  while (size > SUBJECT_LIMITS.bytes && (out.screens.length > 0 || out.flows.length > 0)) {
    const dropped = out.screens.length > 0 ? out.screens.pop() : out.flows.pop();
    size -= Buffer.byteLength(JSON.stringify(dropped, null, 2));
  }
  return {
    ...out,
    screens: out.screens.map((s) => ({ ...s, elements: [...s.elements].sort(byKey) })).sort(byKey),
    flows: [...out.flows].sort(byKey),
    commands: [...out.commands].sort(byKey),
  };
}

/** One observed flow and whether the model now remembers it. */
export interface FlowMerge {
  /** The flow's name as one line; absent when it had none. */
  name?: string;
  outcome: FlowOutcome;
}

/**
 * Merges what one run saw at head into the model: entries are upserted by identity (screen path,
 * element selector, flow name, scenario kind and name) and keep the key they were given; the run's
 * revision moves to the front of `revisions`, which keeps `expireAfter` of them; whatever was last
 * seen at a revision no longer kept is forgotten. A run that saw nothing changes nothing. Also says
 * what became of each observed flow, so a run can warn about one it could not remember.
 */
export function mergeSubjectWithOutcomes(
  current: Subject,
  observation: SubjectObservation,
  options: { expireAfter: number },
): { model: Subject; flows: FlowMerge[] } {
  if (!hasObservations(observation)) return { model: current, flows: [] };
  // A missing or broken setting falls back to the default rather than forgetting everything.
  const expireAfter = Number.isFinite(options.expireAfter)
    ? Math.floor(options.expireAfter)
    : SUBJECT_EXPIRE_AFTER;
  const keep = Math.min(SUBJECT_LIMITS.revisions, Math.max(1, expireAfter));
  const model: Subject = structuredClone(current);
  model.revisions = [
    observation.revision,
    ...current.revisions.filter((r) => r !== observation.revision),
  ].slice(0, keep);
  for (const screen of observation.screens) upsertScreen(model, screen, observation.revision);
  // After the screens, so a field this run saw marked secret counts for its flows.
  const flows = observation.flows.map((flow): FlowMerge => {
    const name = oneLine(flow.name, SUBJECT_LIMITS.label);
    return { ...(name ? { name } : {}), outcome: upsertFlow(model, flow, observation.revision) };
  });
  for (const command of observation.commands) upsertCommand(model, command, observation.revision);
  // Checked like everything Covi writes: a model its own loader would reject is never returned.
  return { model: SubjectSchema.parse(bound(expire(model))), flows };
}

/** `mergeSubjectWithOutcomes` for callers that need only the model. */
export function mergeSubject(
  current: Subject,
  observation: SubjectObservation,
  options: { expireAfter: number },
): Subject {
  return mergeSubjectWithOutcomes(current, observation, options).model;
}
