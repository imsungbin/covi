/**
 * The languages Covi writes and speaks. Codes are ISO 639-1; `zh` is Simplified Chinese.
 * Everything that depends on a language (catalogs, speech, captions, fonts) is keyed by these.
 */
export const LANGUAGES = ['en', 'ko', 'ja', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];

/** What configuration and flags accept: a language, or `auto` to detect it. */
export const LANGUAGE_INPUTS = ['auto', 'en', 'ko', 'ja', 'zh', 'zh-CN', 'zh-Hans'] as const;
export type LanguageSetting = 'auto' | Language;

/** BCP 47 tags for Intl APIs and `<html lang>` (the script subtag picks Simplified Han glyphs). */
export const LOCALE: Record<Language, string> = {
  en: 'en',
  ko: 'ko',
  ja: 'ja',
  zh: 'zh-Hans',
};

export const LANGUAGE_NAME: Record<Language, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Simplified Chinese',
};

const ALIASES: Record<string, Language> = {
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-hans-cn': 'zh',
  'zh-sg': 'zh',
  'en-us': 'en',
  'en-gb': 'en',
  'ko-kr': 'ko',
  'ja-jp': 'ja',
};

/**
 * Reads a language code, case-insensitively, with `_` or `-` separators: `zh-CN` and `zh-Hans`
 * are Simplified Chinese. Traditional Chinese (`zh-TW`, `zh-Hant`) is not supported, so it is
 * rejected rather than silently written in Simplified characters.
 */
export function parseLanguage(input: string): Language | undefined {
  const code = input.trim().toLowerCase().replace(/_/g, '-');
  if ((LANGUAGES as readonly string[]).includes(code)) return code as Language;
  return ALIASES[code];
}

export function parseLanguageSetting(input: string): LanguageSetting | undefined {
  return input.trim().toLowerCase() === 'auto' ? 'auto' : parseLanguage(input);
}

export interface ScriptCounts {
  /** Letters in Latin-script words that read as prose (identifiers and code are left out). */
  latin: number;
  hangul: number;
  kana: number;
  han: number;
}

const HANGUL = /\p{Script=Hangul}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

/**
 * Spans that say nothing about the language a person writes in: code, URLs, e-mail addresses,
 * paths, and the `type(scope):` prefix of conventional commits.
 */
const NEUTRAL = [
  /```[\s\S]*?```/g,
  /`[^`\n]*`/g,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?:^|\s)[\w.-]*\/[\w./-]+/g,
  /^\s*\w+(?:\([^)]*\))?!?:\s/gm,
];

/** A Latin token that is an identifier rather than a word: digits, `_`, `.`, inner capitals, or all caps. */
function isIdentifier(token: string): boolean {
  return /[\d_.]/.test(token) || /[a-z][A-Z]/.test(token) || /^[A-Z]{2,}s?$/.test(token);
}

export function countScripts(text: string): ScriptCounts {
  let clean = text;
  for (const pattern of NEUTRAL) clean = clean.replace(pattern, ' ');
  const counts: ScriptCounts = { latin: 0, hangul: 0, kana: 0, han: 0 };
  for (const token of clean.match(/[A-Za-z][\w.'-]*/g) ?? []) {
    if (!isIdentifier(token)) counts.latin += token.replace(/[^A-Za-z]/g, '').length;
  }
  for (const char of clean) {
    if (HANGUL.test(char)) counts.hangul++;
    else if (KANA.test(char)) counts.kana++;
    else if (HAN.test(char)) counts.han++;
  }
  return counts;
}

/**
 * A CJK character carries about as much as three Latin letters. Text is written in a CJK language
 * when its CJK characters weigh at least this share of the prose (identifiers excluded), so a
 * Korean commit like "c2-delegate CLI 추가" counts as Korean.
 */
const CJK_WEIGHT = 3;
const CJK_SHARE = 0.3;

export interface Detection {
  language: Language;
  /** The script that decided it, e.g. `Hangul`. */
  script: 'Hangul' | 'kana' | 'Han' | 'Latin';
  /** Share of the weighted prose in that script, 0–1. */
  share: number;
}

/** The dominant language of some prose, or undefined when there is no prose to judge. */
export function detectLanguage(text: string | readonly string[]): Detection | undefined {
  const all = typeof text === 'string' ? [text] : text;
  const counts: ScriptCounts = { latin: 0, hangul: 0, kana: 0, han: 0 };
  for (const t of all) {
    const c = countScripts(t);
    counts.latin += c.latin;
    counts.hangul += c.hangul;
    counts.kana += c.kana;
    counts.han += c.han;
  }
  const cjk = counts.hangul + counts.kana + counts.han;
  const total = CJK_WEIGHT * cjk + counts.latin;
  if (total === 0) return undefined;
  const share = (CJK_WEIGHT * cjk) / total;
  if (cjk === 0 || share < CJK_SHARE)
    return { language: 'en', script: 'Latin', share: counts.latin / total };
  // Kana appears only in Japanese, Hangul only in Korean; Han alone is Chinese.
  if (counts.hangul > 0 && counts.hangul >= counts.kana)
    return { language: 'ko', script: 'Hangul', share };
  if (counts.kana > 0) return { language: 'ja', script: 'kana', share };
  return { language: 'zh', script: 'Han', share };
}

export interface ResolvedLanguage {
  language: Language;
  /** The configured setting it came from: a language, or `auto`. */
  setting: LanguageSetting;
  /** Why this language, in a sentence (recorded in run.json). */
  source: string;
}

/**
 * The language for text Covi writes: an explicit setting wins; `auto` detects the dominant
 * script of the change's own words (title, description, commit messages), else English.
 */
export function resolveOutputLanguage(
  setting: LanguageSetting,
  settingSource: string,
  texts: { title?: string; description?: string; commits?: readonly string[] },
): ResolvedLanguage {
  if (setting !== 'auto') return { language: setting, setting, source: settingSource };
  const parts = [texts.title, texts.description, ...(texts.commits ?? [])].filter(
    (t): t is string => Boolean(t?.trim()),
  );
  const found = detectLanguage(parts);
  if (!found)
    return {
      language: 'en',
      setting,
      source: 'auto: the change has no title, description, or commit message to detect from',
    };
  const where = [
    texts.title ? 'title' : undefined,
    texts.description ? 'description' : undefined,
    texts.commits?.length ? 'commit messages' : undefined,
  ].filter(Boolean);
  const list = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where.at(-1)}` : where[0];
  return {
    language: found.language,
    setting,
    source:
      found.script === 'Latin'
        ? `auto: the change's ${list} are written in Latin script`
        : `auto: ${found.script} in the change's ${list} (${Math.round(found.share * 100)}% of the prose)`,
  };
}
