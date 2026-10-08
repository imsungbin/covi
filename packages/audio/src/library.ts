import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { type SoundEffectsConfig, SoundEffectsSchema } from './effects.ts';
import { hashOf } from './hash.ts';
import { type ParsedScore, parseScore, ScoreError } from './music/score.ts';
import type { SfxRecipe } from './schema/sfx.ts';
import { loadSfxRecipes } from './sfx/recipes.ts';
import { type Kit, loadKits, loadPatches, type Patch } from './synth/patches.ts';

/**
 * Bump whenever rendered output changes (DSP, scheduling, mixing), so cached music is never
 * mistaken for what the engine would render now.
 */
export const AUDIO_ENGINE_VERSION = 'covi-audio-3';

/** Everything Covi can play, loaded from a directory laid out like templates/music. */
export interface MusicLibrary {
  patches: ReadonlyMap<string, Patch>;
  kits: ReadonlyMap<string, Kit>;
  recipes: ReadonlyMap<string, SfxRecipe>;
  soundEffects: SoundEffectsConfig;
  /** Bundled scores by id, as written (scores/*.yml). */
  scores: ReadonlyMap<string, unknown>;
  /** A hash of every patch and kit file, for cache keys. */
  fingerprint: string;
}

function yamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

function readYaml(file: string): unknown {
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid YAML: ${(error as Error).message}`);
  }
}

/**
 * Loads and validates the whole library: patches, kits, effect recipes and the cue map, and the
 * bundled scores (each must parse and name only what the library has). Callers pass the
 * directory; this package never locates resources itself.
 */
export function loadMusicLibrary(dir: string): MusicLibrary {
  const patches = loadPatches([join(dir, 'patches')]);
  const kits = loadKits([join(dir, 'kits')]);
  const recipes = loadSfxRecipes([join(dir, 'sfx')]);
  const effectsFile = join(dir, 'sound-effects.yml');
  const parsed = SoundEffectsSchema.safeParse(readYaml(effectsFile));
  if (!parsed.success) throw new Error(`invalid ${effectsFile}:\n${z.prettifyError(parsed.error)}`);
  const soundEffects = parsed.data;
  for (const [voice, id] of [...kits.values()].flatMap((k) => Object.entries(k.voices))) {
    if (patches.get(id)?.algo !== 'drum')
      throw new Error(`kit voice "${voice}" plays "${id}", which is not a drum patch`);
  }
  for (const [cue, id] of Object.entries(soundEffects.recipes))
    if (!recipes.has(id)) throw new Error(`${effectsFile}: "${cue}" plays unknown recipe "${id}"`);
  for (const recipe of recipes.values())
    for (const layer of recipe.layers)
      if (layer.gen === 'notes')
        for (const note of layer.notes)
          if (!patches.has(note.patch))
            throw new Error(`sfx recipe "${recipe.id}" plays unknown patch "${note.patch}"`);
  const library: MusicLibrary = {
    patches,
    kits,
    recipes,
    soundEffects,
    scores: new Map(),
    fingerprint: hashOf(
      ...['patches', 'kits'].flatMap((sub) =>
        yamlFiles(join(dir, sub)).map(
          (f) => `${sub}/${f.slice(f.lastIndexOf('/') + 1)}\n${readFileSync(f, 'utf8')}`,
        ),
      ),
    ),
  };
  const scores = new Map<string, unknown>();
  for (const file of yamlFiles(join(dir, 'scores'))) {
    const raw = readYaml(file);
    try {
      const score = parseScore(raw);
      checkScoreReferences(score, library);
      scores.set(score.id, raw);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
  }
  return { ...library, scores };
}

/**
 * Checks that a score names only patches, kits, and kit voices the library has. A score from an
 * agent or a model may use only what Covi ships, so the message lists what is available.
 */
export function checkScoreReferences(
  score: ParsedScore,
  library: Pick<MusicLibrary, 'patches' | 'kits'>,
): void {
  const melodic = [...library.patches.values()].filter((p) => p.algo !== 'drum').map((p) => p.id);
  const unknownPatch = (id: string, where: string) =>
    new ScoreError(
      `score "${score.id}": ${where} uses unknown patch "${id}". Available patches: ${melodic.join(', ')}.`,
    );
  for (const track of score.tracks) {
    if (track.patch) {
      const patch = library.patches.get(track.patch);
      if (!patch || patch.algo === 'drum') throw unknownPatch(track.patch, `track "${track.name}"`);
    }
    if (track.kit && !library.kits.has(track.kit))
      throw new ScoreError(
        `score "${score.id}": track "${track.name}" uses unknown kit "${track.kit}". Available kits: ${[...library.kits.keys()].join(', ')}.`,
      );
  }
  const byName = new Map(score.tracks.map((t) => [t.name, t]));
  for (const pattern of Object.values(score.patterns)) {
    const track = byName.get(pattern.track)!;
    const kit = track.kit ? library.kits.get(track.kit) : undefined;
    for (const e of pattern.events) {
      if (e.patch) {
        const patch = library.patches.get(e.patch);
        if (!patch || patch.algo === 'drum')
          throw unknownPatch(e.patch, `pattern "${pattern.name}"`);
      }
      if (kit && e.voice && !Object.hasOwn(kit.voices, e.voice))
        throw new ScoreError(
          `score "${score.id}": pattern "${pattern.name}" plays "${e.voice}", which kit "${kit.id}" lacks. Its voices: ${Object.keys(kit.voices).join(', ')}.`,
        );
    }
  }
}

export interface MusicCacheInput {
  /** The validated score as written (key order does not matter). */
  score: unknown;
  fingerprint: string;
  duration: number;
  hero?: number;
  lastLine: number;
  /** The outro's settle moment, where the logo lands. */
  landing?: number;
  verdict: string;
  seed: number;
  sampleRate: number;
}

/** The cache key of rendered music: everything the render depends on, and the engine version. */
export function musicCacheKey(input: MusicCacheInput, engine = AUDIO_ENGINE_VERSION): string {
  return hashOf(
    engine,
    input.score,
    input.fingerprint,
    input.duration,
    input.hero ?? null,
    input.lastLine,
    input.landing ?? null,
    input.verdict,
    input.seed,
    input.sampleRate,
  );
}
