import type { Verdict } from '../schema/score.ts';

/*
 * Fits a score's form to a video that is already timed. Music fits the picture, never the
 * reverse: the narration fixed every frame, so the fitter only chooses a tempo near the score's,
 * where the first bar starts, and which sections play.
 *
 * Bar j starts at video time `start + j·bar`, with start in (−bar, 0]: the music may begin partway
 * into its first bar (and then fades in). The form is [intro] → loops → [hero] → loops → ending.
 * The ending's first downbeat is where the sonic logo lands (T). In priority order:
 *   1. The logo never overlaps narration: its pickup starts at least 0.1 s after the last line.
 *   2. The landing is heard: T ≤ D − 0.8.
 *   3. When the picture sets the landing (the outro card settling), T is exactly that moment;
 *      otherwise T is as close to a second before the end as the last line allows.
 *   4. The tempo stays within ±6% of the score's (±10% when nothing else fits, recorded).
 *   5. With a hero, the hero section's first downbeat is the hero moment H exactly: the fitter
 *      searches whole numbers of bars n between H and T, with bar = (T − H)/n.
 *   6. Without one, the score's tempo exactly.
 * The ending rings on past T and fades to silence at the end of the video.
 */

/** Below this, a video gets sound effects but no music: there is no room for a form. */
export const MIN_MUSIC_SECONDS = 8;

/** What the fitter needs from a parsed score. */
export interface FitScore {
  bpm: number;
  /** Beats (quarter notes) per bar. */
  meter: number;
  sections: Record<string, { bars: number }>;
  form: {
    intro?: string;
    loop: string[];
    hero?: string;
    ending: string | Record<Verdict, string>;
  };
}

export interface FitTarget {
  /** The video's length D. */
  duration: number;
  /** The hero moment H (the hero scene's start plus the transition), when the story has one. */
  hero?: number;
  /** The end of the last narration line L (without narration, the last scene's start + 0.45 s). */
  lastLine: number;
  /**
   * Where the logo lands when the picture sets it: the moment the outro card settles. Without
   * one, the landing is as close to a second before the end as the last line allows.
   */
  landing?: number;
  verdict: Verdict;
}

export interface Arrangement {
  bpm: number;
  scoreBpm: number;
  meter: number;
  /** Seconds per bar. */
  bar: number;
  /** Video time of bar 0's downbeat, in (−bar, 0]. */
  start: number;
  /** Video length D. */
  duration: number;
  sections: Array<{ name: string; startBar: number; bars: number }>;
  /** Bars including the whole ending, which rings past the end of the video. */
  totalBars: number;
  /** The ending section that plays (it follows the verdict). */
  ending: string;
  /** Video times of every beat and bar of the arrangement. */
  beatTimes: number[];
  barTimes: number[];
  markers: {
    hero?: { moment: number; downbeat: number };
    /** The logo's pickup starts at `start` and lands on the ending's first downbeat. */
    logo: { start: number; landing: number };
    /** The music fades to silence at the end: over the last half second, or longer after a long ring. */
    fade: { start: number; end: number };
  };
  /** What the fitter had to give up, in words. Empty when everything fit. */
  fallbacks: string[];
}

/** The logo's pickup: a sixteenth and an eighth before the landing. */
const PICKUP_BEATS = 0.75;
const GAP_AFTER_SPEECH = 0.1;
const LANDING_BEFORE_END = 0.8;
const PREFERRED_LANDING = 1;
/** The fade covers this share of the ending's ring after the landing, from half a second to one. */
const FADE_SHARE = 0.45;
const FADE_OUT = { min: 0.5, max: 1 } as const;
const TOLERANCES = [0.06, 0.1] as const;
const EPS = 1e-9;

