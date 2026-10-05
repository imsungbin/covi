import type { CoviConfig, Language, VideoMode } from '@covi/core';
import { detectLanguage, parseDuration, t } from '@covi/core';

/**
 * Video intent → a concrete, renderable spec. Strong defaults per mode; explicit requests win;
 * CI never asks. Interactive agents ask only what is missing (see `planVideo`).
 */
export interface VideoSpec {
  mode: VideoMode;
  width: number;
  height: number;
  fps: number;
  /** Target length in seconds, and the window QC accepts. */
  duration: { target: number; min: number; max: number; auto: boolean };
  narration: {
    enabled: boolean;
    provider: CoviConfig['video']['narration']['provider'];
    voice?: string;
    rate: number;
  };
  captions: boolean;
  style: 'concise' | 'explanatory';
  theme: 'light' | 'dark';
  mascot: boolean;
  /** A language the request named ("a Korean video"); it wins over the run's language. */
  language?: Language;
}

export const MODE_PRESETS: Record<
  'short' | 'standard',
  {
    width: number;
    height: number;
    target: number;
    min: number;
    max: number;
    style: VideoSpec['style'];
  }
> = {
  short: { width: 1080, height: 1920, target: 28, min: 20, max: 35, style: 'concise' },
  standard: { width: 1920, height: 1080, target: 80, min: 60, max: 120, style: 'explanatory' },
};

export type Orientation = 'vertical' | 'landscape' | 'square';

export function orientationOf(width: number, height: number): Orientation {
  if (Math.abs(width - height) / Math.max(width, height) < 0.1) return 'square';
  return height > width ? 'vertical' : 'landscape';
}

/** What a person (or agent) asked for, before defaults. */
export interface VideoRequest {
  mode?: VideoMode;
  width?: number;
  height?: number;
  duration?: number | 'auto';
  narration?: boolean;
  captions?: boolean;
  theme?: 'light' | 'dark';
  style?: 'concise' | 'explanatory';
  /** A language the request names: "in Korean", "한국어로", "日本語で", "用中文". */
  language?: Language;
}

export interface ParsedRequest {
  request: VideoRequest;
  /** Human-readable reasons for each inferred field, e.g. `mode: "vertical"`. */
  inferred: Record<string, string>;
}

const NUMBER_WORDS: Record<string, number> = {
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  'one-minute': 60,
  'two-minute': 120,
  'a minute': 60,
  'one minute': 60,
  'two minutes': 120,
};

/** Language names in English, Korean, Japanese, and Chinese. */
const LANGUAGE_WORDS: Array<[Language, string]> = [
  ['ko', 'korean|한국어|韓国語|韩语|韩文'],
  ['ja', 'japanese|일본어|日本語|日语|日文'],
  ['zh', 'chinese|mandarin|중국어|中国語|中文|汉语|普通话|简体中文'],
  ['en', 'english|영어|英語|英文|英语'],
];

/** Phrases that ask for a language explicitly, not merely mention one. */
function requestedLanguage(t: string): { language: Language; phrase: string } | undefined {
  for (const [language, names] of LANGUAGE_WORDS) {
    const patterns = [
      new RegExp(`\\b(?:in|into)\\s+(?:${names})\\b`),
      new RegExp(
        `\\b(?:${names})\\s+(?:video|narration|narrated|voice(?:over)?|captions?|subtitles?|version)\\b`,
      ),
      new RegExp(`(?:${names})\\s*(?:로|으로|버전|영상|내레이션|나레이션|음성|자막)`),
      new RegExp(`(?:${names})\\s*(?:で|の(?:動画|ナレーション|音声|字幕))`),
      new RegExp(`(?:用|以|说)\\s*(?:${names})|(?:${names})\\s*(?:视频|旁白|配音|字幕|版)`),
    ];
    for (const re of patterns) {
      const m = re.exec(t);
      if (m) return { language, phrase: m[0].trim() };
    }
  }
  return undefined;
}

