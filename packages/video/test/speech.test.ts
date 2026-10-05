import { describe, expect, it } from 'vitest';
import {
  localeLanguage,
  normalizeSpeech,
  type Pronunciations,
  resolveSpeechLanguage,
  speechTable,
  unspokenAcronyms,
} from '../src/narration/speech.ts';

const ko = (text: string, pronunciations?: Pronunciations) =>
  normalizeSpeech(text, { language: 'ko', pronunciations }).text;
const ja = (text: string, pronunciations?: Pronunciations) =>
  normalizeSpeech(text, { language: 'ja', pronunciations }).text;
const zh = (text: string, pronunciations?: Pronunciations) =>
  normalizeSpeech(text, { language: 'zh', pronunciations }).text;
const en = (text: string, pronunciations?: Pronunciations) =>
  normalizeSpeech(text, { language: 'en', pronunciations }).text;

describe('speech normalization: Korean', () => {
  it('spells acronyms the way a person says them (the reported bug)', () => {
    expect(ko('씨투 델리게이트 CLI를 추가합니다.')).toBe('씨투 델리게이트 씨엘아이를 추가합니다.');
    expect(ko('c2-delegate CLI를 추가합니다.')).toBe('c2-delegate 씨엘아이를 추가합니다.');
    expect(ko('JSON 응답을 반환합니다.')).toBe('제이슨 응답을 반환합니다.');
  });

  it('handles acronyms with particles attached', () => {
    expect(ko('API는 그대로입니다.')).toBe('에이피아이는 그대로입니다.');
    expect(ko('URL을 확인하고 SDK가 HTTP와 PR로 연결됩니다.')).toBe(
      '유알엘을 확인하고 에스디케이가 에이치티티피와 피알로 연결됩니다.',
    );
    expect(ko('JSON을 읽습니다.')).toBe('제이슨을 읽습니다.');
  });

  it('makes particles agree with the spoken form', () => {
    expect(ko('JSON를 읽습니다.')).toBe('제이슨을 읽습니다.');
    expect(ko('API은 같습니다.')).toBe('에이피아이는 같습니다.');
    expect(ko('SDK으로 보냅니다.')).toBe('에스디케이로 보냅니다.');
    expect(ko('URL로 보냅니다.')).toBe('유알엘로 보냅니다.');
    expect(ko('HTML이 바뀝니다.')).toBe('에이치티엠엘이 바뀝니다.');
    // A particle glued to a following word is left alone.
    const change = normalizeSpeech('JSON를 읽습니다.', { language: 'ko' }).changes;
    expect(change).toEqual([
      { from: 'JSON', to: '제이슨', rule: 'word' },
      { from: '를', to: '을', rule: 'particle' },
    ]);
  });

  it('applies the lexicons in priority order: yours, built-in words, then letters', () => {
    // Built-in word beats letter spelling.
    expect(ko('JSON')).toBe('제이슨');
    // Your pronunciation beats both.
    expect(ko('JSON과 CLI', { JSON: '제이에스오엔', CLI: { ko: '클라이' } })).toBe(
      '제이에스오엔과 클라이',
    );
    // Per-language maps only apply to their language.
    expect(ko('CLI', { CLI: { ja: 'クライ' } })).toBe('씨엘아이');
    // Longest key first, exact and case-sensitive.
    expect(ko('c2-delegate와 c2', { c2: { ko: '씨투' }, 'c2-delegate': '씨투 델리게이트' })).toBe(
      '씨투 델리게이트와 씨투',
    );
    expect(ko('C2', { c2: '씨투' })).toBe('씨2');
  });

  it('handles plurals and digits', () => {
    expect(ko('APIs를 바꿉니다.')).toBe('에이피아이를 바꿉니다.');
    expect(ko('EC2와 S3')).toBe('이씨투와 에스쓰리');
    expect(ko('X1을 켭니다.')).toBe('엑스1을 켭니다.');
    expect(ko('2FA를 켭니다.')).toBe('2에프에이를 켭니다.');
  });

  it('keeps code, versions, paths, URLs, and e-mail addresses unchanged', () => {
    expect(ko('`CLI` 플래그')).toBe('`CLI` 플래그');
    expect(ko('v1.47.0 버전과 1.2.3-beta.1')).toBe('v1.47.0 버전과 1.2.3-beta.1');
    expect(ko('src/CLI/main.ts와 README.md를 고칩니다.')).toBe(
      'src/CLI/main.ts와 README.md를 고칩니다.',
    );
    expect(ko('https://API.example.com/CLI 그리고 dev@API.io')).toBe(
      'https://API.example.com/CLI 그리고 dev@API.io',
    );
    expect(ko('토큰 [REDACTED] 입니다')).toBe('토큰 [REDACTED] 입니다');
    // Acronyms joined by a slash are not paths.
    expect(ko('CI/CD와 A/B 테스트')).toBe('씨아이 씨디와 A/B 테스트');
    expect(ko('TCP/IP')).toBe('티씨피/아이피');
  });

  it('applies your pronunciations inside code and paths, never inside URLs', () => {
    expect(ko('`CLI` 플래그', { CLI: '씨엘아이' })).toBe('`씨엘아이` 플래그');
    expect(ko('README.md', { README: '리드미' })).toBe('리드미.md');
    expect(ko('https://example.com/CLI', { CLI: '씨엘아이' })).toBe('https://example.com/CLI');
  });

  it('leaves explicit spoken forms and single letters as written', () => {
    expect(ko('씨엘아이를 추가합니다.')).toBe('씨엘아이를 추가합니다.');
    expect(ko('A안과 B안')).toBe('A안과 B안');
  });
});

