import { describe, expect, it } from 'vitest';
import {
  type EffectCue,
  effectRecipe,
  effectTranspose,
  placeEffects,
  type SoundEffectsConfig,
} from '../src/effects.ts';

const config: SoundEffectsConfig = {
  gainDb: -14,
  verdictBoostDb: 2,
  outroBoostDb: 2,
  swellCutDb: 4,
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
  },
};

const cue = (t: number, kind: EffectCue['kind'], detail?: string): EffectCue => ({
  t,
  kind,
  scene: 's',
  ...(detail ? { detail } : {}),
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
    expect(placed.map((p) => p.gainDb)).toEqual([-14, -12]);
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
      { t: 1, kind: 'click', recipe: 'click', gainDb: -14 },
      { t: 2, kind: 'reveal', recipe: 'reveal', gainDb: -14 },
      { t: 5, kind: 'verdict', recipe: 'verdict-looks-good', gainDb: -12 },
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
    expect(placed).toEqual([{ t: 1.05, kind: 'finding', recipe: 'finding-high', gainDb: -14 }]);
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
      ['transition', -18],
      ['riser', -18],
      ['hero', -14],
    ]);
  });

  it('drops a riser crowded by a click, never the click', () => {
    const { placed, dropped } = placeEffects([cue(2, 'riser'), cue(2.1, 'click')], config);
    expect(placed.map((p) => p.kind)).toEqual(['click']);
    expect(dropped.map((d) => [d.kind, d.reason])).toEqual([
      ['riser', expect.stringMatching(/0\.15 s/)],
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
