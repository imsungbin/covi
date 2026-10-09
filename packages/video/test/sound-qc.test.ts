import { describe, expect, it } from 'vitest';
import { audibleMusicWanted, audioCheck, soundChecks } from '../src/qc.ts';
import type { AudioRecord } from '../src/sound.ts';

const LIMITS = { fps: 30, minSpacing: 0.15, maxPerSecond: 3 };

function record(overrides: Partial<AudioRecord> = {}): AudioRecord {
  return {
    schemaVersion: 1,
    engine: 'covi-audio-2',
    duration: 30,
    music: {
      use: 'theme',
      source: 'theme',
      reason: 'The Covi theme.',
      placement: 'continuous',
      id: 'covi-theme',
      scoreBpm: 100,
      bpm: 102.4,
      key: 'Eb major',
      start: -1.27,
      sections: [],
      hero: { moment: 10.45, downbeat: 10.45, clear: true },
      logo: { start: 28.76, landing: 29.2 },
      lastLine: 28.5,
      fade: { start: 29.5, end: 30 },
      tailDb: -105,
      audible: { seconds: 24.5, share: 0.8167, thresholdDbfs: -45, window: 0.25 },
      fallbacks: [],
    },
    effects: {
      enabled: true,
      placed: [
        { t: 3, kind: 'click', recipe: 'click', gainDb: -14 },
        { t: 9, kind: 'reveal', recipe: 'reveal', gainDb: -14 },
      ],
      dropped: [],
    },
    levels: {
      voiceLufs: -16,
      musicBelowVoiceDb: 16.2,
      musicRangeLu: 3.1,
      musicJumps: {
        maxDb: 3.4,
        at: 12.3,
        exempt: [
          [0, 1.3],
          [9, 12],
          [28, 30],
        ],
      },
      effectsBelowVoiceDb: 11.2,
      master: { integrated: -16, truePeak: -1.4 },
    },
    ...overrides,
  };
}

const byId = (checks: ReturnType<typeof soundChecks>) =>
  Object.fromEntries(checks.map((c) => [c.id, c]));

describe('audio check', () => {
  const sound = { narrated: true, music: true, effects: true, narrationRequested: true };

  it('passes narration at −16 ± 1 LUFS under −1 dBTP', () => {
    expect(
      audioCheck({ stream: true, integrated: -16.4, truePeak: -1.3, maxVolume: -2 }, sound).status,
    ).toBe('pass');
  });

  it('warns within ±2 LU and fails beyond', () => {
    expect(
      audioCheck({ stream: true, integrated: -17.6, truePeak: -2, maxVolume: -3 }, sound).status,
    ).toBe('warn');
    expect(
      audioCheck({ stream: true, integrated: -19, truePeak: -2, maxVolume: -3 }, sound).status,
    ).toBe('fail');
  });

  it('holds music without narration to −20 LUFS', () => {
    const music = { ...sound, narrated: false, narrationRequested: false };
    expect(
      audioCheck({ stream: true, integrated: -20.3, truePeak: -3, maxVolume: -4 }, music).status,
    ).toBe('pass');
    expect(
      audioCheck({ stream: true, integrated: -16, truePeak: -3, maxVolume: -4 }, music).status,
    ).toBe('fail');
  });

  it('warns on a true peak above −1 dBTP and fails above −0.5', () => {
    const at = (truePeak: number) =>
      audioCheck({ stream: true, integrated: -16, truePeak, maxVolume: -1 }, sound).status;
    expect([at(-1), at(-0.8), at(-0.4)]).toEqual(['pass', 'warn', 'fail']);
  });

  it('fails without a stream or with a silent one when anything should play', () => {
    expect(audioCheck({ stream: false }, sound).status).toBe('fail');
    expect(
      audioCheck({ stream: true, integrated: -70, truePeak: -80, maxVolume: -91 }, sound).status,
    ).toBe('fail');
  });

  it('has no loudness target for effects alone, but still a stream that is not silent', () => {
    const effects = { narrated: false, music: false, effects: true, narrationRequested: false };
    expect(
      audioCheck({ stream: true, integrated: -41, truePeak: -16, maxVolume: -17 }, effects).status,
    ).toBe('pass');
  });

  it('expects no stream when everything is off', () => {
    const off = { narrated: false, music: false, effects: false, narrationRequested: false };
    expect(audioCheck({ stream: false }, off)).toMatchObject({ status: 'pass' });
    expect(audioCheck({ stream: false }, { ...off, narrationRequested: true }).status).toBe('warn');
  });
});