describe('speech normalization: Japanese and Chinese', () => {
  it('spells acronyms in katakana for Japanese voices', () => {
    expect(ja('c2-delegate CLIを追加します。')).toBe('c2-delegate シーエルアイを追加します。');
    expect(ja('JSONのレスポンスとAPIはそのままです。')).toBe(
      'ジェイソンのレスポンスとエーピーアイはそのままです。',
    );
    expect(ja('c2', { c2: { ko: '씨투', ja: 'シーツー' } })).toBe('シーツー');
  });

  it('spaces letters apart for Mandarin voices', () => {
    expect(zh('这个改动添加了 c2-delegate CLI。')).toBe('这个改动添加了 c2-delegate C L I。');
    expect(zh('JSON 响应和 API 保持不变。')).toBe('Jason 响应和 A P I 保持不变。');
    expect(zh('更新了 EC2 和 HTTP2')).toBe('更新了 E C 2 和 H T T P 2');
  });
});

describe('speech normalization: properties', () => {
  const samples = [
    'c2-delegate CLI를 추가하고 JSON를 읽습니다. API은 v1.47.0 그대로이며 src/CLI.ts와 `SDK`를 씁니다.',
    'APIs, EC2, S3, 2FA, X1, GET /api/users, CI/CD, README, GitHub와 git을 씁니다.',
    'c2-delegate CLIを追加し、JSONのAPIsを使います。v2.0.1 と https://example.com/API。',
    '添加了 CLI 和 JSON，更新 EC2、S3 与 README。',
    'The CLI reads JSON from https://API.example.com and README.md.',
  ];
  const lexicon: Pronunciations = { c2: { ko: '씨투', ja: 'シーツー' }, SDK: { zh: 'S D K' } };

  it('is idempotent in every language', () => {
    for (const language of ['en', 'ko', 'ja', 'zh'] as const) {
      for (const text of samples) {
        const once = normalizeSpeech(text, { language, pronunciations: lexicon }).text;
        expect(normalizeSpeech(once, { language, pronunciations: lexicon }).text, text).toBe(once);
      }
    }
  });

  it('leaves English to the voice, except for your pronunciations', () => {
    const text = 'The CLI reads JSON and calls the API via kubectl.';
    expect(en(text)).toBe(text);
    expect(en(text, { kubectl: 'cube control', JSON: { ko: '제이슨' } })).toBe(
      'The CLI reads JSON and calls the API via cube control.',
    );
  });

  it('finds acronyms a voice would still have to guess at', () => {
    expect(unspokenAcronyms('제이슨 `JSON.parse` 그리고 GRAPHQL과 C L I')).toEqual([
      'JSON',
      'GRAPHQL',
    ]);
    expect(unspokenAcronyms('https://API.example.com [REDACTED] v1.2.3 A안')).toEqual([]);
    expect(unspokenAcronyms(ko('CLI와 EC2와 APIs'))).toEqual([]);
  });

  it('ships complete letter tables', () => {
    for (const language of ['ko', 'ja', 'zh'] as const) {
      const table = speechTable(language)!;
      expect(Object.keys(table.letters)).toHaveLength(26);
      // Built-in spoken forms never contain something Covi would rewrite again.
      for (const spoken of Object.values(table.words))
        expect(normalizeSpeech(spoken, { language }).text, spoken).toBe(spoken);
    }
    expect(speechTable('en')).toBeUndefined();
  });
});

describe('speech language', () => {
  it('follows the flag, the storyboard, the text, the configuration, then the voice', () => {
    const text = ['씨엘아이를 추가합니다.'];
    expect(resolveSpeechLanguage({ flag: 'ja', storyboard: 'ko', text }).language).toBe('ja');
    expect(resolveSpeechLanguage({ storyboard: 'zh', text }).language).toBe('zh');
    expect(resolveSpeechLanguage({ text, configured: 'en' }).language).toBe('ko');
    expect(resolveSpeechLanguage({ text: ['CLIを追加します'] }).language).toBe('ja');
    expect(resolveSpeechLanguage({ text: ['添加了命令行工具'] }).language).toBe('zh');
    expect(resolveSpeechLanguage({ text: ['Adds the CLI.'], configured: 'ko' }).language).toBe(
      'ko',
    );
    expect(resolveSpeechLanguage({ text: ['Adds the CLI.'], voiceLocale: 'ja_JP' }).language).toBe(
      'ja',
    );
    expect(resolveSpeechLanguage({ text: ['Adds the CLI.'] }).language).toBe('en');
  });

  it('reads voice locales from say and espeak', () => {
    expect(localeLanguage('ko_KR')).toBe('ko');
    expect(localeLanguage('zh_TW')).toBe('zh');
    expect(localeLanguage('cmn')).toBe('zh');
    expect(localeLanguage('en-us')).toBe('en');
    expect(localeLanguage('fr_FR')).toBeUndefined();
  });
});