/**
 * Reads video intent from natural language so "Make a 30-second vertical review video" (or
 * "30초 세로 영상", "30秒の縦動画", "30秒竖屏视频") needs no follow-up questions. Only unambiguous
 * phrases are interpreted.
 */
export function parseVideoRequest(text: string): ParsedRequest {
  const t = ` ${text.toLowerCase().replace(/[“”"「」]/g, ' ')} `;
  const request: VideoRequest = {};
  const inferred: Record<string, string> = {};
  const hit = (re: RegExp) => re.exec(t)?.[0]?.trim();

  const size = /(\d{3,4})\s*[x×]\s*(\d{3,4})/.exec(t);
  if (size) {
    request.width = Number(size[1]);
    request.height = Number(size[2]);
    request.mode = 'custom';
    inferred.mode = `size "${size[0]}"`;
  }
  /** Applies the first pattern that matches and records which phrase implied the field. */
  const firstHit = (field: string, patterns: Array<[RegExp, (r: VideoRequest) => void]>) => {
    for (const [re, apply] of patterns) {
      const phrase = hit(re);
      if (!phrase) continue;
      apply(request);
      inferred[field] = `"${phrase}"`;
      return;
    }
  };
  if (!request.mode) {
    firstHit('mode', [
      [
        /\b(vertical|portrait|9:16|9x16|short[- ]form|shorts|reels?|tiktok|mobile)\b|세로|숏폼|쇼츠|릴스|縦|ショート動画|リール|竖屏|竖版|竖向|短视频/,
        (r) => {
          r.mode = 'short';
        },
      ],
      [
        /\b(horizontal|landscape|16:9|16x9|widescreen|standard|full[- ]length|walkthrough|in[- ]depth)\b|가로|와이드|横長|横向き|横型|横屏|横版|横向|宽屏/,
        (r) => {
          r.mode = 'standard';
        },
      ],
      [
        /\b(square|1:1)\b|정사각|正方形|方形/,
        (r) => {
          r.mode = 'custom';
          r.width = 1080;
          r.height = 1080;
        },
      ],
    ]);
  }

  const secs = /(\d{1,3}(?:\.\d+)?)\s*[- ]?\s*(seconds?|secs?|s|minutes?|mins?|m)\b/.exec(t);
  // 30초, 1분 30초, 30秒, 1分半, 1分钟30秒, 2分钟.
  const cjk =
    /(?:(\d{1,3})\s*(?:분|分钟|分)\s*(반|半)?\s*)?(?:(\d{1,3}(?:\.\d+)?)\s*(?:초|秒钟|秒))?/g;
  const cjkHit = [...t.matchAll(cjk)].find((m) => m[1] || m[3]);
  if (cjkHit && !secs) {
    const minutes = Number(cjkHit[1] ?? 0) + (cjkHit[2] ? 0.5 : 0);
    request.duration = minutes * 60 + Number(cjkHit[3] ?? 0);
    inferred.duration = `"${cjkHit[0].trim()}"`;
  } else if (secs) {
    const value = Number(secs[1]);
    request.duration = /^m/.test(secs[2]!) ? value * 60 : value;
    inferred.duration = `"${secs[0].trim()}"`;
  } else {
    for (const [word, value] of Object.entries(NUMBER_WORDS)) {
      if (
        new RegExp(`\\b${word}[- ]?(second|minute|sec|min)`).test(t) ||
        (word.includes('minute') && t.includes(` ${word} `))
      ) {
        request.duration = value;
        inferred.duration = `"${word}"`;
        break;
      }
    }
  }
  if (typeof request.duration === 'number' && !request.mode) {
    request.mode = request.duration <= 45 ? 'short' : 'standard';
    inferred.mode = `${request.duration}s suggests ${request.mode === 'short' ? 'short-form' : 'a standard review'}`;
  }
  firstHit('narration', [
    [
      /\b(no|without|silent|mute[d]?)\s*(narration|voice(over)?|audio)\b|\bsilent\b|(?:내레이션|나레이션|음성|소리)\s*(?:없|빼|끄)|무음|(?:ナレーション|音声)\s*(?:なし|無し|不要|なしで)|無音|(?:无|不要|没有|去掉)\s*(?:旁白|配音|语音|声音)|静音|无声/,
      (r) => {
        r.narration = false;
      },
    ],
    [
      /\b(narrat\w*|voice(over)?)\b|내레이션|나레이션|ナレーション|旁白|配音/,
      (r) => {
        r.narration = true;
      },
    ],
  ]);
  firstHit('captions', [
    [
      /\b(no|without)\s+(captions|subtitles)\b|자막\s*(?:없|빼|끄)|字幕\s*(?:なし|無し|不要)|(?:无|不要|没有|去掉)\s*字幕/,
      (r) => {
        r.captions = false;
      },
    ],
  ]);
  firstHit('theme', [
    [
      /\bdark( mode| theme)?\b|다크|어두운|ダーク|深色|暗色|暗黑/,
      (r) => {
        r.theme = 'dark';
      },
    ],
    [
      /\blight( mode| theme)\b|라이트\s*(?:모드|테마)|밝은|ライト(?:モード|テーマ)|浅色|亮色/,
      (r) => {
        r.theme = 'light';
      },
    ],
  ]);
  const named = requestedLanguage(t);
  if (named) {
    request.language = named.language;
    inferred.language = `"${named.phrase}"`;
  }
  return { request, inferred };
}