describe('sound checks', () => {
  it('pass a well-placed mix', () => {
    const checks = byId(soundChecks(record(), LIMITS));
    expect(Object.keys(checks)).toEqual([
      'music-under-speech',
      'music-jump',
      'music-range',
      'music-fit',
      'music-audible',
      'sound-effects',
    ]);
    for (const c of Object.values(checks)) expect(c.status, c.message).toBe('pass');
  });

  it('want at least 3 s of audible music, or 5% of a longer video', () => {
    expect(audibleMusicWanted(30)).toBe(3);
    expect(audibleMusicWanted(60)).toBe(3);
    expect(audibleMusicWanted(93.6)).toBeCloseTo(4.68, 5);
    expect(audibleMusicWanted(120)).toBe(6);
  });

  it('warn when requested music is barely heard outside the logo', () => {
    const audible = (seconds: number, duration: number, placement: 'continuous' | 'bookends') =>
      byId(
        soundChecks(
          record({
            duration,
            music: {
              ...record().music,
              placement,
              audible: { seconds, share: seconds / duration, thresholdDbfs: -45, window: 0.25 },
            },
          }),
          LIMITS,
        ),
      )['music-audible']!;
    // The reported video: 1.2 s of music in 93.6 s, all of it the logo itself.
    const reported = audible(0, 93.6, 'bookends');
    expect(reported.status).toBe('warn');
    expect(reported.message).toMatch(/0\.00 s outside the logo .*4\.68 s wanted/);
    expect(reported.message).toMatch(/--music-placement continuous/);
    expect(audible(4.5, 93.6, 'bookends').status).toBe('warn');
    expect(audible(2.75, 30, 'continuous').status).toBe('warn');
    // Enough music: quiet.
    expect(audible(4.75, 93.6, 'bookends').status).toBe('pass');
    expect(audible(3, 30, 'continuous').status).toBe('pass');
    expect(audible(6.25, 93.6, 'bookends').message).toMatch(
      /heard for 6\.25 s outside the logo \(6\.7% of the video; at least 4\.68 s wanted\); the hero downbeat is clear of speech/,
    );
  });

  it('warn when the hero downbeat falls under speech that bookends mute', () => {
    const hero = (clear: boolean, placement: 'continuous' | 'bookends') =>
      byId(
        soundChecks(
          record({
            music: {
              ...record().music,
              placement,
              hero: { moment: 10.45, downbeat: 10.45, clear },
            },
          }),
          LIMITS,
        ),
      )['music-audible']!;
    expect(hero(false, 'bookends').status).toBe('warn');
    expect(hero(false, 'bookends').message).toMatch(/hero downbeat at 10\.45 s falls under speech/);
    // A continuous bed is still heard under speech, so its hero is never muted.
    expect(hero(false, 'continuous').status).toBe('pass');
    expect(hero(true, 'bookends').status).toBe('pass');
  });

  it('do not measure audibility when no music plays', () => {
    const none = byId(
      soundChecks(
        record({ music: { use: 'none', source: 'none', reason: 'off', placement: 'continuous' } }),
        LIMITS,
      ),
    )['music-audible']!;
    expect(none).toMatchObject({ status: 'pass', message: 'Music is off.' });
    const short = byId(
      soundChecks(
        record({
          music: {
            use: 'theme',
            source: 'none',
            reason: 'The video is shorter than 8 s, too short for music.',
            placement: 'continuous',
          },
        }),
        LIMITS,
      ),
    )['music-audible']!;
    expect(short.status).toBe('pass');
    expect(short.message).toMatch(/too short for music/);
  });

  it('grade music under speech by placement: a bed 12–20 dB under the voice, bookends 30', () => {
    const under = (db: number, placement: 'continuous' | 'bookends') =>
      byId(
        soundChecks(
          record({
            music: { ...record().music, placement },
            levels: { ...record().levels, musicBelowVoiceDb: db },
          }),
          LIMITS,
        ),
      )['music-under-speech']!.status;
    expect([12, 16, 20].map((db) => under(db, 'continuous'))).toEqual(['pass', 'pass', 'pass']);
    expect([21, 11.9, 9, 8.9].map((db) => under(db, 'continuous'))).toEqual([
      'warn',
      'warn',
      'warn',
      'fail',
    ]);
    expect([under(31, 'bookends'), under(25, 'bookends')]).toEqual(['pass', 'warn']);
  });

  it('fail music that jumps more than 6 dB within a second outside the exempt windows', () => {
    const jump = (maxDb: number | undefined, pausesHeld?: number) =>
      byId(
        soundChecks(
          record({
            levels: {
              ...record().levels,
              musicJumps:
                maxDb === undefined ? undefined : { ...record().levels.musicJumps!, maxDb },
              ...(pausesHeld ? { pausesHeld } : {}),
            },
          }),
          LIMITS,
        ),
      )['music-jump']!;
    expect(jump(6).status).toBe('pass');
    expect(jump(6.4).status).toBe('fail');
    expect(jump(6.4).message).toMatch(/6\.4 dB within 1 s at 12\.30 s/);
    expect(jump(6.4).message).toMatch(/0\.0–1\.3 s, 9\.0–12\.0 s, 28\.0–30\.0 s/);
    expect(jump(3.4, 2).message).toMatch(/2 pause\(s\) held/);
    // Not measured (no narration, or a 0.2.0 record): nothing to fail.
    expect(jump(undefined).status).toBe('pass');
  });

  it("warn when the music's loudness range over the narration exceeds 8 LU", () => {
    const range = (lu: number | undefined, placement: 'continuous' | 'bookends' = 'continuous') =>
      byId(
        soundChecks(
          record({
            music: { ...record().music, placement },
            levels: { ...record().levels, musicRangeLu: lu },
          }),
          LIMITS,
        ),
      )['music-range']!;
    expect(range(8).status).toBe('pass');
    expect(range(8.6).status).toBe('warn');
    expect(range(8.6, 'bookends').message).toMatch(/continuous keeps one bed/);
    expect(range(undefined).status).toBe('pass');
  });

  it('pass a record written before these checks existed', () => {
    const { musicJumps: _j, musicRangeLu: _r, ...old } = record().levels;
    const checks = byId(soundChecks(record({ levels: old }), LIMITS));
    expect(checks['music-jump']!.status).toBe('pass');
    expect(checks['music-range']!.status).toBe('pass');
  });

  it('fail a logo that overlaps the last line, and a tail that does not fade out', () => {
    const music = record().music;
    const fit = (m: Partial<AudioRecord['music']>) =>
      byId(soundChecks(record({ music: { ...music, ...m } }), LIMITS))['music-fit']!;
    expect(fit({ logo: { start: 28.55, landing: 29 } }).status).toBe('fail');
    expect(fit({ tailDb: -40 }).status).toBe('fail');
    expect(fit({ logo: { start: 28.9, landing: 29.5 } }).status).toBe('warn');
    expect(fit({ bpm: 108 }).message).toMatch(/8\.0%/);
    const offGrid = fit({
      hero: { moment: 10.45, downbeat: 10.9 },
      fallbacks: [
        'No tempo within ±10% puts a downbeat on the hero; it starts on the nearest bar, 0.45 s late.',
      ],
    });
    expect(offGrid.status).toBe('warn');
    expect(offGrid.message).toMatch(/nearest bar/);
    expect(fit({ error: 'boom', bpm: undefined }).status).toBe('warn');
    // The logo lands as the outro settles; off it, the fitter's reason is the message.
    expect(fit({ outro: 29.2 })).toMatchObject({ status: 'pass' });
    expect(fit({ outro: 29.2 }).message).toMatch(/lands as the outro settles/);
    const off = fit({
      outro: 28.6,
      fallbacks: [
        'The logo cannot land on the outro at 28.60 s: the last line leaves no room before it.',
      ],
    });
    expect(off.status).toBe('warn');
    expect(off.message).toMatch(/cannot land on the outro/);
  });

  it('pass when there is no music, or no narration to sit under', () => {
    const none = byId(
      soundChecks(
        record({
          music: { use: 'none', source: 'none', reason: 'off', placement: 'continuous' },
          levels: { voiceLufs: -16, effectsBelowVoiceDb: 11 },
        }),
        LIMITS,
      ),
    );
    expect(none['music-under-speech']!.status).toBe('pass');
    expect(none['music-fit']!.status).toBe('pass');
  });

  it('fail effects that crowd each other, and grade their level under the voice', () => {
    const effects = (placed: number[], below?: number) =>
      byId(
        soundChecks(
          record({
            effects: {
              enabled: true,
              placed: placed.map((t) => ({ t, kind: 'click', recipe: 'click', gainDb: -14 })),
              dropped: [],
            },
            levels: { ...record().levels, effectsBelowVoiceDb: below },
          }),
          LIMITS,
        ),
      )['sound-effects']!.status;
    expect(effects([1, 1.1], 10)).toBe('fail');
    expect(effects([1, 1.2, 1.4, 1.6], 10)).toBe('fail');
    expect(effects([1, 2], 8)).toBe('pass');
    expect(effects([1, 2], 7)).toBe('warn');
    expect(effects([1, 2], 4)).toBe('warn');
    expect(effects([1, 2], 2)).toBe('fail');
    expect(effects([1, 2], undefined)).toBe('pass');
    // A riser's onset is quiet: a click on it is not crowding, though a full second still is.
    const withRiser = (placed: Array<[number, 'click' | 'riser']>) =>
      byId(
        soundChecks(
          record({
            effects: {
              enabled: true,
              placed: placed.map(([t, kind]) => ({ t, kind, recipe: kind, gainDb: -14 })),
              dropped: [],
            },
          }),
          LIMITS,
        ),
      )['sound-effects']!.status;
    expect(
      withRiser([
        [1, 'riser'],
        [1.04, 'click'],
      ]),
    ).toBe('pass');
    expect(
      withRiser([
        [1, 'riser'],
        [1.3, 'click'],
        [1.6, 'click'],
        [1.9, 'click'],
      ]),
    ).toBe('fail');
    expect(
      byId(soundChecks(record({ effects: { enabled: false, placed: [], dropped: [] } }), LIMITS))[
        'sound-effects'
      ]!.message,
    ).toMatch(/off/);
  });
});
