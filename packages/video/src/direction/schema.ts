import { readFile, stat } from 'node:fs/promises';
import { EVIDENCE_LIMITS, parseOrThrow, UsageError } from '@covi/core';
import { z } from 'zod';
import { TRANSITION_KINDS } from '../storyboard/schema.ts';
import { CAMERA_TRANSITIONS } from '../timeline/types.ts';

/*
 * `video/direction.json`: how the video shows what the storyboard says. Evidence decides what is
 * shown; the agent decides how. The file is untrusted input (an agent writes it, and the
 * repository it read can steer the agent), so every list, string, and number is bounded, every
 * object is strict, content comes only from evidence ids, and the only text an agent writes is a
 * short label from an allowlist.
 */

/** Where the run keeps it; the agent writes it there, as it does the score. */
export const DIRECTION_PATH = 'video/direction.json';

export const DIRECTION_HINT =
  'Run `covi schema direction` for the format, and `covi evidence --run <id>` for the ids a shot may cite.';

/** Every bound on a direction file, in one place. */
export const DIRECTION_LIMITS = {
  fileBytes: 262_144,
  shots: 24,
  elementsPerShot: 8,
  beatsPerShot: 12,
  idChars: 24,
  labelChars: 32,
  /** As a storyboard `sync` phrase. */
  phraseChars: 200,
  /** Storyboard scene ids have no length limit of their own; a shot names one of at most this. */
  sceneIdChars: 64,
  zoom: { min: 1, max: 2.5 },
  /** Lines a code element may show. */
  lineSpan: 40,
  /** Items a pile or a split draws at most (later verbs); the counter shows the true value. */
  drawnItems: 12,
  evidencePerElement: 4,
} as const;

/** An element id: a lowercase letter, then up to 23 lowercase letters, digits, or dashes. */
export const DIRECTION_ID = /^[a-z][a-z0-9-]{0,23}$/;

/** How a scene can enter: the storyboard's transitions and the camera's moves between stops. */
export const ENTRANCE_KINDS = [...TRANSITION_KINDS, ...CAMERA_TRANSITIONS] as const;
export const SHOT_LAYOUTS = ['auto', 'single', 'row', 'column', 'split'] as const;
export const REVEAL_STYLES = ['rise', 'pop', 'wipe', 'type'] as const;
export const CAMERA_MOVES = ['zoom', 'pan', 'follow'] as const;
export const LABEL_TONES = ['neutral', 'warning', 'success'] as const;

export type ShotLayout = (typeof SHOT_LAYOUTS)[number];

/**
 * Letters and marks of any script, spaces, and a little punctuation, with the CJK forms Korean,
 * Japanese, and Chinese labels are written with: no digits and no markup.
 */
const LABEL_CHARS = /^[\p{L}\p{M} \-–—·,.'’:()/&+?!、。・「」『』（）！？：]+$/u;
/**
 * Links and script-running URL schemes, which the allowed characters could otherwise spell. They
 * are looked for in the NFKC form, so full-width letters and colons (`ｗｗｗ.`, `ｈｔｔｐｓ：//`)
 * count as the ASCII they fold to.
 */
const LINK = /:\/\/|\bwww\./i;
const SCRIPT_SCHEME = /\b(?:javascript|vbscript|data)\s*:/i;

/**
 * Text an agent writes for the screen (a node's name, a label). Numbers must come from evidence,
 * so a label has no digits; it has no markup or link characters either, and the runtime sets it
 * as text anyway. Number words cannot be policed in code: the methodology forbids them.
 */
export const LabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(DIRECTION_LIMITS.labelChars)
  .regex(
    LABEL_CHARS,
    "a label is letters, spaces, and - – — · , . ' ’ : ( ) / & + ? ! 、 。 ・ 「 」 『 』 （ ） ！ ？ ： only: no digits, markup, or symbols",
  )
  .refine((text) => {
    const folded = text.normalize('NFKC');
    return !LINK.test(folded) && !SCRIPT_SCHEME.test(folded);
  }, 'a label holds no links');

const SceneRefSchema = z
  .string()
  .min(1)
  .max(DIRECTION_LIMITS.sceneIdChars)
  .regex(/^[a-z0-9-]+$/, 'a storyboard scene id');
const ElementIdSchema = z
  .string()
  .regex(
    DIRECTION_ID,
    'an element id is a lowercase letter, then up to 23 lowercase letters, digits, or dashes',
  );
const EvidenceRefSchema = z.string().min(1).max(EVIDENCE_LIMITS.id);
const PhraseSchema = z
  .string()
  .trim()
  .min(1)
  .max(DIRECTION_LIMITS.phraseChars)
  .describe(
    "A phrase quoted verbatim from the scene's narration that occurs exactly once: the beat lands as it is spoken. Without it, beats are spread through the line in order.",
  );
const LineSchema = z.number().int().min(1).max(100_000);
const LinesSchema = z
  .tuple([LineSchema, LineSchema])
  .refine(([from, to]) => from <= to, 'lines are [from, to] with from ≤ to')
  .refine(
    ([from, to]) => to - from + 1 <= DIRECTION_LIMITS.lineSpan,
    `a code element shows at most ${DIRECTION_LIMITS.lineSpan} lines`,
  )
  .describe('1-based [from, to] within the lines of the side shown.');

export const ShotElementSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ id: ElementIdSchema, kind: z.literal('visual') })
    .describe("The scene's storyboard visual, drawn as it is without direction."),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('code'),
    evidence: EvidenceRefSchema.describe('A diff-hunk: id from `covi evidence --run <id>`.'),
    side: z
      .enum(['head', 'base', 'diff'])
      .optional()
      .describe('head (default): the lines after the change; base: before it; diff: both, marked.'),
    lines: LinesSchema.optional(),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('output'),
    evidence: EvidenceRefSchema.describe(
      "A terminal: id: a demo command's output, or the app's start-up log.",
    ),
    side: z
      .enum(['head', 'base'])
      .optional()
      .describe('head (default): the output after the change; base: before it.'),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('capture'),
    evidence: EvidenceRefSchema.describe('A screenshot: id.'),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('node'),
    label: LabelSchema,
    evidence: z
      .array(EvidenceRefSchema)
      .max(DIRECTION_LIMITS.evidencePerElement)
      .optional()
      .describe('Evidence ids the node stands for.'),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('label'),
    text: LabelSchema,
    tone: z.enum(LABEL_TONES).optional(),
  }),
]);

