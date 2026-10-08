import { z } from 'zod';
import { LANGUAGES, type Language, type LanguageSetting } from '../i18n/language.ts';
import { LanguageSettingSchema } from '../i18n/schema.ts';
import { FINDING_CATEGORIES } from '../model/finding.ts';
import { parseDuration } from '../util/duration.ts';

/**
 * Covi configuration. Every key is optional: zero-config runs use DEFAULT_CONFIG, and
 * `.covi/config.yml` only needs the keys a repository wants to change.
 */

const seconds = z.union([z.number().nonnegative(), z.string()]).transform((value, ctx) => {
  try {
    return parseDuration(value);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: (error as Error).message });
    return z.NEVER;
  }
});

const autoOrSeconds = z.union([z.literal('auto'), seconds]);

export const VIDEO_MODES = ['short', 'standard', 'custom'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];
export const NARRATION_PROVIDERS = ['auto', 'system', 'openai', 'elevenlabs', 'none'] as const;
export const INTELLIGENCE_PROVIDERS = ['auto', 'heuristic', 'anthropic', 'command'] as const;
/** Background music: the bundled Covi theme, a score composed for the video, or none. */
export const MUSIC_CHOICES = ['theme', 'compose', 'none'] as const;
export type MusicChoice = (typeof MUSIC_CHOICES)[number];
/**
 * Where music plays: `auto` lets the kind of video decide, `continuous` keeps a quiet bed under
 * the narration, and `bookends` plays it only around the narration (the start, breaths, the end).
 */
export const MUSIC_PLACEMENTS = ['auto', 'continuous', 'bookends'] as const;
export type MusicPlacementSetting = (typeof MUSIC_PLACEMENTS)[number];
export const VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;

/** One step of a scripted browser flow. Exactly one action key per step. */
export const FlowStepSchema = z.union([
  z.strictObject({ goto: z.string() }),
  z.strictObject({ click: z.string(), note: z.string().optional() }),
  z.strictObject({ fill: z.string(), text: z.string(), note: z.string().optional() }),
  z.strictObject({ press: z.string(), selector: z.string().optional() }),
  z.strictObject({ hover: z.string() }),
  z.strictObject({ select: z.string(), value: z.string() }),
  z.strictObject({ check: z.string() }),
  z.strictObject({ scroll: z.union([z.string(), z.number()]) }),
  z.strictObject({ wait: z.union([z.number(), z.string()]) }),
  z.strictObject({
    screenshot: z.string(),
    focus: z.string().optional(),
    note: z.string().optional(),
  }),
]);
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z.strictObject({
  name: z.string().min(1),
  path: z.string().default('/'),
  description: z.string().optional(),
  steps: z.array(FlowStepSchema).default([]),
  viewports: z.array(z.enum(VIEWPORTS)).optional(),
});
export type Flow = z.output<typeof FlowSchema>;

export const DemoCommandSchema = z.strictObject({
  name: z.string().min(1),
  run: z.string().min(1),
  /** Run at base and head (before/after) or only at head. */
  compare: z.boolean().default(true),
  timeout: seconds.optional(),
});
export type DemoCommand = z.output<typeof DemoCommandSchema>;

export const DemoRequestSchema = z.strictObject({
  name: z.string().min(1),
  method: z.string().default('GET'),
  path: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  compare: z.boolean().default(true),
});
export type DemoRequest = z.output<typeof DemoRequestSchema>;

const Spoken = z
  .string()
  .min(1)
  .max(128)
  .refine((v) => !/[\r\n]/.test(v), 'a spoken form is one line');

/** Whether `key` occurs in `text` as a whole token (not glued to another ASCII letter or digit). */
function containsToken(text: string, key: string): boolean {
  const alnum = /[A-Za-z0-9]/;
  let at = text.indexOf(key);
  while (at !== -1) {
    const before = text[at - 1];
    const after = text[at + key.length];
    const startOk = !alnum.test(key[0]!) || !before || !alnum.test(before);
    const endOk = !alnum.test(key.at(-1)!) || !after || !alnum.test(after);
    if (startOk && endOk) return true;
    at = text.indexOf(key, at + 1);
  }
  return false;
}

/**
 * How narration should say a word, for languages whose voices misread it: `CLI: 씨엘아이`, or per
 * language `c2: { ko: 씨투, ja: シーツー }`. Keys match exactly and case-sensitively.
 */
