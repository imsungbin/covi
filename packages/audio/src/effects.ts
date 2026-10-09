import { z } from 'zod';
import { BED_DB } from './placement.ts';

/*
 * Sound effects follow only what happens on screen: a pointer click, the before/after reveal, a
 * finding card landing (heavier for high severity), the verdict appearing, the outro card
 * settling, a scene pushing, wiping, or zooming through (a whoosh), and the hero (a riser into
 * its moment and a hit on it). If an effect is noticeable, it is too loud: their levels are written
 * against the music bed (the same with any placement, or with no music), swells lower still, and
 * density limits keep a busy stretch from turning into a rattle; when effects crowd, the swells
 * give way first. The outro's sign-off plays only when no music does: with music, the music's own
 * sonic logo lands on that moment.
 */

const Recipe = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

/** templates/music/sound-effects.yml */
export const SoundEffectsSchema = z.strictObject({
  /**
   * Level of every effect relative to the music bed's level under speech (dB; `BED_DB`), its
   * recipe at −3 dBFS. The mix lowers them all together if any comes within 8 dB of the voice.
   */
  gainDb: z.number().min(-20).max(12),
  /** Extra level for the verdict, the one moment the effects mark the story (dB). */
  verdictBoostDb: z.number().min(0).max(6),
  /** Extra level for the outro's sign-off, which plays in the quiet after the narration (dB). */
  outroBoostDb: z.number().min(0).max(6),
  /** How far swells (a transition's whoosh, the riser into the hero) sit under the others (dB). */
  swellCutDb: z.number().min(0).max(12),
  /** Seconds between any two effects at least. */
  minSpacing: z.number().min(0).max(2),
  /** Effects in any one-second window at most. */
  maxPerSecond: z.number().int().min(1).max(10),
  /** Cue → recipe id (templates/music/sfx). */
  recipes: z.strictObject({
    click: Recipe,
    reveal: Recipe,
    finding: Recipe,
    'finding-high': Recipe,
    'verdict-looks-good': Recipe,
    'verdict-needs-attention': Recipe,
    'verdict-needs-changes': Recipe,
    'outro-looks-good': Recipe,
    'outro-needs-attention': Recipe,
    'outro-needs-changes': Recipe,
    transition: Recipe,
    riser: Recipe,
    hero: Recipe,
  }),
});

export type SoundEffectsConfig = z.output<typeof SoundEffectsSchema>;

/** A moment with a sound (the timeline's cues). */
export interface EffectCue {
  t: number;
  kind: 'click' | 'reveal' | 'finding' | 'verdict' | 'outro' | 'transition' | 'riser' | 'hero';
  scene: string;
  /** `high` for a high-severity finding; the verdict for a verdict or outro cue. */
  detail?: string;
}

export interface PlacedEffect {
  t: number;
  kind: EffectCue['kind'];
  recipe: string;
  /** Level relative to the voice-normalized stems (dB): the bed's, plus the configured offsets. */
  gainDb: number;
}

export interface DroppedEffect {
  t: number;
  kind: EffectCue['kind'];
  recipe: string;
  reason: string;
}

/** The recipe a cue plays, and how much it matters when cues compete. */
export function effectRecipe(
  cue: EffectCue,
  config: SoundEffectsConfig,
): { recipe: string; priority: number } {
  const r = config.recipes;
  const verdict =
    cue.detail === 'needs-changes' || cue.detail === 'needs-attention' ? cue.detail : 'looks-good';
  switch (cue.kind) {
    case 'outro':
      return { recipe: r[`outro-${verdict}`], priority: 4 };
    case 'verdict':
      return { recipe: r[`verdict-${verdict}`], priority: 3 };
    case 'finding':
      return cue.detail === 'high'
        ? { recipe: r['finding-high'], priority: 2 }
        : { recipe: r.finding, priority: 1 };
    case 'hero':
      return { recipe: r.hero, priority: 3 };
    case 'transition':
    case 'riser':
      return { recipe: r[cue.kind], priority: 0 };
    default:
      return { recipe: r[cue.kind], priority: 1 };
  }
}

/**
 * Chooses which cues sound. The outro first, then the verdict and the hero's hit, then
 * high-severity findings, then the rest, and the swells last, each in time order; a cue is dropped
 * when it would come within `minSpacing` of a placed one or make any second hold more than
 * `maxPerSecond`. A riser is exempt from the spacing (its onset is quiet), not from the density.
 */
export function placeEffects(
  cues: readonly EffectCue[],
  config: SoundEffectsConfig,
): { placed: PlacedEffect[]; dropped: DroppedEffect[] } {
  const ranked = cues
    .map((cue, order) => ({ cue, order, ...effectRecipe(cue, config) }))
    .sort((a, b) => b.priority - a.priority || a.cue.t - b.cue.t || a.order - b.order);
  const kept: number[] = [];
  const placed: PlacedEffect[] = [];
  const dropped: DroppedEffect[] = [];
  for (const { cue, recipe } of ranked) {
    // A riser's onset is quiet (it swells over most of a second), so it neither crowds nor is
    // crowded by a transient; it still counts toward a full second.
    const crowded =
      cue.kind !== 'riser' &&
      placed.some((p) => p.kind !== 'riser' && Math.abs(p.t - cue.t) < config.minSpacing - 1e-9);
    const times = [...kept, cue.t].sort((a, b) => a - b);
    const max = config.maxPerSecond;
    const dense = times.some((t, i) => i >= max && t - times[i - max]! < 1 - 1e-9);
    if (crowded || dense) {
      dropped.push({
        t: cue.t,
        kind: cue.kind,
        recipe,
        reason: crowded
          ? `within ${config.minSpacing} s of a more important effect`
          : `more than ${max} per second`,
      });
      continue;
    }
    kept.push(cue.t);
    placed.push({
      t: cue.t,
      kind: cue.kind,
      recipe,
      gainDb:
        BED_DB +
        config.gainDb +
        (cue.kind === 'verdict'
          ? config.verdictBoostDb
          : cue.kind === 'outro'
            ? config.outroBoostDb
            : cue.kind === 'transition' || cue.kind === 'riser'
              ? -config.swellCutDb
              : 0),
    });
  }
  const byTime = (a: { t: number }, b: { t: number }) => a.t - b.t;
  return { placed: placed.sort(byTime), dropped: dropped.sort(byTime) };
}

/** How far each mode's tonic sits above the tonic of the major scale with the same notes. */
const PARENT_MAJOR: Record<string, number> = {
  major: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  minor: 9,
  'harmonic-minor': 9,
  'melodic-minor': 9,
  locrian: 11,
};

/**
 * Semitones that move an effect written in C into the music's key: to the major scale sharing
 * the score's notes (A minor and D dorian keep C), by the nearest octave (−5 to +6).
 */
export function effectTranspose(key: { tonic: number; mode: string }): number {
  const shift = (((key.tonic - (PARENT_MAJOR[key.mode] ?? 0)) % 12) + 12) % 12;
  return shift > 6 ? shift - 12 : shift;
}
