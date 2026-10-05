import { describe, expect, it } from 'vitest';
import {
  catalog,
  endSentence,
  joinSentences,
  listOf,
  type Message,
  PLURAL_CATEGORIES,
  placeholders,
  t,
} from '../src/i18n/catalog.ts';
import { PARTICLES } from '../src/i18n/korean.ts';
import { LANGUAGES, LOCALE } from '../src/i18n/language.ts';
import { RULES } from '../src/review/rules/index.ts';

const english = catalog('en');

describe('message catalogs', () => {
  for (const language of LANGUAGES.filter((l) => l !== 'en')) {
    describe(language, () => {
      const messages = catalog(language);

      it('has every English key and no others', () => {
        expect([...messages.keys()].filter((k) => !english.has(k))).toEqual([]);
        expect([...english.keys()].filter((k) => !messages.has(k))).toEqual([]);
      });

      it('uses the same placeholders as English', () => {
        for (const [key, message] of english)
          expect(placeholders(messages.get(key)!), key).toEqual(placeholders(message));
      });

      it('gives plural messages every form the language needs', () => {
        const needed = new Intl.PluralRules(LOCALE[language]).resolvedOptions().pluralCategories;
        for (const [key, message] of english) {
          const own = messages.get(key)!;
          expect(typeof own, key).toBe(typeof message);
          if (typeof own === 'string') continue;
          for (const category of needed) expect(own, `${key}.${category}`).toHaveProperty(category);
        }
      });
    });
  }

  it('gives English plural messages one and other', () => {
    for (const [key, message] of english)
      if (typeof message !== 'string') {
        expect(message, key).toHaveProperty('one');
        expect(message, key).toHaveProperty('other');
      }
  });

  it('uses only valid plural categories and Korean particle pairs', () => {
    const pairs = new Set(PARTICLES.flatMap(([a, b]) => [`${a}/${b}`, `${b}/${a}`]));
    for (const language of LANGUAGES) {
      for (const [key, message] of catalog(language)) {
        const texts = typeof message === 'string' ? [message] : Object.values(message);
        if (typeof message !== 'string')
          for (const category of Object.keys(message))
            expect(PLURAL_CATEGORIES, `${language} ${key}`).toContain(category);
        for (const text of texts as string[])
          for (const m of text.matchAll(/\{([가-힣]+\/[가-힣]+)\}/g)) {
            expect(language, `${key} uses a particle marker`).toBe('ko');
            expect(pairs, `${key}: ${m[1]}`).toContain(m[1]);
          }
      }
    }
  });

  it('describes every built-in rule, matching the rule itself in English', () => {
    for (const rule of RULES) {
      expect(english.get(`rule.${rule.id}.checks`), rule.id).toBe(rule.checks);
      for (const field of ['title', 'explanation', 'suggestion'])
        if (english.has(`rule.${rule.id}.${field}`))
          for (const language of LANGUAGES)
            expect(catalog(language).has(`rule.${rule.id}.${field}`)).toBe(true);
    }
  });
});

describe('formatting', () => {
  it('fills placeholders, picks plural forms, and formats numbers per language', () => {
    expect(t('en', 'count.files', { count: 1 })).toBe('1 file');
    expect(t('en', 'count.files', { count: 1234 })).toBe('1234 files');
    expect(t('ko', 'count.files', { count: 1234 })).toBe('파일 1,234개');
    expect(t('ja', 'count.files', { count: 2 })).toMatch(/2/);
    expect(t('en', 'verdict.looks-good')).toBe('Looks good');
  });

  it('resolves Korean particles against what precedes them', () => {
    expect(t('ko', 'signal.routeRemoved', { route: 'GET /api/users' })).toBe(
      '라우트 GET /api/users가 삭제되었습니다.',
    );
    expect(
      t('ko', 'rule.lockfile-out-of-sync.title', {
        manifest: 'package.json',
        lockfile: 'package-lock.json',
      }),
    ).toBe('package.json은 바뀌었지만 package-lock.json은 바뀌지 않았습니다');
  });

  it('joins lists and sentences the way each language does', () => {
    expect(listOf('en', ['a', 'b', 'c'])).toBe('a, b, and c');
    expect(listOf('ko', ['a', 'b'])).toBe('a 및 b');
    expect(listOf('ja', ['a', 'b', 'c'])).toBe('a、b、c');
    expect(listOf('zh', ['a', 'b'])).toBe('a和b');
    expect(joinSentences('en', ['One.', 'Two.'])).toBe('One. Two.');
    expect(joinSentences('ja', ['一つ。', '二つ。'])).toBe('一つ。二つ。');
    expect(endSentence('zh', '完成')).toBe('完成。');
    expect(endSentence('ko', '완료')).toBe('완료.');
  });

  it('falls back to English for a missing message and rejects unknown keys', () => {
    expect(() => t('ko', 'no.such.key')).toThrow(/Unknown message/);
  });

  it('leaves English messages as they were', () => {
    const plural = english.get('count.files') as Exclude<Message, string>;
    expect(plural.one).toBe('{count} file');
  });
});
