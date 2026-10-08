import { readFileSync } from 'node:fs';
import {
  agreeingParticle,
  detectLanguage,
  LANGUAGE_NAME,
  type Language,
  PARTICLES,
  parseLanguage,
  parseOrThrow,
  resourcePath,
} from '@covi/core';
import { parse } from 'yaml';
import { z } from 'zod';
import { stripEmphasis } from '../storyboard/grammar.ts';

/**
 * Speech normalization: the text a voice should read, derived from the narration right before
 * synthesis. Speech engines for Korean, Japanese, and Chinese read Latin acronyms as if they were
 * words ("CLI" as 클리), so Latin tokens are rewritten into the spoken form a person would use
 * (씨엘아이). Captions keep the narration exactly as written. The function is pure and
 * idempotent, and it runs for every storyboard, drafted or authored.
 */

/** User pronunciations: one spoken form for every language, or one per language. */
export type Pronunciations = Record<string, string | Partial<Record<Language, string>>>;

export type SpeechRule = 'pronunciation' | 'word' | 'letters' | 'particle';

export interface SpeechChange {
  from: string;
  to: string;
  rule: SpeechRule;
}

export interface SpokenText {
  text: string;
  changes: SpeechChange[];
}

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

export const SpeechTableSchema = z.strictObject({
  language: z.enum(['ko', 'ja', 'zh']),
  /** Joins spelled letters: '' for 씨엘아이, ' ' for "C L I". */
  separator: z.enum(['', ' ']),
  letters: z
    .record(z.string().regex(/^[A-Z]$/), z.string().min(1).max(12))
    .refine((m) => LETTERS.every((l) => m[l]), 'every letter A–Z needs a spoken form'),
  words: z.record(z.string().min(1).max(32), z.string().min(1).max(64)).default({}),
});
export type SpeechTable = z.output<typeof SpeechTableSchema>;

const tables = new Map<Language, SpeechTable | undefined>();

/** The letter names and built-in words for a language (none for English: its voices spell acronyms). */
export function speechTable(language: Language): SpeechTable | undefined {
  if (language === 'en') return undefined;
  if (!tables.has(language)) {
    const file = resourcePath('templates', 'speech', `${language}.yml`);
    const table = parseOrThrow(
      SpeechTableSchema,
      parse(readFileSync(file, 'utf8')),
      `templates/speech/${language}.yml`,
    );
    if (table.language !== language)
      throw new Error(`templates/speech/${language}.yml declares language ${table.language}`);
    tables.set(language, table);
  }
  return tables.get(language);
}

type SpanKind = 'code' | 'path' | 'url' | 'email' | 'version' | 'redacted';

const EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|mdx|css|scss|less|html?|py|go|rs|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|sql|txt|lock|xml|svg|png|jpe?g|vue|svelte|env|ini|cfg|conf';

/**
 * Spans that must reach the voice unchanged. Code and paths are identifiers: Covi's own rewriting
 * leaves them alone, but a user pronunciation still applies inside them. URLs, e-mail addresses,
 * versions, and redaction marks are never rewritten.
 */
