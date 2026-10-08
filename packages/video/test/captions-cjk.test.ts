import { describe, expect, it } from 'vitest';
import { buildCaptions, captionOptionsFor, chunkCaption, lineUnits } from '../src/captions.ts';
import { layoutChecks, timingChecks } from '../src/qc.ts';
import { captionCharacters, displayWidth, speechUnits } from '../src/text.ts';
import { estimateSpeech } from '../src/timeline/build.ts';
import type { LayoutReport, Timeline } from '../src/timeline/types.ts';

const NO_LINE_START = /^[、。，．！？）」』】ー]/;
const NO_LINE_END = /[（「『【]$/;

const samples = {
  ko: '전체적으로 머지해도 좋아 보입니다. API는 그대로이고 회귀 테스트도 함께 들어왔습니다. 이제 CLI는 URL에 쓸 수 있는 슬러그를 출력합니다.',
  ja: 'この変更は、コメント入力欄に残りの文字数を表示し、長すぎるコメントの投稿を防ぎます。入力するたびにカウンターが減り、「投稿」ボタンは上限を超えると無効になります。',
  zh: '这个改动在评论输入框中显示剩余字数，并阻止发布过长的评论。每次输入时计数器都会减少，超过上限或内容为空时，“发布”按钮会被禁用。',
} as const;

