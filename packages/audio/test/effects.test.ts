import { describe, expect, it } from 'vitest';
import {
  type EffectCue,
  effectRecipe,
  effectTranspose,
  placeEffects,
  type SoundEffectsConfig,
} from '../src/effects.ts';
import { BED_DB } from '../src/placement.ts';

const config: SoundEffectsConfig = {
  gainDb: 1,
  verdictBoostDb: 2,
  outroBoostDb: 2,
  swellCutDb: 4,
  softCutDb: 4,
  minSpacing: 0.15,
  maxPerSecond: 3,
  recipes: {
    click: 'click',
    reveal: 'reveal',
    finding: 'finding',
    'finding-high': 'finding-high',
    'verdict-looks-good': 'verdict-looks-good',
    'verdict-needs-attention': 'verdict-needs-attention',
    'verdict-needs-changes': 'verdict-needs-changes',
    'outro-looks-good': 'outro-looks-good',
    'outro-needs-attention': 'outro-needs-attention',
    'outro-needs-changes': 'outro-needs-changes',
    transition: 'transition',
    riser: 'riser',
    hero: 'hero',
    camera: 'camera',
    count: 'tick',
    merge: 'thump',
    appear: 'accent',
  },
};

const cue = (t: number, kind: EffectCue['kind'], detail?: string): EffectCue => ({
  t,
  kind,
  scene: 's',
  ...(detail ? { detail } : {}),
});

/** A counter counting from `t` for `seconds`, its printed number taking `steps`. */
const count = (t: number, seconds: number, steps?: number): EffectCue => ({
  t,
  kind: 'count',
  scene: 's',
  seconds,
  ...(steps === undefined ? {} : { steps }),
});

describe('effect recipes', () => {
  it('map each cue to its recipe and priority', () => {
    expect(effectRecipe(cue(1, 'click'), config)).toEqual({ recipe: 'click', priority: 1 });
    expect(effectRecipe(cue(1, 'finding', 'high'), config)).toEqual({
      recipe: 'finding-high',
      priority: 2,
    });
    expect(effectRecipe(cue(1, 'finding'), config).recipe).toBe('finding');
    expect(effectRecipe(cue(1, 'verdict', 'needs-changes'), config)).toEqual({
      recipe: 'verdict-needs-changes',
      priority: 3,
    });
  });
});

describe('the outro sign-off', () => {
  it('follows the verdict, and comes first when cues compete', () => {
    expect(effectRecipe(cue(1, 'outro', 'needs-changes'), config)).toEqual({
      recipe: 'outro-needs-changes',
      priority: 4,
    });
    expect(effectRecipe(cue(1, 'outro', 'needs-attention'), config).recipe).toBe(
      'outro-needs-attention',
    );
    expect(effectRecipe(cue(1, 'outro'), config).recipe).toBe('outro-looks-good');
    const { placed, dropped } = placeEffects(
      [cue(20, 'verdict', 'looks-good'), cue(20.1, 'outro', 'looks-good')],
      config,
    );
    expect(placed.map((p) => p.kind)).toEqual(['outro']);
    expect(dropped.map((d) => d.kind)).toEqual(['verdict']);
  });

  it('plays a little louder, in the quiet after the narration', () => {
    const { placed } = placeEffects([cue(3, 'click'), cue(30, 'outro', 'looks-good')], config);
    expect(placed.map((p) => p.gainDb)).toEqual([BED_DB + 1, BED_DB + 3]);
  });
});

