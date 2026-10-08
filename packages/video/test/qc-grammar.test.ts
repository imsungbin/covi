import { describe, expect, it } from 'vitest';
import {
  durationCheck,
  hookCheck,
  measureStill,
  mediaCrop,
  parseFreezes,
  speechShareCheck,
  stillCheck,
  timingChecks,
} from '../src/qc.ts';
import type { Timeline, TimelineScene } from '../src/timeline/types.ts';

const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const scene = (
  id: string,
  start: number,
  end: number,
  speech?: [number, number],
): TimelineScene => ({
  id,
  beat: id,
  eyebrow: id,
  start,
  end,
  visual: id === 'covi:outro' ? { kind: 'outro' } : callout,
  expression: 'explaining',
  narrator: true,
  ...(speech ? { speech: { start: speech[0], end: speech[1], text: 'x' } } : {}),
});
const timeline = (scenes: TimelineScene[]) => ({ scenes }) as Pick<Timeline, 'scenes'>;
const story = timeline([
  scene('s1', 0, 4.5, [0.3, 4]),
  scene('s2', 4.2, 9.55, [4.5, 9]),
  scene('covi:outro', 9.55, 12),
]);

describe('the still gate', () => {
  it('reads ffmpeg freezedetect output, a freeze still open at the end included', () => {
    const stderr = [
      '[Parsed_freezedetect_1 @ 0x1] lavfi.freezedetect.freeze_start: 9.166667',
      '[Parsed_freezedetect_1 @ 0x1] lavfi.freezedetect.freeze_duration: 1.733333',
      '[Parsed_freezedetect_1 @ 0x1] lavfi.freezedetect.freeze_end: 10.9',
      'frame=  564 fps=0.0 time=00:00:18.80 speed=37.5x    [Parsed_freezedetect_1 @ 0x1] lavfi.freezedetect.freeze_start: 19.6',
    ].join('\n');
    expect(parseFreezes(stderr, 24)).toEqual([
      { start: 9.166667, end: 10.9 },
      { start: 19.6, end: 24 },
    ]);
    expect(parseFreezes('', 24)).toEqual([]);
  });

  it('warns when the picture freezes for 1.5 s or more of narration, naming the scene', () => {
    const check = stillCheck(story, [{ start: 5, end: 7.5 }]);
    expect(check).toMatchObject({ id: 'still', status: 'warn' });
    expect(check.message).toContain('s2 (2.5 s from 5.0 s)');
    // A freeze across a cut between two lines counts both lines.
    expect(stillCheck(story, [{ start: 3, end: 5.5 }]).message).toContain('s1 (2.0 s from 3.0 s)');
  });

  it('stays quiet for freezes in silence or under 1.5 s of narration', () => {
    expect(stillCheck(story, [{ start: 9, end: 12 }]).status).toBe('pass');
    expect(stillCheck(story, [{ start: 3.5, end: 5.2 }]).status).toBe('pass');
    expect(stillCheck(story, []).status).toBe('pass');
  });

  it('measures on the media region, and skips with a warning when ffmpeg cannot', async () => {
    const frame = { ...story, width: 1080, height: 1920, orientation: 'vertical' } as const;
    const seen: string[][] = [];
    const measured = await measureStill(
      {
        analyze: async (args) => {
          seen.push([...args]);
          return 'lavfi.freezedetect.freeze_start: 5\nlavfi.freezedetect.freeze_end: 7.5';
        },
      },
      'v.mp4',
      frame,
      12,
    );
    expect(seen[0]!.join(' ')).toContain('crop=936:1042:72:372,freezedetect=n=0.001:d=1.5');
    expect(measured.message).toContain('s2 (2.5 s from 5.0 s)');

    // freezedetect needs ffmpeg 4.2; an older one must not fail the whole render.
    const skipped = await measureStill(
      {
        analyze: async () => {
          throw new Error("ffmpeg analysis failed: No such filter: 'freezedetect'");
        },
      },
      'v.mp4',
      frame,
      12,
    );
    expect(skipped).toMatchObject({ id: 'still', status: 'warn' });
    expect(skipped.message).toMatch(/could not measure/i);
    expect(skipped.message).toContain('freezedetect');
  });

  it('crops the media region on even pixels', () => {
    expect(mediaCrop({ width: 1080, height: 1920, orientation: 'vertical' })).toBe(
      '936:1042:72:372',
    );
    expect(mediaCrop({ width: 1920, height: 1080, orientation: 'landscape' })).toBe(
      '1728:662:96:206',
    );
    expect(mediaCrop({ width: 360, height: 640, orientation: 'vertical' })).toBe('312:346:24:124');
  });
});

describe('the hook and the speech share', () => {
  it('warn when the first line starts after 0.5 s', () => {
    expect(hookCheck(story).status).toBe('pass');
    const late = timeline([scene('s1', 0, 4, [0.8, 3.5]), scene('s2', 3.5, 8, [3.8, 7.5])]);
    expect(hookCheck(late)).toMatchObject({ status: 'warn' });
    expect(hookCheck(late).message).toContain('0.80 s');
    // A silent opening scene: the hook comes late.
    const silent = timeline([scene('s1', 0, 2), scene('s2', 1.55, 6, [1.9, 5.5])]);
    expect(hookCheck(silent).status).toBe('warn');
    expect(hookCheck(timeline([scene('s1', 0, 3)])).status).toBe('pass');
  });

  it('warn when narration fills less than 70% of the story, before the outro', () => {
    // 3.7 s + 4.5 s of speech over a story ending at 9.55 s: 86%. The outro is not counted.
    expect(speechShareCheck(story)).toMatchObject({ id: 'speech-share', status: 'pass' });
    const slides = timeline([scene('s1', 0, 6, [0.3, 2]), scene('s2', 5.55, 12, [5.9, 8])]);
    expect(speechShareCheck(slides)).toMatchObject({ status: 'warn' });
    expect(speechShareCheck(slides).message).toMatch(/32%/);
    expect(speechShareCheck(timeline([scene('s1', 0, 3)])).status).toBe('pass');
  });

  it('run with the timing checks', () => {
    const ids = timingChecks({ ...story, captions: [], language: 'en' } as unknown as Timeline).map(
      (c) => c.id,
    );
    expect(ids).toEqual(['caption-timing', 'narration-pace', 'hook', 'speech-share']);
  });
});

describe('the duration window', () => {
  const auto = { target: 28, min: 20, max: 35, auto: true };
  const asked = { target: 60, min: 51, max: 69, auto: false };
  it('is an upper bound: Covi never pads, so a short video passes', () => {
    expect(durationCheck(12, auto).status).toBe('pass');
    expect(durationCheck(35.4, auto).status).toBe('pass');
    expect(durationCheck(36, auto).status).toBe('warn');
    expect(durationCheck(60, auto).status).toBe('fail');
  });

  it('warns under a duration someone asked for', () => {
    expect(durationCheck(40, asked)).toMatchObject({ status: 'warn' });
    expect(durationCheck(40, asked).message).toMatch(/shorter than the 60s asked for/);
    expect(durationCheck(60, asked).status).toBe('pass');
  });
});
