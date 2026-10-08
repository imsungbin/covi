### Task 2: Phrase times from the captions' text-weighted split

Phrase sync must use "the existing text-weighted split (the one captions use)". This task refactors `buildCaptions` so one internal function times a speech window's cues, and adds `phraseTime`, which places a phrase inside the cue that shows it by the weight of the characters before it. The caption output stays byte-identical (the English baseline pins it).

**Files:**
- Modify: `packages/video/src/captions.ts`
- Test: `packages/video/test/phrases.test.ts` (create)

**Interfaces:**
- Consumes: `findPhrase`, `PhraseSpan` from Task 1 (`storyboard/grammar.ts`).
- Produces: `phraseTime(window: { text: string; start: number; end: number }, span: PhraseSpan, options: CaptionOptions): { start: number; end: number } | undefined` (absolute seconds, rounded to the millisecond). Internal helpers `timeWindow` and `spokenAt` are reused by Task 7 for caption emphasis.

- [ ] **Step 1: Write the failing test**

Create `packages/video/test/phrases.test.ts`:

```ts
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
    expect(at('残りの文字数が表示されます。', '文字数', 0, 2, ja)).toEqual({ start: 0.429, end: 0.857 });
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/phrases.test.ts
```

Expected: FAIL with `phraseTime is not a function` (or a missing export error).

- [ ] **Step 3: Refactor `buildCaptions` and add `phraseTime` in `packages/video/src/captions.ts`**

Add the import:

```ts
import type { PhraseSpan } from './storyboard/grammar.ts';
```

Replace the whole `buildCaptions` function (from its doc comment to its closing brace) with:

```ts
/** One speech window's cues, timed, with each cue's characters (whitespace removed) in order. */
interface TimedWindow {
  cues: CaptionCue[];
  chars: string[][];
}

const denseChars = (text: string) => [...text.replace(/\s/g, '')];

/** What one character weighs in a cue's timing, the way a whole cue is weighed. */
function charWeight(language: Language): (char: string) => number {
  return language === 'en' ? (char) => char.length : displayWidth;
}

/** Times a window's cues in proportion to their length, honoring a minimum duration. */
function timeWindow(
  w: { text: string; start: number; end: number },
  options: CaptionOptions,
): TimedWindow | undefined {
  const language = options.language ?? 'en';
  const weigh = (lines: string[]) =>
    language === 'en'
      ? lines.join(' ').replace(/\s/g, '').length
      : displayWidth(lines.join('').replace(/\s/g, ''));
  const chunks = chunkCaption(w.text, options);
  if (chunks.length === 0 || w.end <= w.start) return undefined;
  const weights = chunks.map((c) => Math.max(4, weigh(c)));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = w.end - w.start;
  let durations = weights.map((wt) => (span * wt) / total);
  // Borrow time for cues that would flash by too quickly.
  const short = durations.filter((d) => d < options.minDuration).length;
  if (short && span >= options.minDuration * chunks.length) {
    const deficit = durations.reduce((n, d) => n + Math.max(0, options.minDuration - d), 0);
    const pool = durations.reduce((n, d) => n + Math.max(0, d - options.minDuration), 0);
    durations = durations.map((d) =>
      d < options.minDuration
        ? options.minDuration
        : d - ((d - options.minDuration) / pool) * deficit,
    );
  }
  const cues: CaptionCue[] = [];
  let t = w.start;
  chunks.forEach((lines, i) => {
    const end = i === chunks.length - 1 ? w.end : t + durations[i]!;
    cues.push({ start: round(t), end: round(end), lines });
    t = end;
  });
  return { cues, chars: chunks.map((lines) => denseChars(lines.join(''))) };
}

/**
 * When a window reaches its character `j` (whitespace removed; `j` equal to the count is its
 * end): the start of the cue holding it, plus that cue's share by the weight before it.
 */
function spokenAt(timed: TimedWindow, j: number, weight: (char: string) => number): number {
  let from = 0;
  for (const [k, chars] of timed.chars.entries()) {
    if (j < from + chars.length || k === timed.chars.length - 1) {
      const cue = timed.cues[k]!;
      const local = Math.max(0, Math.min(chars.length, j - from));
      const total = chars.reduce((n, c) => n + weight(c), 0);
      const before = chars.slice(0, local).reduce((n, c) => n + weight(c), 0);
      return cue.start + (cue.end - cue.start) * (total > 0 ? before / total : 0);
    }
    from += chars.length;
  }
  return timed.cues.at(-1)?.end ?? 0;
}

/** Times cues within each speech window in proportion to their length, honoring a minimum duration. */
export function buildCaptions(
  windows: Array<{ text: string; start: number; end: number }>,
  options: CaptionOptions,
): CaptionCue[] {
  return windows.flatMap((w) => timeWindow(w, options)?.cues ?? []);
}

/**
 * When a phrase of a line is spoken, from its first character to just past its last, by the
 * text-weighted split the captions use: each cue gets its share of the window, and inside a cue
 * the phrase starts after the weight of the text before it. `span` is what `findPhrase` returns.
 * Undefined when the window has no time, the line no text, or the phrase was not found.
 */
export function phraseTime(
  w: { text: string; start: number; end: number },
  span: PhraseSpan,
  options: CaptionOptions,
): { start: number; end: number } | undefined {
  const timed = timeWindow(w, options);
  if (!timed || span.index < 0) return undefined;
  const weight = charWeight(options.language ?? 'en');
  return {
    start: round(spokenAt(timed, span.index, weight)),
    end: round(spokenAt(timed, span.index + span.length, weight)),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass, and that captions did not change**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/phrases.test.ts packages/video/test/captions-timeline.test.ts packages/video/test/captions-cjk.test.ts
cd "$WT" && npx vitest run tests/english-baseline.test.ts
cd "$WT" && npm run typecheck && npx biome check --write packages/video/src/captions.ts packages/video/test/phrases.test.ts
```

Expected: all PASS, and the English baseline passes without `-u` (caption chunks and cue times are unchanged).

- [ ] **Step 5: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src/captions.ts packages/video/test/phrases.test.ts && git commit -F - <<'EOF'
Time phrases with the captions' text-weighted split

phraseTime places a phrase inside the caption cue that shows it, by the
weight of the characters before it, so a synced moment lands while its
words are on screen. Caption output is unchanged.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