export const ShotBeatSchema = z.discriminatedUnion('verb', [
  z
    .strictObject({ verb: z.literal('place'), element: ElementIdSchema })
    .describe("The element sits in place from the shot's start (the default, made explicit)."),
  z.strictObject({
    verb: z.literal('reveal'),
    element: ElementIdSchema,
    style: z.enum(REVEAL_STYLES).optional().describe('rise (default), pop, wipe, or type.'),
    at: PhraseSchema.optional(),
  }),
  z.strictObject({
    verb: z.literal('camera'),
    move: z
      .enum(CAMERA_MOVES)
      .describe(
        'zoom: frame the element; pan: center it at the same scale; follow: frame what it highlights.',
      ),
    to: ElementIdSchema,
    zoom: z
      .number()
      .min(DIRECTION_LIMITS.zoom.min)
      .max(DIRECTION_LIMITS.zoom.max)
      .optional()
      .describe('1–2.5; default: fit the element to the region.'),
    at: PhraseSchema.optional(),
  }),
]);

export const ShotSchema = z.strictObject({
  scene: SceneRefSchema.describe('The storyboard scene this shot directs (at most one shot each).'),
  enter: z
    .enum(ENTRANCE_KINDS)
    .optional()
    .describe(
      "How the scene enters: pan or zoom (the camera travels the canvas), or a storyboard transition. Default: the scene's own transition, else Covi's rotation.",
    ),
  layout: z
    .enum(SHOT_LAYOUTS)
    .optional()
    .describe('auto (default), single, row, column, or split.'),
  elements: z.array(ShotElementSchema).min(1).max(DIRECTION_LIMITS.elementsPerShot),
  beats: z.array(ShotBeatSchema).max(DIRECTION_LIMITS.beatsPerShot).default([]),
});

export const DirectionSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  /** True for Covi's default director; an agent sets false after rewriting it. */
  draft: z
    .boolean()
    .default(false)
    .describe("true: Covi's draft, derived again at render; set false once you have rewritten it."),
  shots: z.array(ShotSchema).max(DIRECTION_LIMITS.shots),
});

export type Direction = z.output<typeof DirectionSchema>;
export type DirectionInput = z.input<typeof DirectionSchema>;
export type Shot = z.output<typeof ShotSchema>;
export type ShotElement = z.output<typeof ShotElementSchema>;
export type ShotBeat = z.output<typeof ShotBeatSchema>;

/**
 * Reads the run's direction file, or nothing when the run has none. Its size is bounded before it
 * is parsed, and every schema problem is listed at once (exit 2).
 */
export async function readDirectionFile(path: string): Promise<Direction | undefined> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (size > DIRECTION_LIMITS.fileBytes)
    throw new UsageError(
      `video/direction.json is ${size} bytes; a direction may be at most ${DIRECTION_LIMITS.fileBytes} bytes.`,
      DIRECTION_HINT,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new UsageError(
      `video/direction.json is not valid JSON: ${(error as Error).message}`,
      DIRECTION_HINT,
    );
  }
  return parseOrThrow(DirectionSchema, raw, 'video/direction.json', DIRECTION_HINT);
}