/** Resolves config + explicit request into a concrete spec (no questions asked). */
export function resolveVideoSpec(config: CoviConfig, request: VideoRequest = {}): VideoSpec {
  const v = config.video;
  const mode = request.mode ?? v.mode;
  const preset = mode === 'custom' ? undefined : MODE_PRESETS[mode];
  let width = request.width ?? v.width ?? preset?.width;
  let height = request.height ?? v.height ?? preset?.height;
  if (mode === 'custom' && (!width || !height)) {
    // Custom without a size: keep whatever was given and fill the other side to 16:9.
    width ??= height ? Math.round((height * 16) / 9) : 1920;
    height ??= Math.round((width * 9) / 16);
  }
  width = even(width ?? 1080);
  height = even(height ?? 1920);

  const requested = request.duration ?? v.duration;
  const orientation = orientationOf(width, height);
  // A custom size takes its timing from the closest preset: square and vertical videos are feed
  // formats (short); landscape ones are walkthroughs (standard).
  const base = preset ?? (orientation === 'landscape' ? MODE_PRESETS.standard : MODE_PRESETS.short);
  let duration: VideoSpec['duration'];
  if (requested === 'auto') {
    duration = { target: base.target, min: base.min, max: base.max, auto: true };
  } else {
    const target = Math.max(5, Math.min(600, requested));
    const slack = Math.max(2, target * 0.15);
    duration = { target, min: Math.max(4, target - slack), max: target + slack, auto: false };
  }

  return {
    mode,
    width,
    height,
    fps: v.fps,
    duration,
    narration: {
      enabled: request.narration ?? v.narration.enabled,
      provider: v.narration.provider,
      voice: v.narration.voice,
      rate: v.narration.rate,
    },
    captions: request.captions ?? v.captions,
    style:
      request.style ??
      v.style ??
      preset?.style ??
      (duration.target > 45 ? 'explanatory' : 'concise'),
    theme: request.theme ?? v.theme,
    mascot: v.mascot,
    ...(request.language ? { language: request.language } : {}),
  };
}

/** The request that reproduces a spec (used to re-render a drafted video with the same settings). */
export function requestFromSpec(spec: VideoSpec): VideoRequest {
  return {
    mode: spec.mode,
    width: spec.width,
    height: spec.height,
    duration: spec.duration.auto ? 'auto' : spec.duration.target,
    narration: spec.narration.enabled,
    captions: spec.captions,
    theme: spec.theme,
    style: spec.style,
    ...(spec.language ? { language: spec.language } : {}),
  };
}