export const PronunciationsSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .refine((k) => k.trim() === k && !/[\r\n]/.test(k), 'no surrounding spaces or line breaks'),
    z.union([
      Spoken,
      z.strictObject(Object.fromEntries(LANGUAGES.map((l) => [l, Spoken.optional()]))),
    ]),
  )
  .superRefine((map, ctx) => {
    const keys = Object.keys(map);
    if (keys.length > 500) ctx.addIssue({ code: 'custom', message: 'at most 500 pronunciations' });
    // A spoken form that contains a key would be rewritten again on the next pass.
    for (const [key, value] of Object.entries(map)) {
      const forms = typeof value === 'string' ? [value] : Object.values(value);
      for (const form of forms) {
        const loop = keys.find((k) => form && containsToken(form, k));
        if (loop)
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `the spoken form "${form}" contains "${loop}", which would be rewritten again`,
          });
      }
    }
  });

export type Pronunciations = Record<string, string | Partial<Record<Language, string>>>;

const NarrationInput = z.union([
  z.boolean(),
  z.strictObject({
    enabled: z.boolean().optional(),
    provider: z.enum(NARRATION_PROVIDERS).optional(),
    voice: z.string().optional(),
    /** Speech rate multiplier, 0.8–1.3. */
    rate: z.number().min(0.8).max(1.3).optional(),
    pronunciations: PronunciationsSchema.optional().describe(
      'How the voice says particular words, e.g. { CLI: 씨엘아이, c2: { ko: 씨투, ja: シーツー } }. Exact, case-sensitive keys; values for every language or per language (en, ko, ja, zh).',
    ),
  }),
]);

/** Partial, strict schema for config files and explicit inputs (typos are errors). */
export const ConfigInputSchema = z.strictObject({
  base: z.string().optional(),
  language: LanguageSettingSchema.optional().describe(
    'Language Covi writes and narrates in: auto (detected from the change), en, ko, ja, or zh (Simplified Chinese).',
  ),
  ignore: z.array(z.string()).optional(),
  intelligence: z
    .strictObject({
      provider: z.enum(INTELLIGENCE_PROVIDERS).optional(),
      model: z.string().optional(),
      command: z.string().optional(),
      maxDiffChars: z.number().int().min(10_000).optional(),
      timeout: seconds.optional(),
    })
    .optional(),
  review: z
    .strictObject({
      failOn: z.enum(['none', 'low', 'medium', 'high']).optional(),
      maxFindings: z.number().int().min(1).max(50).optional(),
      focus: z.array(z.enum(FINDING_CATEGORIES)).optional(),
      disableRules: z.array(z.string()).optional(),
      runTests: z.boolean().optional(),
    })
    .optional(),
  test: z.strictObject({ command: z.string().optional(), timeout: seconds.optional() }).optional(),
  app: z
    .strictObject({
      install: z.string().optional(),
      start: z.string().optional(),
      url: z.string().optional(),
      port: z.number().int().min(1).max(65535).optional(),
      static: z.string().optional(),
      readyPath: z.string().optional(),
      timeout: seconds.optional(),
      env: z.record(z.string(), z.string()).optional(),
      passEnv: z.array(z.string()).optional(),
    })
    .optional(),
  demo: z
    .strictObject({
      pages: z.array(z.string()).optional(),
      flows: z.array(FlowSchema).optional(),
      commands: z.array(DemoCommandSchema).optional(),
      requests: z.array(DemoRequestSchema).optional(),
      viewports: z.array(z.enum(VIEWPORTS)).optional(),
      record: z
        .boolean()
        .optional()
        .describe(
          'Record every browser flow at base and head (MP4 with ffmpeg, else WebM). Default true.',
        ),
    })
    .optional(),
  video: z
    .strictObject({
      when: z.enum(['auto', 'always', 'never']).optional(),
      mode: z.enum(VIDEO_MODES).optional(),
      duration: autoOrSeconds.optional(),
      width: z.number().int().min(240).max(3840).optional(),
      height: z.number().int().min(240).max(3840).optional(),
      fps: z.number().int().min(10).max(60).optional(),
      narration: NarrationInput.optional(),
      captions: z.boolean().optional(),
      theme: z.enum(['light', 'dark']).optional(),
      style: z.enum(['concise', 'explanatory']).optional(),
      mascot: z.boolean().optional(),
      // Objects, not scalars: configuration has no version, so keys can only be added.
      music: z
        .strictObject({
          use: z
            .enum(MUSIC_CHOICES)
            .optional()
            .describe(
              'theme (the bundled Covi theme), compose (a score written for the video), or none.',
            ),
          placement: z
            .enum(MUSIC_PLACEMENTS)
            .optional()
            .describe(
              'auto (the kind of video decides), continuous (a quiet bed under the narration), or bookends (around the narration only).',
            ),
        })
        .optional(),
      soundEffects: z.strictObject({ enabled: z.boolean().optional() }).optional(),
      outro: z
        .boolean()
        .optional()
        .describe(
          'End with the branded Covi outro (true), or hold the last scene for 1 s (false).',
        ),
    })
    .optional(),
  output: z
    .strictObject({
      dir: z.string().optional(),
      keep: z.number().int().min(1).max(1000).optional(),
    })
    .optional(),
  publish: z
    .strictObject({
      comment: z.boolean().optional(),
      annotations: z.boolean().optional(),
      video: z.enum(['link', 'upload', 'none']).optional(),
    })
    .optional(),
});