describe('placeEffects', () => {
  it('places every cue at the configured level, louder for the verdict', () => {
    const { placed, dropped } = placeEffects(
      [cue(1, 'click'), cue(2, 'reveal'), cue(5, 'verdict', 'looks-good')],
      config,
    );
    expect(dropped).toEqual([]);
    expect(placed).toEqual([
      { t: 1, kind: 'click', recipe: 'click', gainDb: BED_DB + 1 },
      { t: 2, kind: 'reveal', recipe: 'reveal', gainDb: BED_DB + 1 },
      { t: 5, kind: 'verdict', recipe: 'verdict-looks-good', gainDb: BED_DB + 3 },
    ]);
  });

  it('keeps effects apart, dropping the lower-priority cue when two compete', () => {
    const { placed, dropped } = placeEffects(
      [cue(3, 'finding'), cue(3.1, 'verdict', 'needs-attention'), cue(3.2, 'click')],
      config,
    );
    expect(placed.map((p) => p.kind)).toEqual(['verdict']);
    expect(dropped.map((d) => [d.kind, d.reason])).toEqual([
      ['finding', expect.stringMatching(/0\.15 s/)],
      ['click', expect.stringMatching(/0\.15 s/)],
    ]);
  });

  it('prefers a high-severity finding over an ordinary one', () => {
    const { placed } = placeEffects([cue(1, 'finding'), cue(1.05, 'finding', 'high')], config);
    expect(placed).toEqual([
      { t: 1.05, kind: 'finding', recipe: 'finding-high', gainDb: BED_DB + 1 },
    ]);
  });

  it('allows at most three effects in any second', () => {
    const cues = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2].map((t) => cue(t, 'click'));
    const { placed, dropped } = placeEffects(cues, config);
    const times = placed.map((p) => p.t);
    for (let i = 3; i < times.length; i++)
      expect(times[i]! - times[i - 3]!).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(placed.length + dropped.length).toBe(7);
    expect(dropped[0]!.reason).toMatch(/3 per second/);
  });

  it('writes levels against the music bed, so they move with it', () => {
    const { placed } = placeEffects([cue(1, 'click')], { ...config, gainDb: -2 });
    expect(placed[0]!.gainDb).toBe(BED_DB - 2);
  });
});

describe('effectTranspose', () => {
  it('moves effects written in C to the parent major of the music, by the nearest octave', () => {
    const key = (tonic: number, mode: string) => ({ tonic: 48 + tonic, mode });
    expect(effectTranspose(key(3, 'major'))).toBe(3); // E♭ major
    expect(effectTranspose(key(9, 'minor'))).toBe(0); // A minor shares C major's notes
    expect(effectTranspose(key(2, 'dorian'))).toBe(0);
    expect(effectTranspose(key(7, 'mixolydian'))).toBe(0);
    expect(effectTranspose(key(6, 'minor'))).toBe(-3); // F♯ minor → A major
    expect(effectTranspose(key(11, 'major'))).toBe(-1);
    expect(effectTranspose(key(6, 'major'))).toBe(6);
  });
});