describe('CJK captions', () => {
  for (const orientation of ['vertical', 'square', 'landscape'] as const) {
    it(`wrap Korean, Japanese, and Chinese inside a ${orientation} frame`, () => {
      for (const [language, text] of Object.entries(samples) as Array<
        [keyof typeof samples, string]
      >) {
        const options = { ...captionOptionsFor(orientation), language };
        const cues = chunkCaption(text, options);
        expect(cues.length).toBeGreaterThan(1);
        for (const cue of cues) {
          expect(cue.length).toBeLessThanOrEqual(2);
          for (const line of cue) {
            expect(displayWidth(line), `${language}: ${line}`).toBeLessThanOrEqual(
              options.maxChars,
            );
            expect(line, `${language}: ${line}`).not.toMatch(NO_LINE_START);
            expect(line, `${language}: ${line}`).not.toMatch(NO_LINE_END);
          }
        }
        // Nothing is lost or reordered.
        const joiner = language === 'ko' ? ' ' : '';
        expect(cues.flat().join(joiner).replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
      }
    });
  }

  it('close a cue at every sentence end, including 。！？', () => {
    const cues = chunkCaption('短い文です。もう一つ！最後ですか？', {
      ...captionOptionsFor('landscape'),
      language: 'ja',
    });
    expect(cues).toEqual([['短い文です。'], ['もう一つ！'], ['最後ですか？']]);
  });

  it('break Korean between words and keep particles, Latin runs, and brackets together', () => {
    const ko = chunkCaption('이제 CLI는 URL에 쓸 수 있는 hello-world-ca-va를 출력합니다.', {
      maxChars: 30,
      maxLines: 2,
      minDuration: 0.9,
      language: 'ko',
    });
    // Lines break only between words: every word on a line is a whole word of the sentence.
    const words = new Set('이제 CLI는 URL에 쓸 수 있는 hello-world-ca-va를 출력합니다.'.split(' '));
    for (const line of ko.flat()) for (const word of line.split(' ')) expect(words).toContain(word);
    expect(ko.flat()).toContain('hello-world-ca-va를');
    expect(lineUnits('c2-delegate CLIを追加し、「JSON」のレスポンス', 'ja')).toEqual([
      'c2-delegate ',
      'CLIを',
      '追加し、',
      '「JSON」の',
      'レスポンス',
    ]);
  });

  it('time CJK cues by their width', () => {
    const cues = buildCaptions([{ text: samples.zh, start: 0, end: 12 }], {
      ...captionOptionsFor('vertical'),
      language: 'zh',
    });
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBe(12);
  });
});

describe('speech units', () => {
  it('count words in English and characters or syllables in CJK', () => {
    expect(speechUnits('The key change is in app.js.', 'en')).toBe(6);
    expect(speechUnits('씨엘아이를 추가합니다.', 'ko')).toBe(10);
    expect(speechUnits('CLIを追加します。', 'ja')).toBe(7);
    expect(speechUnits('添加了 C L I 和 v2', 'zh')).toBe(9);
    // Estimated speaking time follows each language's rate; English is unchanged.
    expect(estimateSpeech('one two three four five', 'en')).toBeCloseTo(5 / 2.5 + 0.25);
    expect(estimateSpeech('가나다라마바사아자차', 'ko')).toBeCloseTo(10 / 4.3 + 0.25);
  });
});

function timelineOf(language: 'en' | 'ko' | 'ja' | 'zh', captions: Timeline['captions']) {
  return {
    language,
    width: 1080,
    height: 1920,
    captions,
    scenes: [],
  } as unknown as Timeline;
}

describe('per-language QC', () => {
  it('reads caption speed in the units and limits of the language', () => {
    // 20 Korean characters in 1.4 s: 14/s, fine for Korean (limit 17).
    const ko = [{ start: 0, end: 1.4, lines: ['가나다라마바사아자차', '카타파하가나다라마바'] }];
    expect(timingChecks(timelineOf('ko', ko))[0]!.status).toBe('pass');
    // The same speed in Japanese (limit 8) flashes by.
    const ja = [{ start: 0, end: 1.4, lines: ['あいうえおかきくけこ', 'さしすせそたちつてと'] }];
    expect(timingChecks(timelineOf('ja', ja))[0]!.status).toBe('warn');
    // English is unchanged: 24 characters per second, counting spaces.
    const en = [{ start: 0, end: 1, lines: ['abcdefghij klmnopqrst'] }];
    expect(timingChecks(timelineOf('en', en))[0]!.status).toBe('pass');
  });

  it('counts a half-width character as half in CJK captions', () => {
    expect(captionCharacters(['HTMLとCSS'], 'ja')).toBe(4.5);
    expect(captionCharacters(['API는 그대로'], 'ko')).toBe(5.5);
    expect(captionCharacters(['abc def'], 'en')).toBe(7);
    // 16 Latin letters and 2 kana in 2 s: 5 per second, under Japanese's 8 (9 if letters counted one).
    const ja = [{ start: 0, end: 2, lines: ['updateCounterがDOMを'] }];
    expect(timingChecks(timelineOf('ja', ja))[0]!.status).toBe('pass');
  });

  it('measures narration pace in syllables for Korean, using the spoken text when known', () => {
    const scene = (text: string, seconds: number) =>
      ({
        id: 's1',
        start: 0,
        end: seconds,
        visual: { kind: 'callout' },
        speech: { start: 0, end: seconds, text },
      }) as Timeline['scenes'][number];
    const ko = { ...timelineOf('ko', []), scenes: [scene('씨엘아이를 추가합니다.', 2)] };
    expect(timingChecks(ko)[1]).toMatchObject({ id: 'narration-pace', status: 'pass' });
    const rushed = { ...timelineOf('ko', []), scenes: [scene('씨엘아이를 추가합니다.', 1)] };
    expect(timingChecks(rushed)[1]!.status).toBe('warn');
  });

  it('fails when a bundled font did not load', () => {
    const fonts = (fontsFailed?: string[]) =>
      layoutChecks(timelineOf('ja', []), [
        { frame: 3, items: [], imagesLoaded: true, fontsFailed },
      ]).find((c) => c.id === 'fonts')!;
    expect(fonts().status).toBe('pass');
    expect(fonts(['Noto Sans JP Variable'])).toMatchObject({
      status: 'fail',
      message: expect.stringMatching(/Noto Sans JP Variable did not load/),
    });
  });

  it('fails when a caption line is wider than its box', () => {
    const report: LayoutReport = {
      frame: 12,
      scene: 's1',
      captions: { x: 100, y: 1500, width: 800, height: 120 },
      captionOverflow: true,
      items: [],
      imagesLoaded: true,
    };
    const check = layoutChecks(timelineOf('ko', []), [report]).find(
      (c) => c.id === 'captions-in-frame',
    )!;
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/wider than the caption box at frames 12/);
  });
});
