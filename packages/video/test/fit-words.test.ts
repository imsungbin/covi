import { describe, expect, it } from 'vitest';
import { fitWords } from '../src/storyboard/draft.ts';

describe('fitWords in Korean, Japanese, and Chinese', () => {
  it('keeps whole sentences that fit the budget', () => {
    expect(fitWords('카운터가 줄어듭니다. 버튼이 꺼집니다.', 8, 'ko')).toBe('카운터가 줄어듭니다.');
    expect(fitWords('カウンターが減ります。ボタンが無効になります。', 10, 'ja')).toBe(
      'カウンターが減ります。',
    );
  });

  it('keeps a first sentence whole when it carries English text from the change', () => {
    // 22 units against a budget of 12: an English title costs more units than it takes to say.
    const text =
      '这个改动的标题是 Show remaining characters in the comment composer。之后还有更多内容。';
    expect(fitWords(text, 12, 'zh')).toBe(
      '这个改动的标题是 Show remaining characters in the comment composer。',
    );
  });

  it('ends a much longer sentence at a clause', () => {
    const text =
      'この変更は、コメント入力欄に残りの文字数を表示し、長すぎるコメントの投稿を防ぎ、さらに投稿ボタンを無効にします。';
    expect(fitWords(text, 8, 'ja')).toBe('この変更は。');
  });

  it('never cuts inside a word when no clause fits', () => {
    const text = 'updateCounter会在每次输入时更新计数器并且禁用发布按钮直到内容合适为止';
    expect(fitWords(text, 6, 'zh')).toBe('updateCounter会。');
  });
});