describe('the hero stack and the swells', () => {
  it('map the hit, the riser, and the whoosh to their recipes and priorities', () => {
    expect(effectRecipe(cue(1, 'hero'), config)).toEqual({ recipe: 'hero', priority: 3 });
    expect(effectRecipe(cue(1, 'riser'), config)).toEqual({ recipe: 'riser', priority: 0 });
    expect(effectRecipe(cue(1, 'transition'), config)).toEqual({
      recipe: 'transition',
      priority: 0,
    });
  });

  it('play swells 4 dB under the other effects', () => {
    const { placed } = placeEffects(
      [cue(1, 'transition'), cue(2, 'riser'), cue(2.8, 'hero')],
      config,
    );
    expect(placed.map((p) => [p.kind, p.gainDb])).toEqual([
      ['transition', BED_DB - 3],
      ['riser', BED_DB - 3],
      ['hero', BED_DB + 1],
    ]);
  });

  it("keeps a riser and a click on its start: the riser's onset is quiet", () => {
    const { placed, dropped } = placeEffects(
      [cue(2, 'riser'), cue(2.04, 'click'), cue(2.1, 'transition')],
      config,
    );
    expect(placed.map((p) => [p.kind, p.t])).toEqual([
      ['riser', 2],
      ['click', 2.04],
    ]);
    // The whoosh is a transient: the click still crowds it out, the riser does not.
    expect(dropped.map((d) => [d.kind, d.reason])).toEqual([
      ['transition', expect.stringMatching(/0\.15 s/)],
    ]);
  });

  it('drops a riser from a full second, even one that starts it', () => {
    const { placed, dropped } = placeEffects(
      [cue(2, 'riser'), cue(2.3, 'click'), cue(2.6, 'finding'), cue(2.9, 'reveal')],
      config,
    );
    expect(placed.map((p) => p.kind)).toEqual(['click', 'finding', 'reveal']);
    expect(dropped.map((d) => [d.kind, d.reason])).toEqual([
      ['riser', expect.stringMatching(/3 per second/)],
    ]);
  });

  it("keeps the hero's hit over a click at the same moment", () => {
    const { placed, dropped } = placeEffects([cue(3, 'click'), cue(3.05, 'hero')], config);
    expect(placed.map((p) => p.kind)).toEqual(['hero']);
    expect(dropped.map((d) => d.kind)).toEqual(['click']);
  });

  it('gives up a swell first when a second is full, even one that comes first', () => {
    // In time order the whoosh would be placed and the reveal dropped; the whoosh yields.
    const { placed, dropped } = placeEffects(
      [cue(1, 'transition'), cue(1.3, 'click'), cue(1.6, 'finding'), cue(1.9, 'reveal')],
      config,
    );
    expect(placed.map((p) => p.kind)).toEqual(['click', 'finding', 'reveal']);
    expect(dropped.map((d) => [d.kind, d.reason])).toEqual([
      ['transition', expect.stringMatching(/3 per second/)],
    ]);
  });

  it("keeps the hero's hit over a high-severity finding landing with it", () => {
    const { placed, dropped } = placeEffects(
      [cue(3, 'finding', 'high'), cue(3.05, 'hero')],
      config,
    );
    expect(placed.map((p) => p.kind)).toEqual(['hero']);
    expect(dropped.map((d) => [d.kind, d.recipe])).toEqual([['finding', 'finding-high']]);
  });

  it('keeps the earlier of a verdict and a hero hit, which rank the same', () => {
    const heroFirst = placeEffects([cue(3.05, 'verdict', 'looks-good'), cue(3, 'hero')], config);
    expect(heroFirst.placed.map((p) => p.kind)).toEqual(['hero']);
    expect(heroFirst.dropped.map((d) => d.kind)).toEqual(['verdict']);
    const verdictFirst = placeEffects([cue(3.05, 'hero'), cue(3, 'verdict', 'looks-good')], config);
    expect(verdictFirst.placed.map((p) => p.kind)).toEqual(['verdict']);
    expect(verdictFirst.dropped.map((d) => d.kind)).toEqual(['hero']);
  });
});