/**
 * The spec for re-rendering: what was chosen when the storyboard was drafted, with the new
 * request on top. Choosing a different mode resets the size, length, and style that came with it.
 */
export function respecVideo(
  config: CoviConfig,
  saved: VideoSpec | undefined,
  request: VideoRequest,
  /** Config keys set explicitly for this command (flags, COVI_*): those win over the saved spec. */
  explicit: ReadonlySet<string> = new Set(),
): VideoSpec {
  if (!saved) return resolveVideoSpec(config, request);
  const { width, height, duration, style, ...rest } = requestFromSpec(saved);
  const base =
    request.mode && request.mode !== saved.mode
      ? rest
      : { ...rest, width, height, duration, style };
  const spec = resolveVideoSpec(config, { ...base, ...request });
  // The frame rate and voice are not part of a request; keep them as drafted unless set now.
  const given = (key: string) => [...explicit].some((k) => k === key || k.startsWith(`${key}.`));
  if (!given('video.fps')) spec.fps = saved.fps;
  if (!given('video.narration'))
    spec.narration = {
      ...spec.narration,
      provider: saved.narration.provider,
      voice: saved.narration.voice,
      rate: saved.narration.rate,
    };
  return spec;
}

function even(n: number): number {
  // H.264 with yuv420p needs even dimensions.
  return Math.max(2, Math.round(n / 2) * 2);
}

export interface VideoQuestion {
  id: 'mode' | 'duration' | 'size';
  question: string;
  header: string;
  options: Array<{ value: string; label: string; description: string }>;
}

export interface VideoPlan {
  spec: VideoSpec;
  inferred: Record<string, string>;
  /** Fields nobody specified (request, flags, or repository config). */
  missing: Array<'mode' | 'duration' | 'size'>;
  /** Minimal, intention-oriented questions an interactive agent may ask. Empty in CI. */
  questions: VideoQuestion[];
  /** A size is known (request, flags, or configuration), so choosing Custom needs no size question. */
  sizeKnown: boolean;
}

/** The questions in a language (English by default, as the constants below). */
export function videoQuestion(id: VideoQuestion['id'], language: Language = 'en'): VideoQuestion {
  const say = (key: string) => t(language, `question.${id}.${key}`);
  if (id === 'mode')
    return {
      id,
      header: say('header'),
      question: say('question'),
      options: (['short', 'standard', 'custom'] as const).map((value) => ({
        value,
        label: say(value),
        description: say(`${value}Description`),
      })),
    };
  if (id === 'duration')
    return {
      id,
      header: say('header'),
      question: say('question'),
      options: (['15', '30', '60', 'auto'] as const).map((value) => {
        const key = value === 'auto' ? 'auto' : `s${value}`;
        return { value, label: say(key), description: say(`${key}Description`) };
      }),
    };
  return {
    id,
    header: say('header'),
    question: say('question'),
    options: (
      [
        ['1080x1920', '1080×1920', 'vertical'],
        ['1920x1080', '1920×1080', 'landscape'],
        ['1080x1080', '1080×1080', 'square'],
      ] as const
    ).map(([value, label, key]) => ({ value, label, description: say(key) })),
  };
}

export const MODE_QUESTION: VideoQuestion = {
  id: 'mode',
  header: 'Video type',
  question: 'What kind of video should Covi create?',
  options: [
    {
      value: 'short',
      label: 'Short-form',
      description: 'Vertical 9:16, about 30 seconds, concise',
    },
    {
      value: 'standard',
      label: 'Standard review',
      description: '16:9, 60–120 seconds, more explanatory',
    },
    { value: 'custom', label: 'Custom', description: 'Choose the size, length, and narration' },
  ],
};

