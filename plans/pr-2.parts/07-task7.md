### Task 7: Caption emphasis for the `[[…]]` phrase

The marked phrase is found in the cues that show it (per line, as UTF-16 offsets into the line string, so the runtime can wrap it in a span) with the times its first and last characters are spoken, from Task 2's machinery. The runtime sweeps a cobalt marker behind it as it is spoken. The voice, `video/speech.json`, `video/narration.md`, and the subtitle files never see the brackets.

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (`CaptionEmphasis`, `CaptionCue.emphasis`)
- Modify: `packages/video/src/captions.ts` (`buildCaptions` windows take `emphasis`)
- Modify: `packages/video/src/timeline/build.ts` (pass each line's emphasis span)
- Modify: `packages/video/src/narration/speech.ts` (`speakScenes` strips markup)
- Modify: `packages/video/src/pipeline.ts` (language detection reads the line without markup)
- Modify: `packages/video/src/runtime/stage.ts` (caption spans and the sweep)
- Modify: `packages/video/src/runtime/styles.ts` (`.caption-box .em`)
- Test: `packages/video/test/emphasis.test.ts` (create)

**Interfaces:**
- Consumes: `parseEmphasis`, `emphasisSpan`, `stripEmphasis`, `findPhrase`, `PhraseSpan` (Task 1); `timeWindow`, `spokenAt`, `charWeight` (Task 2, internal to `captions.ts`).
- Produces: `interface CaptionEmphasis { line: number; from: number; to: number; start: number; end: number }`; `CaptionCue.emphasis?: CaptionEmphasis[]`; `buildCaptions(windows: Array<{ text: string; start: number; end: number; emphasis?: PhraseSpan }>, options)`.

- [ ] **Step 1: Write the failing test**

Create `packages/video/test/emphasis.test.ts`:

```ts
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { buildCaptions, captionOptionsFor, toSrt, toVtt } from '../src/captions.ts';
import { speakScenes } from '../src/narration/speech.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { emphasisSpan, findPhrase, parseEmphasis } from '../src/storyboard/grammar.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes } from '../src/timeline/build.ts';

const landscape = captionOptionsFor('landscape');

describe('caption emphasis', () => {
  it('marks the phrase in the line that shows it, with when it is spoken', () => {
    const text = 'One two three four.';
    const [cue] = buildCaptions(
      [{ text, start: 0, end: 4, emphasis: findPhrase(text, 'three') }],
      landscape,
    );
    expect(cue!.emphasis).toEqual([{ line: 0, from: 8, to: 13, start: 1.5, end: 2.75 }]);
    expect(cue!.lines[0]!.slice(8, 13)).toBe('three');
  });

  it('splits a phrase across the lines and the cues it spans', () => {
    const narrow = { maxChars: 10, maxLines: 2, minDuration: 0.9 };
    const text = 'aaa bbb ccc ddd';
    const [cue] = buildCaptions(
      [{ text, start: 0, end: 3, emphasis: findPhrase(text, 'bbb ccc') }],
      narrow,
    );
    expect(cue!.lines).toEqual(['aaa bbb', 'ccc ddd']);
    expect(cue!.emphasis).toEqual([
      { line: 0, from: 4, to: 7, start: 0.75, end: 1.5 },
      { line: 1, from: 0, to: 3, start: 1.5, end: 2.25 },
    ]);
    const two = 'One two. Three four.';
    const cues = buildCaptions(
      [{ text: two, start: 0, end: 3.4, emphasis: findPhrase(two, 'two. Three') }],
      landscape,
    );
    expect(cues.map((c) => c.emphasis)).toEqual([
      [{ line: 0, from: 4, to: 8, start: 0.6, end: 1.4 }],
      [{ line: 0, from: 0, to: 5, start: 1.4, end: 2.4 }],
    ]);
  });

  it('counts characters in Korean and around emoji', () => {
    const ko = { ...captionOptionsFor('vertical'), language: 'ko' as const };
    const korean = parseEmphasis('남은 [[글자 수]]가 보입니다.');
    const [cue] = buildCaptions(
      [{ text: korean.text, start: 0, end: 2.1, emphasis: emphasisSpan(korean) }],
      ko,
    );
    const [mark] = cue!.emphasis!;
    expect(cue!.lines[mark!.line]!.slice(mark!.from, mark!.to)).toBe('글자 수');
    expect(mark).toMatchObject({ start: 0.4, end: 1 });
    const emoji = parseEmphasis('🎉 Ready to [[merge]].');
    const [party] = buildCaptions(
      [{ text: emoji.text, start: 0, end: 3, emphasis: emphasisSpan(emoji) }],
      landscape,
    );
    expect(party!.emphasis).toEqual([{ line: 0, from: 12, to: 17, start: 1.8, end: 2.8 }]);
  });

  it('leaves plain captions alone, and keeps emphasis out of the subtitle files', () => {
    const text = 'One two three four.';
    const plain = buildCaptions([{ text, start: 0, end: 4 }], landscape);
    const marked = buildCaptions(
      [{ text, start: 0, end: 4, emphasis: findPhrase(text, 'three') }],
      landscape,
    );
    expect(plain[0]).not.toHaveProperty('emphasis');
    expect(toVtt(marked)).toBe(toVtt(plain));
    expect(toSrt(marked)).toBe(toSrt(plain));
  });
});

describe('the markup never reaches the voice', () => {
  it('is stripped from what the voice reads and what speech.json records', () => {
    const [scene] = speakScenes(
      [{ id: 's1', narration: 'It [[counts down]].', say: 'It [[counts]] down.' }],
      { language: 'en' },
    );
    expect(scene).toMatchObject({
      narration: 'It counts down.',
      say: 'It counts down.',
      spoken: 'It counts down.',
    });
  });

  it('reaches the timeline captions as emphasis, on its words', () => {
    const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
    const scenes = [
      { id: 's1', beat: 's1', narration: 'It counts [[down to zero]].', visual: { kind: 'callout', tone: 'info', title: 'C' } },
      { id: 's2', beat: 's2', narration: 'Done.', visual: { kind: 'callout', tone: 'info', title: 'C' } },
    ] as Scene[];
    const timeline = buildTimeline({
      title: 'T',
      scenes,
      layout: layoutScenes(scenes, new Map()),
      spec,
      image: () => ({ src: '', width: 1, height: 1 }),
    });
    const cue = timeline.captions.find((c) => c.emphasis)!;
    const [mark] = cue.emphasis!;
    expect(cue.lines[mark!.line]!.slice(mark!.from, mark!.to)).toBe('down to zero');
    expect(mark!.start).toBeGreaterThan(timeline.scenes[0]!.speech!.start);
    expect(mark!.end).toBeLessThanOrEqual(cue.end);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/emphasis.test.ts
```

Expected: FAIL (no `emphasis` on cues; `speakScenes` keeps the brackets).

- [ ] **Step 3: Add the type in `packages/video/src/timeline/types.ts`**

Replace `CaptionCue` with:

```ts
/** The key phrase in a caption line: where it is in the line and when it is spoken. */
export interface CaptionEmphasis {
  /** Index into the cue's `lines`. */
  line: number;
  /** UTF-16 offsets into that line: the phrase is `line.slice(from, to)`. */
  from: number;
  to: number;
  /** When its first character is spoken and when its last one has been, in seconds. */
  start: number;
  end: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  lines: string[];
  /** The line's `[[…]]` phrase, split across lines (and cues) when it wraps. */
  emphasis?: CaptionEmphasis[];
}
```

- [ ] **Step 4: Mark the phrase in `packages/video/src/captions.ts`**

Replace `buildCaptions` with:

```ts
/**
 * Times cues within each speech window in proportion to their length, honoring a minimum
 * duration, and marks a window's emphasized phrase in the cues that show it.
 */
export function buildCaptions(
  windows: Array<{ text: string; start: number; end: number; emphasis?: PhraseSpan }>,
  options: CaptionOptions,
): CaptionCue[] {
  const weight = charWeight(options.language ?? 'en');
  return windows.flatMap((w) => {
    const timed = timeWindow(w, options);
    if (!timed) return [];
    if (w.emphasis && w.emphasis.index >= 0 && w.emphasis.length > 0)
      emphasize(timed, w.emphasis, weight);
    return timed.cues;
  });
}

/**
 * Finds the phrase in each line that shows part of it: the UTF-16 range it covers there, and
 * when that part is spoken, for the caption's sweep.
 */
function emphasize(timed: TimedWindow, span: PhraseSpan, weight: (char: string) => number): void {
  const end = span.index + span.length;
  let from = 0;
  for (const cue of timed.cues) {
    cue.lines.forEach((line, l) => {
      // The line's characters without whitespace, with where each starts in the string.
      const chars: Array<{ at: number; size: number }> = [];
      let at = 0;
      for (const char of line) {
        if (!/\s/.test(char)) chars.push({ at, size: char.length });
        at += char.length;
      }
      const a = Math.max(span.index, from);
      const b = Math.min(end, from + chars.length);
      if (a < b) {
        const first = chars[a - from]!;
        const last = chars[b - 1 - from]!;
        cue.emphasis ??= [];
        cue.emphasis.push({
          line: l,
          from: first.at,
          to: last.at + last.size,
          start: round(spokenAt(timed, a, weight)),
          end: round(spokenAt(timed, b, weight)),
        });
      }
      from += chars.length;
    });
  }
}
```

- [ ] **Step 5: Pass each line's emphasis in `packages/video/src/timeline/build.ts`**

Add `emphasisSpan` to the grammar import and `type PhraseSpan` too. In `buildTimeline`, before the scenes map, add `const emphasis = new Map<string, PhraseSpan>();`, and in the map replace `const text = parseEmphasis(scene.narration).text;` with:

```ts
    const line = parseEmphasis(scene.narration);
    const text = line.text;
    const span = emphasisSpan(line);
    if (span) emphasis.set(timing.id, span);
```

In the captions block, add the span to each window: `emphasis: emphasis.get(s.id),`.

- [ ] **Step 6: Strip the markup before the voice in `packages/video/src/narration/speech.ts`**

Add `import { stripEmphasis } from '../storyboard/grammar.ts';` and change `speakScenes`'s map body to:

```ts
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
```

In `packages/video/src/pipeline.ts`, import `stripEmphasis` from `./storyboard/grammar.ts` and change the `said` line to:

```ts
  const said = storyboard.scenes.map((s) => stripEmphasis(s.say ?? s.narration).trim());
```

- [ ] **Step 7: Sweep the phrase in the runtime**

In `packages/video/src/runtime/stage.ts`, add a field `private emphasis: Array<{ node: HTMLElement; start: number; end: number }> = [];` and replace the captions block of `seek` (from `const cue = …` to the closing brace of the `if (cue) … else …`) with:

```ts
    const cue = t.captions.find((c) => time >= c.start && time < c.end);
    const key = cue ? `${cue.start}` : '';
    if (key !== this.captionKey) {
      this.captionKey = key;
      this.captionBox.innerHTML = '';
      this.emphasis = [];
      for (const [i, line] of (cue?.lines ?? []).entries()) {
        const span = el('span', 'line', this.captionBox);
        let at = 0;
        for (const mark of (cue?.emphasis ?? []).filter((e) => e.line === i)) {
          if (mark.from > at) span.append(line.slice(at, mark.from));
          const node = el('span', 'em', span, line.slice(mark.from, mark.to));
          this.emphasis.push({ node, start: mark.start, end: mark.end });
          at = mark.to;
        }
        if (at < line.length) span.append(line.slice(at));
      }
    }
    // The marker sweeps under the key phrase as it is spoken (at least a quarter second).
    for (const e of this.emphasis) {
      const p = easeInOutCubic(seg(time, e.start, Math.max(e.end, e.start + 0.25)));
      e.node.style.backgroundSize = `${(p * 100).toFixed(2)}% 100%`;
    }
    if (cue) {
      const inP = seg(time, cue.start, cue.start + 0.12);
      const outP = seg(time, cue.end - 0.1, cue.end);
      const next = t.captions.find((c) => Math.abs(c.start - cue.end) < 0.05);
      this.captionBox.style.opacity = String(Math.min(inP, next ? 1 : 1 - outP).toFixed(3));
    } else {
      this.captionBox.style.opacity = '0';
    }
```

In `packages/video/src/runtime/styles.ts`, after the `.caption-box .line` rule, add:

```ts
.caption-box .em { background-image: linear-gradient(${c.primary}, ${c.primary}); background-repeat: no-repeat;
  background-position: 0 50%; background-size: 0% 100%; border-radius: ${u(6)};
  -webkit-box-decoration-break: clone; box-decoration-break: clone; }
```

(White caption text on cobalt `#3B5BFF` reads at 4.9:1; the marker has no padding, so line widths and the caption-overflow check are unchanged.)

- [ ] **Step 8: Run the tests**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/emphasis.test.ts packages/video/test tests/english-baseline.test.ts tests/multilingual.test.ts
cd "$WT" && npm run typecheck && npx vitest run tests/render/render.test.ts
cd "$WT" && npx biome check --write packages/video/src packages/video/test/emphasis.test.ts
```

Expected: all PASS; the English baseline is unchanged (no drafted narration carries markup).

- [ ] **Step 9: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src packages/video/test/emphasis.test.ts && git commit -F - <<'EOF'
Sweep the caption's key phrase as it is spoken

A phrase marked [[…]] in the narration is found in the caption lines
that show it and swept with a cobalt marker from its first word to its
last. The voice, speech.json, reports, and subtitle files get the line
without the markup.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