describe('the sounds of a directed shot', () => {
  it('map the camera, a count, a merge, and an appearance to their recipes and ranks', () => {
    expect(effectRecipe(cue(1, 'camera', 'zoom'), config)).toEqual({
      recipe: 'camera',
      priority: 0,
    });
    expect(effectRecipe(count(1, 1.6), config)).toEqual({ recipe: 'tick', priority: 1 });
    expect(effectRecipe(cue(1, 'merge'), config)).toEqual({ recipe: 'thump', priority: 1 });
    expect(effectRecipe(cue(1, 'appear'), config)).toEqual({ recipe: 'accent', priority: 0.5 });
  });

  it('play the thump with the landings, ticks and accents softer, the camera as a swell', () => {
    const { placed, dropped } = placeEffects(
      [cue(1, 'camera'), count(2, 1.6), cue(4.5, 'merge'), cue(6, 'appear')],
      config,
    );
    expect(dropped).toEqual([]);
    expect(placed).toEqual([
      { t: 1, kind: 'camera', recipe: 'camera', gainDb: BED_DB - 3 },
      { t: 2, kind: 'count', recipe: 'tick', gainDb: BED_DB - 3, seconds: 1.6, ticks: 10 },
      { t: 4.5, kind: 'merge', recipe: 'thump', gainDb: BED_DB + 1 },
      { t: 6, kind: 'appear', recipe: 'accent', gainDb: BED_DB - 3 },
    ]);
  });

  it("count a counter's ticks as one effect, so a busy second never thins them out", () => {
    // Thirteen ticks in 2.4 s, then two clicks inside the count: three effects in the second.
    const { placed, dropped } = placeEffects(
      [count(1, 2.4), cue(1.4, 'click'), cue(1.8, 'click')],
      config,
    );
    expect(dropped).toEqual([]);
    expect(placed.map((p) => [p.kind, p.ticks])).toEqual([
      ['count', 13],
      ['click', undefined],
      ['click', undefined],
    ]);
  });

  it('never ticks two counters at once: the later count gives way', () => {
    const { placed, dropped } = placeEffects([count(2, 1.6), count(2.5, 1.6)], config);
    expect(placed.map((p) => p.t)).toEqual([2]);
    expect(dropped).toEqual([
      { t: 2.5, kind: 'count', recipe: 'tick', reason: 'while another counter ticks' },
    ]);
  });

  it('ticks a count-up and the count that follows it on the same counter', () => {
    const { placed, dropped } = placeEffects([count(0.5, 1.6), count(2.6, 1.6)], config);
    expect(dropped).toEqual([]);
    expect(placed.map((p) => [p.t, p.ticks])).toEqual([
      [0.5, 10],
      [2.6, 10],
    ]);
  });

  it('tick only as often as the number on screen changes', () => {
    // A count-up from 0 to 1 ticks as it starts and as it lands; 70,406 to 9,907 keeps all ten.
    const { placed } = placeEffects([count(1, 1.6, 1), count(4, 1.6, 1000)], config);
    expect(placed).toEqual([
      { t: 1, kind: 'count', recipe: 'tick', gainDb: BED_DB - 3, seconds: 1.6, steps: 1, ticks: 2 },
      {
        t: 4,
        kind: 'count',
        recipe: 'tick',
        gainDb: BED_DB - 3,
        seconds: 1.6,
        steps: 1000,
        ticks: 10,
      },
    ]);
  });

  it('tie a count to the count-up it starts as, so their ticks never stack', () => {
    // The count-up lands at 2.1 s: a count starting then, or within the gap, plays its first tick
    // there already, so it leaves out its own; one starting later keeps it.
    for (const start of [2.1, 2.13]) {
      const { placed, dropped } = placeEffects([count(0.5, 1.6), count(start, 1.6)], config);
      expect(dropped).toEqual([]);
      expect(placed.map((p) => [p.t, p.ticks, p.tied])).toEqual([
        [0.5, 10, undefined],
        [start, 9, true],
      ]);
    }
    const apart = placeEffects([count(0.5, 1.6), count(2.2, 1.6)], config).placed;
    expect(apart.map((p) => [p.ticks, p.tied])).toEqual([
      [10, undefined],
      [10, undefined],
    ]);
    // Placed in rank order, tied in time order: a count before a finding still ties the next.
    const ranked = placeEffects(
      [count(4, 1.6, 3), cue(4.8, 'finding', 'high'), count(2.4, 1.6, 1)],
      config,
    ).placed;
    expect(ranked.map((p) => [p.kind, p.ticks, p.tied])).toEqual([
      ['count', 2, undefined],
      ['count', 3, true],
      ['finding', undefined, undefined],
    ]);
  });

  it("never let a count's length that is not a number reach the record", () => {
    const { placed } = placeEffects(
      [
        count(1, Number.NaN),
        count(3, Number.POSITIVE_INFINITY),
        count(5, 1.6, Number.NaN),
        count(7, 1.6, Number.POSITIVE_INFINITY),
      ],
      config,
    );
    expect(placed.map((p) => [p.seconds, p.steps, p.ticks])).toEqual([
      [0, undefined, 1],
      [0, undefined, 1],
      [1.6, undefined, 10],
      [1.6, undefined, 10],
    ]);
    expect(JSON.stringify(placed)).not.toMatch(/null/);
  });

  it('let an accent give way to a landing, and a camera whoosh to an accent', () => {
    const landing = placeEffects([cue(3, 'appear'), cue(3.05, 'merge')], config);
    expect(landing.placed.map((p) => p.kind)).toEqual(['merge']);
    expect(landing.dropped.map((d) => d.kind)).toEqual(['appear']);
    const swell = placeEffects([cue(3, 'camera'), cue(3.05, 'appear')], config);
    expect(swell.placed.map((p) => p.kind)).toEqual(['appear']);
    expect(swell.dropped.map((d) => d.kind)).toEqual(['camera']);
  });
});