export const DURATION_QUESTION: VideoQuestion = {
  id: 'duration',
  header: 'Length',
  question: 'How long?',
  options: [
    { value: '15', label: '~15 sec', description: 'Just the key moment' },
    { value: '30', label: '~30 sec', description: 'The change and one review note' },
    { value: '60', label: '~60 sec', description: 'Room to explain why it matters' },
    { value: 'auto', label: 'Let Covi decide', description: 'Fit the length to the change' },
  ],
};

export const SIZE_QUESTION: VideoQuestion = {
  id: 'size',
  header: 'Size',
  question: 'Which size should the custom video be?',
  options: [
    { value: '1080x1920', label: '1080×1920', description: 'Vertical' },
    { value: '1920x1080', label: '1920×1080', description: 'Landscape' },
    { value: '1080x1080', label: '1080×1080', description: 'Square' },
  ],
};

/**
 * Plans a video from a natural-language request plus explicit flags. `provided` names the fields
 * that came from flags or repository config, so they never trigger questions.
 */
export function planVideo(
  config: CoviConfig,
  options: {
    text?: string;
    explicit?: VideoRequest;
    provided?: Iterable<string>;
    interactive: boolean;
    /** The language to ask in: the run's, unless the request itself is written in another. */
    language?: Language;
  },
): VideoPlan {
  const parsed = options.text ? parseVideoRequest(options.text) : { request: {}, inferred: {} };
  const written = options.text ? detectLanguage(options.text)?.language : undefined;
  const asking = written && written !== 'en' ? written : (options.language ?? 'en');
  const ask = (id: VideoQuestion['id']) => videoQuestion(id, asking);
  const request: VideoRequest = { ...parsed.request, ...stripUndefined(options.explicit ?? {}) };
  const provided = new Set(options.provided ?? []);
  for (const key of Object.keys(stripUndefined(options.explicit ?? {}))) provided.add(key);
  for (const key of Object.keys(parsed.request)) provided.add(key);

  const missing: VideoPlan['missing'] = [];
  if (!provided.has('mode')) missing.push('mode');
  if (!provided.has('duration')) missing.push('duration');
  const mode = request.mode ?? config.video.mode;
  const sizeKnown = Boolean(
    (request.width && request.height) || (config.video.width && config.video.height),
  );
  if (mode === 'custom' && !sizeKnown) missing.push('size');

  // Short and standard imply a length; a custom size does not, so its length is worth asking.
  const questions: VideoQuestion[] = [];
  if (options.interactive) {
    if (missing.includes('mode')) questions.push(ask('mode'));
    if (missing.includes('duration') && (missing.includes('mode') || mode === 'custom'))
      questions.push(ask('duration'));
    if (missing.includes('size')) questions.push(ask('size'));
  }
  return {
    spec: resolveVideoSpec(config, request),
    inferred: parsed.inferred,
    missing,
    questions,
    sizeKnown,
  };
}

/** Questions that an answer makes necessary: choosing Custom without a known size needs one. */
export function followUpQuestions(
  plan: Pick<VideoPlan, 'sizeKnown'>,
  answers: Partial<Record<VideoQuestion['id'], string>>,
  asked: Iterable<VideoQuestion['id']>,
  language: Language = 'en',
): VideoQuestion[] {
  const done = new Set(asked);
  return answers.mode === 'custom' && !plan.sizeKnown && !done.has('size')
    ? [videoQuestion('size', language)]
    : [];
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Applies answers to the questions (values from the option lists) to a request. */
export function applyAnswers(
  request: VideoRequest,
  answers: Partial<Record<VideoQuestion['id'], string>>,
): VideoRequest {
  const next = { ...request };
  if (answers.mode) next.mode = answers.mode as VideoMode;
  if (answers.duration)
    next.duration = answers.duration === 'auto' ? 'auto' : parseDuration(answers.duration);
  if (answers.size) {
    const [w, h] = answers.size.split('x').map(Number);
    next.width = w;
    next.height = h;
  }
  return next;
}
