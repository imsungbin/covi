import { existsSync } from 'node:fs';
import { parseConfigInput, resolveConfig } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { cjkFontsFor, fontSlices, withCjkFamilies } from '../src/composition/fonts.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { displayWidth } from '../src/text.ts';
import { buildTimeline, layoutScenes } from '../src/timeline/build.ts';

const japanese =
  'この変更は、コメント入力欄に残りの文字数を表示し、長すぎるコメントの投稿を防ぎます。入力するたびにカウンターが減り、「投稿」ボタンは上限を超えると無効になります。';

describe('fonts', () => {
  it('embed the CJK fonts the text needs, the language first, Han shapes per language', () => {
    expect(cjkFontsFor('Adds the CLI', 'en')).toEqual([]);
    expect(cjkFontsFor('씨엘아이를 추가', 'ko')).toEqual(['ko']);
    expect(cjkFontsFor('CLIを追加', 'ja')).toEqual(['ja']);
    expect(cjkFontsFor('添加命令行', 'zh')).toEqual(['zh']);
    // Kanji in Japanese, hanja in Korean, and Chinese in an English video's code comments.
    expect(cjkFontsFor('設定', 'ja')).toEqual(['ja']);
    expect(cjkFontsFor('設定', 'ko')).toEqual(['ko']);
    expect(cjkFontsFor('// 设置', 'en')).toEqual(['zh']);
    expect(cjkFontsFor('한국어 and 日本語です', 'en')).toEqual(['ko', 'ja']);
    expect(withCjkFamilies("'Inter Variable', Inter, sans-serif", ['ja', 'ko'])).toBe(
      "'Inter Variable', 'Noto Sans JP Variable', 'Noto Sans KR Variable', Inter, sans-serif",
    );
  });

  it('copy only the slices that cover the text', () => {
    const slices = fontSlices(['ko'], '씨엘아이를 추가합니다');
    expect(slices.length).toBeGreaterThan(0);
    expect(slices.length).toBeLessThan(10);
    for (const s of slices) {
      expect(existsSync(s.file)).toBe(true);
      expect(s.family).toBe('Noto Sans KR Variable');
      expect(s.unicodeRange).toMatch(/^U\+/);
    }
    expect(fontSlices(['ko'], 'only ASCII')).toEqual([]);
  });
});

describe('CJK timelines', () => {
  const scenes: Scene[] = [
    {
      id: 's1',
      beat: 'context',
      narration: japanese,
      visual: { kind: 'title', title: 'コメント入力欄に文字数を表示', meta: [] },
    },
    {
      id: 's2',
      beat: 'summary',
      narration: 'マージして問題なさそうです。',
      visual: { kind: 'summary', verdict: 'looks-good', headline: '問題なし', points: [] },
    },
  ];
  const spec = resolveVideoSpec(
    resolveConfig([
      { name: 'explicit', values: parseConfigInput({ video: { mode: 'short' } }, 't') },
    ]).config,
  );

  it('carry the language and the fonts their text needs', () => {
    const layout = layoutScenes(scenes, new Map(), new Map(), 'ja');
    const timeline = buildTimeline({
      title: 'タイトル',
      scenes,
      layout,
      spec,
      image: () => {
        throw new Error('no images');
      },
      language: 'ja',
    });
    expect(timeline.language).toBe('ja');
    expect(timeline.fonts.cjk).toEqual(['ja']);
    expect(timeline.fonts.sans).toContain("'Noto Sans JP Variable'");
    for (const cue of timeline.captions)
      for (const line of cue.lines) expect(displayWidth(line)).toBeLessThanOrEqual(30);
  });

  it('leave English timelines as they were', () => {
    const english: Scene[] = scenes.map((s) => ({ ...s, narration: 'It looks good to merge.' }));
    const timeline = buildTimeline({
      title: 'Title',
      scenes: english.map((s) =>
        s.visual.kind === 'title'
          ? { ...s, visual: { ...s.visual, title: 'Title' } }
          : {
              ...s,
              visual: { kind: 'summary', verdict: 'looks-good', headline: 'OK', points: [] },
            },
      ),
      layout: layoutScenes(english, new Map()),
      spec,
      image: () => {
        throw new Error('no images');
      },
    });
    expect(timeline.language).toBe('en');
    expect(timeline.fonts).toEqual({
      sans: "'Inter Variable', Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
      mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    });
  });
});
