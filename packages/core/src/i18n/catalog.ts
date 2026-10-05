import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resourcePath } from '../resources.ts';
import { joinList } from '../util/text.ts';
import { applyParticles } from './korean.ts';
import { type Language, LOCALE } from './language.ts';

/**
 * Message catalogs: every fixed string Covi writes for people, per language, as data in
 * `templates/i18n/<language>.yml`. Keys nest in YAML and are addressed with dots
 * (`report.explanation.behavior`). A message is a string with `{name}` placeholders, or a plural
 * map (`one`, `other`, …, chosen with Intl.PluralRules from the `count` parameter). Korean
 * messages may carry particle markers such as `{을/를}`, resolved against the text before them.
 */

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];
export type Message = string | ({ other: string } & Partial<Record<PluralCategory, string>>);
export type Catalog = ReadonlyMap<string, Message>;
export type Params = Record<string, string | number>;

const PLACEHOLDER = /\{([A-Za-z][\w]*)\}/g;

function isPlural(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.includes('other') &&
    keys.every((k) => (PLURAL_CATEGORIES as readonly string[]).includes(k)) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

/** Flattens a parsed catalog into dotted keys, rejecting anything that is not a message. */
export function flattenCatalog(tree: unknown, label: string): Map<string, Message> {
  const out = new Map<string, Message>();
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string' || isPlural(node)) {
      if (!path) throw new Error(`${label}: the catalog must be a map of messages`);
      out.set(path, node);
      return;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node))
      throw new Error(`${label}: ${path || 'the catalog'} is not a message or a group of messages`);
    for (const [key, child] of Object.entries(node)) {
      if (!/^[A-Za-z0-9][\w-]*$/.test(key)) throw new Error(`${label}: invalid key "${key}"`);
      walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(tree, '');
  return out;
}

const catalogs = new Map<Language, Map<string, Message>>();

/** The catalog for a language, loaded and validated on first use. */
export function catalog(language: Language): Catalog {
  let found = catalogs.get(language);
  if (!found) {
    const label = `templates/i18n/${language}.yml`;
    found = flattenCatalog(
      parse(readFileSync(resourcePath('templates', 'i18n', `${language}.yml`), 'utf8')),
      label,
    );
    catalogs.set(language, found);
  }
  return found;
}

/** The placeholders a message uses (all plural forms together), excluding Korean particle markers. */
export function placeholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const m of text!.matchAll(PLACEHOLDER)) names.add(m[1]!);
  return [...names].sort();
}

const pluralRules = new Map<Language, Intl.PluralRules>();
const numberFormats = new Map<Language, Intl.NumberFormat>();

function formatValue(value: string | number, language: Language): string {
  if (typeof value === 'string') return value;
  // English output predates localization and never grouped digits; keep it that way.
  if (language === 'en') return String(value);
  let format = numberFormats.get(language);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE[language]);
    numberFormats.set(language, format);
  }
  return format.format(value);
}

/** The localized text for `key`, falling back to English when a language lacks it. */
export function t(language: Language, key: string, params: Params = {}): string {
  const message = catalog(language).get(key) ?? catalog('en').get(key);
  if (message === undefined) throw new Error(`Unknown message: ${key}`);
  let template: string;
  if (typeof message === 'string') template = message;
  else {
    let rules = pluralRules.get(language);
    if (!rules) {
      rules = new Intl.PluralRules(LOCALE[language]);
      pluralRules.set(language, rules);
    }
    const category = rules.select(Number(params.count ?? 0)) as PluralCategory;
    template = message[category] ?? message.other;
  }
  const text = template.replace(PLACEHOLDER, (m, name: string) =>
    name in params ? formatValue(params[name]!, language) : m,
  );
  return language === 'ko' ? applyParticles(text) : text;
}

/** A translator bound to one language: `const say = translator('ko'); say('report.title')`. */
export function translator(language: Language): (key: string, params?: Params) => string {
  return (key, params) => t(language, key, params);
}

/** Whether a catalog has a message (in that language or English). */
export function hasMessage(language: Language, key: string): boolean {
  return catalog(language).has(key) || catalog('en').has(key);
}

const listFormats = new Map<string, Intl.ListFormat>();

/** "a, b, and c" in English (as Covi always wrote it); Intl.ListFormat elsewhere ("a, b 및 c"). */
export function listOf(
  language: Language,
  items: readonly string[],
  type: 'conjunction' | 'disjunction' = 'conjunction',
): string {
  if (language === 'en') return joinList(items, type === 'conjunction' ? 'and' : 'or');
  const key = `${language}:${type}`;
  let format = listFormats.get(key);
  if (!format) {
    format = new Intl.ListFormat(LOCALE[language], { style: 'long', type });
    listFormats.set(key, format);
  }
  return format.format(items);
}

/** Joins sentences: with spaces, except after Japanese and Chinese full stops. */
export function joinSentences(language: Language, sentences: readonly string[]): string {
  const parts = sentences.map((s) => s.trim()).filter(Boolean);
  if (language === 'ja' || language === 'zh') return parts.join('');
  return parts.join(' ');
}

/** Ends a sentence with the language's full stop unless it already ends in punctuation. */
export function endSentence(language: Language, text: string): string {
  const s = text.trim();
  if (!s) return s;
  if (language === 'ja' || language === 'zh') return /[。！？.!?:：]$/.test(s) ? s : `${s}。`;
  return /[.!?:]$/.test(s) ? s : `${s}.`;
}