const SPANS: Array<[SpanKind, RegExp]> = [
  ['code', /`[^`\n]+`/g],
  ['redacted', /\[REDACTED\]/g],
  ['url', /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}。、，]/gi],
  ['email', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ['version', /(?<![\w.])v?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.]*[0-9A-Za-z])?(?![\w])/g],
  // Paths: a slash with lowercase letters or dots (CI/CD and TCP/IP are acronyms, not paths).
  ['path', /(?<![\w./~-])(?:~|\.{1,2})?\/?(?:[\w@.-]+\/)+[\w@.-]*/g],
  ['path', new RegExp(`(?<![\\w/.-])[\\w-]+(?:\\.[\\w-]+)*\\.(?:${EXTENSIONS})(?![\\w])`, 'g')],
  ['path', /(?<![\w/.])\.[A-Za-z][\w-]*(?:\.[\w-]+)*/g],
];

function isPath(text: string): boolean {
  return /[a-z.]/.test(text) || /^[/~]/.test(text);
}

interface Piece {
  text: string;
  kind: 'plain' | SpanKind;
  /** Already rewritten (or deliberately kept); later steps skip it. */
  done?: boolean;
}

/** Splits text into plain prose and protected spans (earliest, then longest match wins). */
function split(text: string): Piece[] {
  const found: Array<{ start: number; end: number; kind: SpanKind }> = [];
  for (const [kind, pattern] of SPANS) {
    for (const m of text.matchAll(pattern)) {
      if (kind === 'path' && m[0].includes('/') && !isPath(m[0])) continue;
      found.push({ start: m.index, end: m.index + m[0].length, kind });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const pieces: Piece[] = [];
  let at = 0;
  for (const span of found) {
    if (span.start < at) continue;
    if (span.start > at) pieces.push({ text: text.slice(at, span.start), kind: 'plain' });
    pieces.push({ text: text.slice(span.start, span.end), kind: span.kind });
    at = span.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), kind: 'plain' });
  return pieces;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALNUM = /[A-Za-z0-9]/;

/** A Korean particle right after a rewritten word, captured so it can be made to agree. */
const PARTICLE = `(?:(${PARTICLES.flat()
  .sort((a, b) => b.length - a.length)
  .join('|')})(?![가-힣]))?`;

/** Matches any of `keys` as a whole token: not glued to another ASCII letter or digit. */
function keyPattern(keys: readonly string[], korean: boolean): RegExp | undefined {
  if (!keys.length) return undefined;
  const alternatives = [...keys]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map((k) => {
      const before = ALNUM.test(k[0]!) ? '(?<![A-Za-z0-9])' : '';
      const after = ALNUM.test(k.at(-1)!) ? '(?![A-Za-z0-9])' : '';
      return `${before}${escapeRegExp(k)}${after}`;
    });
  return new RegExp(`(${alternatives.join('|')})${korean ? PARTICLE : ''}`, 'g');
}

/**
 * Rewrites matches of `pattern` in the pieces `eligible` allows. `spell` returns the spoken form
 * of a match, or undefined to leave it alone.
 */
function rewrite(
  pieces: Piece[],
  eligible: (p: Piece) => boolean,
  pattern: RegExp,
  spell: (token: string) => string | undefined,
  rule: SpeechRule,
  changes: SpeechChange[],
): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    if (piece.done || !eligible(piece)) {
      out.push(piece);
      continue;
    }
    let at = 0;
    for (const m of piece.text.matchAll(pattern)) {
      const token = m[1]!;
      const spoken = spell(token);
      if (spoken === undefined || spoken === token) continue;
      if (m.index > at) out.push({ text: piece.text.slice(at, m.index), kind: piece.kind });
      let text = spoken;
      changes.push({ from: token, to: spoken, rule });
      const attached = m[2];
      if (attached) {
        const agreed = agreeingParticle(spoken, attached);
        const to = agreed?.to ?? attached;
        if (to !== attached) changes.push({ from: attached, to, rule: 'particle' });
        text += to;
      }
      out.push({ text, kind: piece.kind, done: true });
      at = m.index + m[0].length;
    }
    if (at === 0) out.push(piece);
    else if (at < piece.text.length) out.push({ text: piece.text.slice(at), kind: piece.kind });
  }
  return out;
}

const TOKEN = /(?<![A-Za-z0-9])([A-Za-z0-9]+)(?![A-Za-z0-9])/g;
const TOKEN_KO = new RegExp(`${TOKEN.source}${PARTICLE}`, 'g');

/** Letter-by-letter spelling of an all-caps token (2–6 letters, a plural `s`, or digits). */
function spellLetters(token: string, table: SpeechTable): string | undefined {
  const spell = (letters: string) =>
    [...letters].map((l) => table.letters[l]).join(table.separator);
  const join = (a: string, b: string) => (table.separator ? `${a} ${b}` : `${a}${b}`);
  let m = /^([A-Z]{2,6})s?$/.exec(token);
  if (m) return spell(m[1]!);
  m = /^([A-Z]{1,6})(\d+)$/.exec(token);
  if (m) return join(spell(m[1]!), m[2]!);
  m = /^(\d+)([A-Z]{1,6})$/.exec(token);
  if (m) return join(m[1]!, spell(m[2]!));
  return undefined;
}

/** The pronunciations that apply to a language, keyed by the exact text they replace. */
export function pronunciationsFor(
  pronunciations: Pronunciations | undefined,
  language: Language,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(pronunciations ?? {})) {
    const spoken = typeof value === 'string' ? value : value[language];
    if (spoken) map.set(key, spoken);
  }
  return map;
}

export interface SpeechOptions {
  language: Language;
  pronunciations?: Pronunciations;
}

/**
 * The text to send to the voice. In priority order: the user's pronunciations, then the built-in
 * words (JSON → 제이슨), then letter-by-letter spelling of all-caps acronyms (CLI → 씨엘아이).
 * English voices spell acronyms themselves, so English text only gets the user's pronunciations.
 */
export function normalizeSpeech(text: string, options: SpeechOptions): SpokenText {
  const { language } = options;
  const changes: SpeechChange[] = [];
  const korean = language === 'ko';
  const prose = (p: Piece) => p.kind === 'plain';
  let pieces = split(text);

  const user = pronunciationsFor(options.pronunciations, language);
  const userPattern = keyPattern([...user.keys()], korean);
  if (userPattern)
    pieces = rewrite(
      pieces,
      (p) => p.kind === 'plain' || p.kind === 'code' || p.kind === 'path',
      userPattern,
      (t) => user.get(t),
      'pronunciation',
      changes,
    );

  const table = speechTable(language);
  if (table) {
    const words = new Map(Object.entries(table.words));
    const wordPattern = keyPattern([...words.keys()], korean);
    if (wordPattern)
      pieces = rewrite(pieces, prose, wordPattern, (t) => words.get(t), 'word', changes);
    pieces = rewrite(
      pieces,
      prose,
      korean ? TOKEN_KO : TOKEN,
      (t) => spellLetters(t, table),
      'letters',
      changes,
    );
  }
  return { text: pieces.map((p) => p.text).join(''), changes };
}

/**
 * All-caps Latin tokens (two or more letters) a voice would still have to guess at, outside URLs,
 * e-mail addresses, versions, and redaction marks. Used by QC for non-English narration.
 */
export function unspokenAcronyms(text: string): string[] {
  const out = new Set<string>();
  for (const piece of split(text)) {
    if (piece.kind !== 'plain' && piece.kind !== 'code' && piece.kind !== 'path') continue;
    for (const m of piece.text.matchAll(TOKEN)) {
      const letters = m[1]!.replace(/\d/g, '').replace(/(?<=[A-Z]{2})s$/, '');
      if (letters.length >= 2 && /^[A-Z]+$/.test(letters)) out.add(m[1]!);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------
// Which language the narration is spoken in
// ---------------------------------------------------------------------------------------------

/** The language a voice speaks, from its locale (`ko_KR`, `en-us`, `cmn`). */
export function localeLanguage(locale: string | undefined): Language | undefined {
  if (!locale) return undefined;
  const code = locale.toLowerCase().replace(/_/g, '-');
  if (/^(cmn|yue|zh)\b/.test(code)) return 'zh';
  return parseLanguage(code.split('-')[0]!);
}

export interface SpeechLanguageInput {
  /** `--language` (or COVI_LANGUAGE): the user's explicit choice for this command. */
  flag?: Language;
  /** The storyboard's declared `language`. */
  storyboard?: Language;
  /** What the voice will read (all scenes). */
  text: readonly string[];
  /** `language` from configuration when it names a language (not `auto`). */
  configured?: Language;
  /** The configured system voice's locale, when known. */
  voiceLocale?: string;
}

export interface SpeechLanguage {
  language: Language;
  source: string;
  /** Nothing named or showed a language, so this is the English default. */
  fallback?: boolean;
}

/**
 * The narration speaks the language its text is written in. In order: the --language flag, the
 * storyboard's declared language, the script of the narration itself (Hangul, kana, or Han), the
 * configured language, the system voice's locale, then English. Hosted voices are multilingual,
 * so their voice names say nothing about the language.
 */
export function resolveSpeechLanguage(input: SpeechLanguageInput): SpeechLanguage {
  if (input.flag) return { language: input.flag, source: '--language' };
  if (input.storyboard)
    return { language: input.storyboard, source: 'the storyboard declares its language' };
  const detected = detectLanguage(input.text);
  if (detected && detected.language !== 'en')
    return {
      language: detected.language,
      source: `${detected.script} in the narration (${Math.round(detected.share * 100)}%)`,
    };
  if (input.configured) return { language: input.configured, source: 'language in configuration' };
  const voice = localeLanguage(input.voiceLocale);
  if (voice) return { language: voice, source: `the voice's locale (${input.voiceLocale})` };
  return {
    language: 'en',
    source: detected ? 'Latin-script narration' : 'no narration language found; English',
    fallback: true,
  };
}