export type ConfigInput = z.input<typeof ConfigInputSchema>;
export type ParsedConfigInput = z.output<typeof ConfigInputSchema>;

export interface NarrationConfig {
  enabled: boolean;
  provider: (typeof NARRATION_PROVIDERS)[number];
  voice?: string;
  rate: number;
  pronunciations?: Pronunciations;
}

export interface CoviConfig {
  base?: string;
  /** Language of what Covi writes and says; `auto` follows the change's own words. */
  language: LanguageSetting;
  ignore: string[];
  intelligence: {
    provider: (typeof INTELLIGENCE_PROVIDERS)[number];
    model?: string;
    command?: string;
    maxDiffChars: number;
    timeout: number;
  };
  review: {
    failOn: 'none' | 'low' | 'medium' | 'high';
    maxFindings: number;
    focus: Array<(typeof FINDING_CATEGORIES)[number]>;
    disableRules: string[];
    runTests: boolean;
  };
  test: { command?: string; timeout: number };
  app: {
    install?: string;
    start?: string;
    url?: string;
    port?: number;
    static?: string;
    readyPath: string;
    timeout: number;
    env: Record<string, string>;
    passEnv: string[];
  };
  demo: {
    pages: string[];
    flows: Flow[];
    commands: DemoCommand[];
    requests: DemoRequest[];
    viewports: Array<(typeof VIEWPORTS)[number]>;
    /** Record browser flows; recording only happens when a browser runs. */
    record: boolean;
  };
  video: {
    when: 'auto' | 'always' | 'never';
    mode: VideoMode;
    duration: 'auto' | number;
    width?: number;
    height?: number;
    fps: number;
    narration: NarrationConfig;
    captions: boolean;
    theme: 'light' | 'dark';
    style?: 'concise' | 'explanatory';
    mascot: boolean;
    music: { use: MusicChoice; placement: MusicPlacementSetting };
    soundEffects: { enabled: boolean };
    /** The branded outro after the last scene. */
    outro: boolean;
  };
  output: { dir: string; keep: number };
  publish: { comment: boolean; annotations: boolean; video: 'link' | 'upload' | 'none' };
}

/** The global Covi defaults (lowest precedence layer). */
export const DEFAULT_CONFIG: CoviConfig = {
  language: 'auto',
  ignore: [],
  intelligence: { provider: 'auto', maxDiffChars: 120_000, timeout: 300 },
  review: { failOn: 'none', maxFindings: 10, focus: [], disableRules: [], runTests: false },
  test: { timeout: 600 },
  app: { readyPath: '/', timeout: 120, env: {}, passEnv: [] },
  demo: { pages: [], flows: [], commands: [], requests: [], viewports: ['desktop'], record: true },
  video: {
    when: 'auto',
    mode: 'short',
    duration: 'auto',
    fps: 30,
    narration: { enabled: true, provider: 'auto', rate: 1 },
    captions: true,
    theme: 'light',
    mascot: true,
    music: { use: 'theme', placement: 'auto' },
    soundEffects: { enabled: true },
    outro: true,
  },
  output: { dir: '.covi/runs', keep: 20 },
  publish: { comment: true, annotations: true, video: 'link' },
};
