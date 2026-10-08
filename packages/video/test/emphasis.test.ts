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
      {
        id: 's1',
        beat: 's1',
        narration: 'It counts [[down to zero]].',
        visual: { kind: 'callout', tone: 'info', title: 'C' },
      },
      {
        id: 's2',
        beat: 's2',
        narration: 'Done.',
        visual: { kind: 'callout', tone: 'info', title: 'C' },
      },
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
