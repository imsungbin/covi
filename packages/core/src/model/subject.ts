import { z } from 'zod';
import { type FlowStep, FlowStepSchema, VIEWPORTS } from '../config/schema.ts';
import type { Rect } from './demo.ts';

/**
 * The subject model: what Covi has seen of the software across runs. Screens by app path (and the
 * viewport sizes they were seen at), the elements on them (a selector Covi built, a role, a label,
 * a box per viewport), flows that passed, and the CLI and HTTP scenarios that ran. It is kept in
 * the repository by default, so it is untrusted input like the rest of it: it holds no command
 * line, every string is one bounded line without control characters, and every list is capped.
 */
export const SUBJECT_LIMITS = {
  /** The serialized file. */
  bytes: 512 * 1024,
  revisions: 100,
  screens: 100,
  /** Per screen, and per indexed image. */
  elements: 60,
  flows: 50,
  steps: 30,
  commands: 50,
  images: 200,
  selector: 300,
  label: 120,
  path: 500,
  /** A flow step's values, such as the text it types. */
  value: 500,
} as const;

/** Lowercase letters, digits, and dashes: how references name screens and elements. */
export const SUBJECT_KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** `subject:<screen>#<element>`, e.g. `subject:checkout#place-order`. */
export const SUBJECT_REF = /^subject:([a-z0-9][a-z0-9-]{0,47})#([a-z0-9][a-z0-9-]{0,47})$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function parseSubjectRef(ref: string): { screen: string; element: string } | undefined {
  const match = SUBJECT_REF.exec(ref);
  return match ? { screen: match[1]!, element: match[2]! } : undefined;
}

/** A key from free text (`Start trial` → `start-trial`), at most 40 characters before a suffix. */
export function subjectKey(text: string, fallback: string): string {
  const key = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return key || fallback;
}

/** `base` if free, else `base-2`, `base-3`…: keys, once given, are never reused for another entry. */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

/**
 * A screen's identity: the app path without query, fragment, or trailing slash. An absolute URL
 * keeps only its path: the model never names another origin.
 */
export function screenPath(url: string): string {
  let path: string;
  try {
    path = new URL(url, 'http://app.invalid').pathname;
  } catch {
    return '/';
  }
  return path.replace(/\/+$/, '') || '/';
}

/** A screen's key from its path: `/` is `home`. */
export function screenKeyOf(path: string): string {
  return subjectKey(path, 'home');
}

const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !CONTROL.test(v), 'one line, without control characters');
const Key = z.string().regex(SUBJECT_KEY, 'lowercase letters, digits, and dashes');
const Revision = z.string().regex(/^[0-9a-f]{7,40}$/, 'a commit SHA');
const AppPath = line(SUBJECT_LIMITS.path).refine(
  (v) => v.startsWith('/') && !v.startsWith('//'),
  'a path on the app, starting with one /',
);
const Viewport = z.enum(VIEWPORTS);
const Pixels = z.number().int().min(0).max(100_000);
const Size = z.number().int().min(1).max(100_000);

export const SubjectRefSchema = z
  .string()
  .regex(SUBJECT_REF, 'subject:<screen>#<element>, e.g. subject:checkout#place-order');

const BoxSchema = z.strictObject({
  x: Pixels,
  y: Pixels,
  width: Size,
  height: Size,
  seen: Revision,
});

export const SubjectElementSchema = z.strictObject({
  key: Key,
  selector: line(SUBJECT_LIMITS.selector),
  role: z
    .string()
    .regex(/^[a-z]{1,24}$/)
    .optional(),
  label: line(SUBJECT_LIMITS.label).optional(),
  secret: z.literal(true).optional().describe('A password, one-time code, or card field.'),
  boxes: z
    .partialRecord(Viewport, BoxSchema)
    .describe('Where it was, per viewport: image pixels from the top of the page.'),
  seen: Revision,
});

/** A viewport a screen was seen at, and its size then in CSS pixels. */
export const SubjectViewportSchema = z.strictObject({ name: Viewport, width: Size, height: Size });

export const SubjectScreenSchema = z.strictObject({
  key: Key,
  path: AppPath,
  title: line(SUBJECT_LIMITS.label).optional(),
  viewports: z.array(SubjectViewportSchema).max(VIEWPORTS.length),
  elements: z.array(SubjectElementSchema).max(SUBJECT_LIMITS.elements),
  seen: Revision,
});

/** A flow step as the model keeps it: single-line values, and `goto` stays on the app. */
const SubjectStepSchema = FlowStepSchema.refine(
  (step) =>
    Object.values(step).every(
      (v) => typeof v !== 'string' || (v.length <= SUBJECT_LIMITS.value && !CONTROL.test(v)),
    ),
  'step values are single lines of at most 500 characters',
).refine(
  (step) => !('goto' in step) || (step.goto.startsWith('/') && !step.goto.startsWith('//')),
  'goto stays on the app: a path starting with one /',
);

