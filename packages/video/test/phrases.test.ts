import { describe, expect, it } from 'vitest';
import { buildCaptions, captionOptionsFor, chunkCaption, phraseTime } from '../src/captions.ts';
import { findPhrase } from '../src/storyboard/grammar.ts';

const landscape = captionOptionsFor('landscape');
const vertical = captionOptionsFor('vertical');
const at = (text: string, phrase: string, start: number, end: number, options = landscape) =>
  phraseTime({ text, start, end }, findPhrase(text, phrase), options);

describe('phrase times', () => {
  it('places a phrase by the weight of the text before it', () => {
    // "Onetwothreefour." weighs 16; "three" starts after 6 and ends after 11.
    expect(at('One two three four.', 'three', 0, 4)).toEqual({ start: 1.5, end: 2.75 });
    expect(at('One two three four.', 'One', 0, 4)!.start).toBe(0);
    expect(at('One two three four.', 'four.', 0, 4)!.end).toBe(4);
  });

  it('follows the cues the captions show: a phrase that starts a cue starts with it', () => {
    const text =
      'This change updates the comment flow to use optimistic updates. The comment now appears immediately.';
    const last = buildCaptions([{ text, start: 1, end: 9 }], vertical).at(-1)!;
    const phrase = at(text, 'The comment now', 1, 9, vertical)!;
    expect(phrase.start).toBeCloseTo(last.start, 3);
    expect(at(text, 'immediately.', 1, 9, vertical)!.end).toBeCloseTo(last.end, 3);
    expect(at(text, 'optimistic updates', 1, 9, vertical)!.start).toBeLessThan(phrase.start);
  });

  it('has no time in an empty window or for a phrase that is not there', () => {
    expect(at('One two.', 'two', 2, 2)).toBeUndefined();
    expect(at('', 'x', 0, 2)).toBeUndefined();
    expect(at('One two.', 'three', 0, 2)).toBeUndefined();
  });

  it('weighs CJK characters by display width, and emoji by their UTF-16 length in English', () => {
    const ko = { ...vertical, language: 'ko' as const };
    // 15 Hangul syllables weigh 2 each and the period 1: "남은 글자 수" spans weights 10 to 20.
    const korean = at('댓글을 쓰면 남은 글자 수가 보입니다.', '남은 글자 수', 0, 3, ko)!;
    expect(korean.start).toBeCloseTo((3 * 10) / 31, 3);
    expect(korean.end).toBeCloseTo((3 * 20) / 31, 3);
    const ja = { ...vertical, language: 'ja' as const };
    expect(at('残りの文字数が表示されます。', '文字数', 0, 2, ja)).toEqual({
      start: 0.429,
      end: 0.857,
    });
    const zh = { ...vertical, language: 'zh' as const };
    expect(at('输入评论时会显示剩余字数。', '剩余字数', 0, 2.6, zh)!.start).toBeCloseTo(1.6, 3);
    // 🎉 is one character that weighs 2, as the caption timing counts it.
    expect(at('🎉 Ready to merge.', 'merge', 0, 3)!.start).toBeCloseTo(1.8, 3);
  });

  it('keeps every character of a line in its cues, in every language', () => {
    const dense = (text: string) => text.replace(/\s/g, '');
    for (const [language, text] of [
      [
        'en',
        'This change updates the comment flow to use optimistic updates. The comment now appears immediately, while the request runs; failures roll back.',
      ],
      ['ko', '댓글을 쓰면 남은 글자 수가 보입니다. 한도를 넘으면 게시 버튼이 비활성화됩니다.'],
      ['ja', 'コメントを入力すると残りの文字数が表示されます。上限を超えると投稿できません。'],
      ['zh', '输入评论时会显示剩余字数。超过上限后无法发布，按钮会变灰。'],
    ] as const) {
      const options = { ...vertical, language };
      expect(dense(chunkCaption(text, options).flat().join('')), language).toBe(dense(text));
    }
  });
});