export function languageName(language: Language): string {
  return LANGUAGE_NAME[language];
}

export type SpokenScene = SpeechRecord['scenes'][number];

/** What each scene's voice is given: its `say` (or narration), normalized for the language. */
export function speakScenes(
  scenes: ReadonlyArray<{ id?: string; narration: string; say?: string }>,
  options: SpeechOptions & { redact?: (text: string) => string },
): SpokenScene[] {
  return scenes.map((scene, i) => {
    // `[[…]]` marks the caption's emphasis; the voice and speech.json get the words alone.
    const narration = stripEmphasis(scene.narration);
    const say = scene.say === undefined ? undefined : stripEmphasis(scene.say);
    const normalized = normalizeSpeech((say ?? narration).trim(), options);
    return {
      id: scene.id ?? `s${i + 1}`,
      narration,
      say,
      spoken: options.redact ? options.redact(normalized.text) : normalized.text,
      changes: normalized.changes,
    };
  });
}

/** `video/speech.json`: what each scene's voice was given, and why in that language. */
export interface SpeechRecord {
  schemaVersion: 1;
  /** Whether a voice spoke the text (false for captions-only videos). */
  narrated: boolean;
  language: Language;
  /** Why this language (see resolveSpeechLanguage). */
  source: string;
  voice?: { provider: string; name: string; locale?: string };
  scenes: Array<{
    id: string;
    /** What the captions show. */
    narration: string;
    /** The scene's authored spoken form, when it has one. */
    say?: string;
    /** The text sent to the voice. */
    spoken: string;
    changes: SpeechChange[];
  }>;
}