export const SubjectFlowSchema = z.strictObject({
  key: Key,
  name: line(SUBJECT_LIMITS.label),
  path: AppPath,
  viewport: Viewport,
  steps: z
    .array(
      z.strictObject({ action: SubjectStepSchema, label: line(SUBJECT_LIMITS.label).optional() }),
    )
    .max(SUBJECT_LIMITS.steps),
  /** The last revision it passed at. */
  passed: Revision,
});

/** A CLI or HTTP scenario: its name and outcome, never the command line that ran it. */
export const SubjectCommandSchema = z.strictObject({
  key: Key,
  kind: z.enum(['cli', 'http']),
  name: line(SUBJECT_LIMITS.label),
  method: z
    .string()
    .regex(/^[A-Z]{1,10}$/)
    .optional(),
  path: AppPath.optional(),
  status: z.number().int().min(100).max(599).optional(),
  exitCode: z.number().int().nullable().optional(),
  seen: Revision,
});

export const SubjectSchema = z
  .strictObject({
    schemaVersion: z.literal(1).default(1),
    revisions: z
      .array(Revision)
      .max(SUBJECT_LIMITS.revisions)
      .default([])
      .describe('The revisions that updated the model, newest first.'),
    screens: z.array(SubjectScreenSchema).max(SUBJECT_LIMITS.screens).default([]),
    flows: z.array(SubjectFlowSchema).max(SUBJECT_LIMITS.flows).default([]),
    commands: z.array(SubjectCommandSchema).max(SUBJECT_LIMITS.commands).default([]),
  })
  .superRefine((model, ctx) => {
    const unique = <T>(
      items: readonly T[],
      field: keyof T & string,
      what: string,
      path: Array<string | number>,
    ) => {
      const seen = new Set<unknown>();
      items.forEach((item, i) => {
        const key = item[field];
        if (seen.has(key))
          ctx.addIssue({
            code: 'custom',
            path: [...path, i, field],
            message: `duplicate ${what} "${String(key)}"`,
          });
        seen.add(key);
      });
    };
    unique(model.screens, 'key', 'screen key', ['screens']);
    model.screens.forEach((s, i) => {
      unique(s.viewports, 'name', 'viewport', ['screens', i, 'viewports']);
      unique(s.elements, 'key', 'element key', ['screens', i, 'elements']);
    });
    unique(model.flows, 'key', 'flow key', ['flows']);
    unique(model.commands, 'key', 'command key', ['commands']);
  });

export type Subject = z.output<typeof SubjectSchema>;
export type SubjectElement = z.output<typeof SubjectElementSchema>;
export type SubjectViewport = z.output<typeof SubjectViewportSchema>;
export type SubjectScreen = z.output<typeof SubjectScreenSchema>;
export type SubjectFlow = z.output<typeof SubjectFlowSchema>;
export type SubjectCommand = z.output<typeof SubjectCommandSchema>;

/** Where each element is in one head capture, in that image's pixels. */
export const SubjectImageSchema = z.strictObject({
  path: line(SUBJECT_LIMITS.path),
  screen: Key,
  viewport: Viewport,
  elements: z
    .array(z.strictObject({ key: Key, x: Pixels, y: Pixels, width: Size, height: Size }))
    .max(SUBJECT_LIMITS.elements),
});
export type SubjectImage = z.output<typeof SubjectImageSchema>;

/** `demo/subject.json`: the model as this run left it, and its head captures indexed. */
export const SubjectSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  store: z.enum(['repo', 'runs']),
  revision: Revision,
  model: SubjectSchema,
  images: z.array(SubjectImageSchema).max(SUBJECT_LIMITS.images).default([]),
});
export type SubjectSnapshot = z.output<typeof SubjectSnapshotSchema>;

type Viewport = (typeof VIEWPORTS)[number];

/** What one run saw at head, before it is merged. Boxes in image pixels from the top of the page. */
export interface ObservedElement {
  selector: string;
  /** The key the element would like (from its test id, id, or name); the model makes it unique. */
  key: string;
  role?: string;
  label?: string;
  secret?: boolean;
  box: Rect;
}

export interface ObservedScreen {
  path: string;
  title?: string;
  viewport: Viewport;
  /** The viewport's size in CSS pixels when the screen was seen. */
  size: { width: number; height: number };
  elements: ObservedElement[];
}

/** A flow as the model learns it; capture's `ObservedFlow` is one run's outcome, trace, and video. */
export interface SubjectFlowObservation {
  name: string;
  path: string;
  viewport: Viewport;
  steps: Array<{ action: FlowStep; label?: string }>;
  passed: boolean;
  /** It typed into a secret field; such a flow is never kept. */
  secret?: boolean;
}

export interface ObservedCommand {
  kind: 'cli' | 'http';
  name: string;
  method?: string;
  path?: string;
  status?: number;
  exitCode?: number | null;
}

export interface SubjectObservation {
  /** The head revision (12 hex characters). */
  revision: string;
  screens: ObservedScreen[];
  flows: SubjectFlowObservation[];
  commands: ObservedCommand[];
}