export function fitMusic(score: FitScore, target: FitTarget): Arrangement | undefined {
  const d = target.duration;
  if (!(d >= MIN_MUSIC_SECONDS)) return undefined;
  const meter = score.meter;
  const base = (meter * 60) / score.bpm;
  const pickup = (bar: number) => (PICKUP_BEATS * bar) / meter;
  const latest = d - LANDING_BEFORE_END;
  const earliest = (bar: number) => target.lastLine + GAP_AFTER_SPEECH + pickup(bar);
  const fallbacks: string[] = [];
  const ending =
    typeof score.form.ending === 'string' ? score.form.ending : score.form.ending[target.verdict];
  const heroName = score.form.hero;
  const h = target.hero;
  // A landing the picture sets is kept when the logo fits between the last line and the end.
  const fits = (landing: number, bar: number) =>
    landing >= earliest(bar) - EPS && landing <= latest + EPS;
  let fixed = target.landing;
  if (fixed !== undefined && !(Number.isFinite(fixed) && fits(fixed, base))) {
    fallbacks.push(
      `The logo cannot land on the outro at ${Number(fixed).toFixed(2)} s: the last line leaves no room before it.`,
    );
    fixed = undefined;
  }

  // The landing without a hero: the score's tempo, as close to a second before the end as fits.
  const freeLanding = (bar: number) => {
    const low = earliest(bar);
    if (low > latest + EPS) {
      fallbacks.push(
        `The logo lands ${(d - low).toFixed(2)} s before the end: the last line leaves no more room.`,
      );
      return low;
    }
    return Math.min(latest, Math.max(low, d - PREFERRED_LANDING));
  };

  let bar = base;
  let landing: number;
  let heroBar: number | undefined;
  let start: number;
  if (heroName && h !== undefined && Number.isFinite(h)) {
    const found =
      fixed !== undefined
        ? searchLanding(h, fixed, base, earliest)
        : searchHero(h, base, meter, target, latest, earliest);
    if (found) {
      bar = found.bar;
      landing = fixed ?? h + found.bars * bar;
      const tempo = base / bar - 1;
      if (Math.abs(tempo) > TOLERANCES[0] + EPS)
        fallbacks.push(
          `The tempo moved ${(tempo * 100).toFixed(1)}% (beyond ±6%) to put the hero on a downbeat.`,
        );
      heroBar = Math.ceil(h / bar - EPS);
      start = h - heroBar * bar;
    } else {
      landing = fixed ?? freeLanding(bar);
      const n = Math.ceil(landing / bar - EPS);
      start = landing - n * bar;
      heroBar = Math.max(0, Math.min(n - 1, Math.round((h - start) / bar)));
      const off = start + heroBar * bar - h;
      fallbacks.push(
        `No tempo within ±10% puts a downbeat on the hero; it starts on the nearest bar, ${Math.abs(off).toFixed(2)} s ${off > 0 ? 'late' : 'early'}.`,
      );
    }
  } else {
    landing = fixed ?? freeLanding(bar);
    start = landing - Math.ceil(landing / bar - EPS) * bar;
  }
  const endingBar = Math.round((landing - start) / bar);

  // The form, bar by bar.
  const barsOf = (name: string | undefined) => (name ? (score.sections[name]?.bars ?? 0) : 0);
  const sections: Arrangement['sections'] = [];
  let introBars = barsOf(score.form.intro);
  const introRoom = heroBar ?? endingBar;
  if (introBars > introRoom) introBars = 0;
  if (introBars) sections.push({ name: score.form.intro!, startBar: 0, bars: introBars });
  let cycle = 0;
  const fill = (from: number, to: number) => {
    for (let at = from; at < to; cycle++) {
      const name = score.form.loop[cycle % score.form.loop.length]!;
      const bars = Math.min(barsOf(name), to - at);
      sections.push({ name, startBar: at, bars });
      at += bars;
    }
  };
  if (heroName && heroBar !== undefined) {
    fill(introBars, heroBar);
    const heroBars = Math.min(barsOf(heroName), endingBar - heroBar);
    if (heroBars > 0) sections.push({ name: heroName, startBar: heroBar, bars: heroBars });
    fill(heroBar + Math.max(0, heroBars), endingBar);
  } else {
    fill(introBars, endingBar);
  }
  const endingBars = barsOf(ending);
  sections.push({ name: ending, startBar: endingBar, bars: endingBars });
  const totalBars = endingBar + endingBars;

  const beat = bar / meter;
  return {
    bpm: (meter * 60) / bar,
    scoreBpm: score.bpm,
    meter,
    bar,
    start,
    duration: d,
    sections,
    totalBars,
    ending,
    beatTimes: Array.from({ length: totalBars * meter }, (_, i) => start + i * beat),
    barTimes: Array.from({ length: totalBars }, (_, j) => start + j * bar),
    markers: {
      ...(h !== undefined && heroName && heroBar !== undefined
        ? { hero: { moment: h, downbeat: start + heroBar * bar } }
        : {}),
      logo: { start: landing - pickup(bar), landing },
      fade: { start: d - fadeOut(d - landing), end: d },
    },
    fallbacks,
  };
}

