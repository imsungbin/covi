import { describe, expect, it } from 'vitest';
import { parseYamlConfig } from '../src/config/load.ts';
import { configFromEnv, parseConfigInput, resolveConfig } from '../src/config/resolve.ts';
import { agreeingParticle, applyParticles, finalSound, particle } from '../src/i18n/korean.ts';
import {
  detectLanguage,
  parseLanguage,
  parseLanguageSetting,
  resolveOutputLanguage,
} from '../src/i18n/language.ts';

describe('language codes', () => {
  it('accepts the four languages and the Simplified Chinese aliases, in any case', () => {
    expect(['en', 'ko', 'ja', 'zh'].map(parseLanguage)).toEqual(['en', 'ko', 'ja', 'zh']);
    expect(['zh-CN', 'zh-Hans', 'ZH_cn', 'zh-hans-cn'].map(parseLanguage)).toEqual([
      'zh',
      'zh',
      'zh',
      'zh',
    ]);
    expect(parseLanguage('ko-KR')).toBe('ko');
    expect(parseLanguageSetting('AUTO')).toBe('auto');
  });

  it('rejects Traditional Chinese and unknown languages instead of guessing', () => {
    for (const code of ['zh-TW', 'zh-Hant', 'fr', '', 'korean'])
      expect(parseLanguage(code)).toBeUndefined();
  });
});

describe('language detection', () => {
  it('reads the dominant script, ignoring identifiers, code, and paths', () => {
    expect(detectLanguage('c2-delegate CLI 추가')?.language).toBe('ko');
    expect(detectLanguage('feat(cli): c2-delegate CLI를 추가합니다')?.language).toBe('ko');
    expect(detectLanguage('CLIを追加しました')?.language).toBe('ja');
    expect(detectLanguage('添加命令行工具')?.language).toBe('zh');
    expect(detectLanguage('Add the c2-delegate CLI')?.language).toBe('en');
    // Kanji without kana reads as Chinese; any kana makes it Japanese.
    expect(detectLanguage('設定変更')?.language).toBe('zh');
    expect(detectLanguage('設定を変更')?.language).toBe('ja');
    // A Korean word in English prose does not flip the language.
    expect(
      detectLanguage('Fix the layout of the comment composer so it no longer overflows (한글)')
        ?.language,
    ).toBe('en');
    expect(detectLanguage('`useCartTotals` src/cart.ts v1.2.3')).toBeUndefined();
  });

  it('resolves auto from the change, an explicit setting otherwise, and explains why', () => {
    const korean = resolveOutputLanguage('auto', 'global', {
      title: 'c2-delegate CLI 추가',
      commits: ['feat: CLI를 추가합니다\n\n설정 파일도 갱신합니다.'],
    });
    expect(korean.language).toBe('ko');
    expect(korean.source).toMatch(/^auto: Hangul in the change's title and commit messages/);
    expect(resolveOutputLanguage('auto', 'global', {}).language).toBe('en');
    expect(resolveOutputLanguage('ja', 'explicit', { title: '한국어 제목' })).toEqual({
      language: 'ja',
      setting: 'ja',
      source: 'explicit',
    });
  });
});

describe('Korean particles', () => {
  it('follow how Latin names, numbers, and Hangul end when read aloud', () => {
    expect(finalSound('씨엘아이')).toBe('vowel');
    expect(finalSound('제이슨')).toBe('consonant');
    expect(finalSound('유알엘')).toBe('rieul');
    expect(finalSound('URL')).toBe('rieul');
    expect(finalSound('API')).toBe('vowel');
    expect(finalSound('JSON')).toBe('consonant');
    expect(finalSound('`cart.ts`')).toBe('vowel');
    expect(finalSound('file')).toBe('rieul');
    expect(finalSound('button')).toBe('consonant');
    expect(finalSound('3')).toBe('consonant');
    expect(finalSound('10')).toBe('consonant');
    expect(finalSound('2')).toBe('vowel');
    expect(finalSound('!!')).toBeUndefined();
  });

  it('choose the agreeing form, and resolve markers in messages', () => {
    expect(particle('API', '을')).toBe('를');
    expect(particle('JSON', '를')).toBe('을');
    expect(particle('URL', '으로')).toBe('로');
    expect(particle('JSON', '로')).toBe('으로');
    expect(particle('…', '을')).toBe('을(를)');
    expect(applyParticles('{name}{을/를} 추가합니다'.replace('{name}', 'JSON'))).toBe(
      'JSON을 추가합니다',
    );
    expect(applyParticles('API{이/가} 바뀌고 URL{은/는} JSON{으로/로}, URL{으로/로}')).toBe(
      'API가 바뀌고 URL은 JSON으로, URL로',
    );
    expect(agreeingParticle('제이슨', '를 읽습니다')).toEqual({ from: '를', to: '을' });
    expect(agreeingParticle('제이슨', '를읽')).toBeUndefined();
  });
});

describe('language and pronunciation configuration', () => {
  it('defaults to auto and records where a language came from', () => {
    expect(resolveConfig([]).config.language).toBe('auto');
    const { config, provenance } = resolveConfig([
      {
        name: 'repository',
        source: '.covi/config.yml',
        values: parseConfigInput({ language: 'zh-CN' }, 't'),
      },
    ]);
    expect(config.language).toBe('zh');
    expect(provenance.language).toBe('repository (.covi/config.yml)');
    expect(configFromEnv({ COVI_LANGUAGE: 'ja' }).language).toBe('ja');
    expect(() => parseConfigInput({ language: 'zh-TW' }, 'flags')).toThrow(/Traditional Chinese/);
  });

  it('accepts pronunciations for every language or per language', () => {
    const values = parseYamlConfig(
      'video:\n  narration:\n    pronunciations:\n      CLI: 씨엘아이\n      c2: { ko: 씨투, ja: シーツー }\n',
      'config.yml',
    );
    const { config } = resolveConfig([{ name: 'repository', values }]);
    expect(config.video.narration.pronunciations).toEqual({
      CLI: '씨엘아이',
      c2: { ko: '씨투', ja: 'シーツー' },
    });
  });

  it('rejects pronunciations that would be rewritten again, or are malformed', () => {
    const parse = (pronunciations: unknown) =>
      parseConfigInput({ video: { narration: { pronunciations } } }, 'config');
    expect(() => parse({ API: 'API 인터페이스' })).toThrow(/would be rewritten again/);
    expect(() => parse({ ' CLI': '씨엘아이' })).toThrow();
    expect(() => parse({ CLI: { fr: 'cé-èl-i' } })).toThrow();
    expect(() => parse({ CLI: '' })).toThrow();
    expect(() => parse({ CLI: 'line\nbreak' })).toThrow();
    expect(() => parse({ APIs: 'API 목록' })).not.toThrow();
  });
});