/** How long the music fades at the end: a share of the ending's ring, from 0.5 s to 1 s. */
function fadeOut(ring: number): number {
  return Math.min(FADE_OUT.max, Math.max(FADE_OUT.min, FADE_SHARE * ring));
}

/**
 * Whole bars n from the hero moment to a landing the picture fixed, with bar = (T − H)/n: the
 * tempo closest to the score's wins, ±6% first, then ±10%. The pickup must still clear the last
 * line at that tempo.
 */
function searchLanding(
  h: number,
  landing: number,
  base: number,
  earliest: (bar: number) => number,
): { bars: number; bar: number } | undefined {
  const span = landing - h;
  if (!(span > EPS)) return undefined;
  for (const tolerance of TOLERANCES) {
    const shortest = base / (1 + tolerance);
    const longest = base / (1 - tolerance);
    let best: { bars: number; bar: number; deviation: number } | undefined;
    for (let n = Math.max(1, Math.floor(span / longest)); n <= Math.ceil(span / shortest); n++) {
      const bar = span / n;
      if (bar < shortest - EPS || bar > longest + EPS || landing < earliest(bar) - EPS) continue;
      const deviation = Math.abs(base / bar - 1);
      if (!best || deviation < best.deviation - EPS) best = { bars: n, bar, deviation };
    }
    if (best) return { bars: best.bars, bar: best.bar };
  }
  return undefined;
}

/**
 * Whole bars n from the hero moment to the landing, with the bar length that makes both land on
 * downbeats: the tempo closest to the score's wins, then the landing nearest a second before the
 * end. ±6% first, then ±10%.
 */
function searchHero(
  h: number,
  base: number,
  meter: number,
  target: FitTarget,
  latest: number,
  earliest: (bar: number) => number,
): { bars: number; bar: number } | undefined {
  const d = target.duration;
  const pickupShare = PICKUP_BEATS / meter;
  for (const tolerance of TOLERANCES) {
    const shortest = base / (1 + tolerance);
    const longest = base / (1 - tolerance);
    let best: { bars: number; bar: number; deviation: number; distance: number } | undefined;
    for (let n = 1; h + n * shortest <= latest + EPS; n++) {
      // T = h + n·bar must satisfy earliest(bar) ≤ T ≤ latest, where earliest grows with bar.
      const low = Math.max(shortest, (target.lastLine + GAP_AFTER_SPEECH - h) / (n - pickupShare));
      const high = Math.min(longest, (latest - h) / n);
      if (low > high + EPS) continue;
      const bar = Math.min(high, Math.max(low, base));
      if (h + n * bar < earliest(bar) - EPS) continue;
      const deviation = Math.abs(base / bar - 1);
      const distance = Math.abs(h + n * bar - (d - PREFERRED_LANDING));
      if (
        !best ||
        deviation < best.deviation - EPS ||
        (Math.abs(deviation - best.deviation) <= EPS && distance < best.distance)
      )
        best = { bars: n, bar, deviation, distance };
    }
    if (best) return { bars: best.bars, bar: best.bar };
  }
  return undefined;
}
