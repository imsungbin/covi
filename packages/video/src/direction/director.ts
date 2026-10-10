import { type EvidenceIndex, hunksOf } from '@covi/core';
import { sceneEvidence } from '../grounding.ts';
import { highlightGroups } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import type { TransitionKind } from '../timeline/types.ts';
import { DIRECTION_LIMITS, type Direction, type Shot, type ShotBeat } from './schema.ts';
import type { DirectionSources } from './sources.ts';
import { morphProblem } from './tokens.ts';

/** How far the camera zooms toward the lines a code scene highlights. */
export const CODE_ZOOM = 1.25;

export interface DirectorInput {
  /** The storyboard's scenes as they will be drawn (redacted), with their ids. */
  scenes: readonly Scene[];
  evidence?: EvidenceIndex;
  /** The timeline's seed (from the title): a different change starts the rotation differently. */
  seed: number;
  /** The run's evidence content: a code scene whose hunk can morph becomes a morph. */
  sources?: DirectionSources;
}

const sceneId = (scene: Pick<Scene, 'id'>, i: number) => scene.id ?? `s${i + 1}`;

/**
 * Covi's own direction, for every run without an agent's (CI and `--json` runs get the same
 * motion as interactive ones): a code scene whose hunk is small enough morphs it, the camera
 * following the changed lines; every other scene keeps its storyboard visual, and a code scene
 * that highlights lines zooms toward them as they light. Each scene after the first gets its
 * entrance from the rotation unless the storyboard set its `transition`. Pure and deterministic.
 * It never invents content: what it adds (morphs, and later metrics and flows) comes from evidence.
 * What it returns reads back unchanged through `DirectionSchema`: Covi never writes a direction
 * file it would then refuse.
 */
export function defaultDirection(input: DirectorInput): Direction {
  // Storyboard scene ids have no length limit, and a shot names one of at most `sceneIdChars`: a
  // scene with a longer id gets no shot, so it shows its visual, and still enters by the rotation.
  const directed = input.scenes.flatMap((scene, i) => {
    const id = sceneId(scene, i);
    return id.length > DIRECTION_LIMITS.sceneIdChars ? [] : [{ scene, id }];
  });
  const shots: Shot[] = directed.map(
    ({ scene, id }) =>
      morphShot(scene, id, input) ?? {
        scene: id,
        elements: [{ id: 'visual', kind: 'visual' }],
        beats: cameraBeats(scene),
      },
  );
  const entered = entrances({ shots }, input.scenes, input.evidence, input.seed);
  directed.forEach(({ scene, id }, k) => {
    const kind = entered.get(id);
    // A transition the storyboard chose stays the storyboard's: the shot does not repeat it.
    if (kind && !scene.transition) shots[k]!.enter = kind;
  });
  return { schemaVersion: 1, draft: true, shots };
}

/** The phrase that lights a code scene's first highlight group (or all of them), if it has one. */
function highlightPhrase(scene: Scene): string | undefined {
  const v = scene.visual;
  if (v.kind !== 'code' || !v.highlight.length) return undefined;
  const sync = scene.sync ?? {};
  const phase = [highlightGroups(v.highlight)[0]?.phase, 'highlight'].find(
    (name): name is string => name !== undefined && Object.hasOwn(sync, name),
  );
  // Trimmed as the direction schema trims a phrase, so the file reads back as written; phrases
  // match up to whitespace, so the beat still lands where the storyboard's phrase is spoken.
  return (phase && sync[phase]!.trim()) || undefined;
}

/**
 * A code scene that highlights lines zooms toward them, on the phrase that lights its first group
 * (or all of them), else spread through its line. Captures move their own camera inside their
 * frame (marks, focus), so a stage zoom would compound it; they get none.
 */
function cameraBeats(scene: Scene): ShotBeat[] {
  const v = scene.visual;
  if (v.kind !== 'code' || !v.highlight.length) return [];
  const at = highlightPhrase(scene);
  return [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: CODE_ZOOM, ...(at ? { at } : {}) }];
}

/**
 * A code scene morphs the hunk whose changed lines it shows, and only that one, when the hunk is
 * small enough (code on both sides, every changed line on the card): the camera follows the
 * changed lines, and the morph lands on the phrase that lights its highlights, else spread through
 * its line. A scene whose changed lines lie in no hunk, or in more than one, or that shows only
 * unchanged lines, keeps its visual: morphing code it did not show could contradict its narration.
 * So does a scene the storyboard set apart: the line morph (`mode: "morph"`), or a caption the
 * morph would not draw. It reads what the scene shows, never what it cites.
 */
function morphShot(scene: Scene, id: string, input: DirectorInput): Shot | undefined {
  const v = scene.visual;
  const { evidence, sources } = input;
  if (v.kind !== 'code' || v.mode === 'morph' || v.caption || !evidence || !sources)
    return undefined;
  // A storyboard numbers a deleted line as before the change and an added one as after it, as a
  // hunk's own lines are numbered; context lines say nothing about which change the scene shows.
  const changed = v.lines.filter((l) => l.type !== 'context' && l.number !== undefined);
  const hunks = hunksOf(evidence, v.path).filter((ref) =>
    sources
      .hunk(ref)
      ?.lines.some((h) =>
        changed.some(
          (l) => l.type === h.kind && l.number === (h.kind === 'del' ? h.oldLine : h.newLine),
        ),
      ),
  );
  const hunk = hunks.length === 1 ? sources.hunk(hunks[0]!) : undefined;
  if (!hunk || morphProblem(hunk.lines)) return undefined;
  const at = highlightPhrase(scene);
  return {
    scene: id,
    elements: [{ id: 'morph', kind: 'morph', evidence: hunks[0]! }],
    beats: [
      { verb: 'camera', move: 'follow', to: 'morph', zoom: CODE_ZOOM },
      { verb: 'morph', element: 'morph', ...(at ? { at } : {}) },
    ],
  };
}

/**
 * How each scene after the first enters: its shot's `enter`, else its storyboard `transition`,
 * else the rotation. The hero zooms (the camera pulls back to reach its stop); a before/after
 * wipes; a scene that shows what the one before showed cuts (the same subject continues); the
 * rest alternate pan and push, the seed picking which comes first, so no kind takes much more than
 * half of the moves. Scenes are read for what they show, never for what they cite: editing
 * citations never moves a frame.
 */
export function entrances(
  plan: Pick<Direction, 'shots'>,
  scenes: readonly Scene[],
  evidence: EvidenceIndex | undefined,
  seed: number,
): Map<string, TransitionKind> {
  const enter = new Map(plan.shots.map((s) => [s.scene, s.enter]));
  const shows = (scene: Scene) =>
    evidence ? sceneEvidence({ visual: scene.visual }, evidence) : [];
  const out = new Map<string, TransitionKind>();
  // The kind the alternation used last: the first scene it reaches takes the other one.
  let last: 'pan' | 'push' = seed % 2 === 0 ? 'push' : 'pan';
  let before = new Set(scenes[0] ? shows(scenes[0]) : []);
  const rotate = (scene: Scene, now: readonly string[]): TransitionKind => {
    if (scene.hero) return 'zoom';
    if (scene.visual.kind === 'before-after') return 'wipe';
    if (now.some((id) => before.has(id))) return 'cut';
    return last === 'pan' ? 'push' : 'pan';
  };
  scenes.forEach((scene, i) => {
    if (i === 0) return;
    const now = shows(scene);
    const kind = enter.get(sceneId(scene, i)) ?? scene.transition ?? rotate(scene, now);
    if (kind === 'pan' || kind === 'push') last = kind;
    out.set(sceneId(scene, i), kind);
    before = new Set(now);
  });
  return out;
}

/** The agent's shots, with the default director's for every scene it leaves out. */
export function mergeDirection(authored: Direction | undefined, drafted: Direction): Direction {
  if (!authored || authored.draft) return drafted;
  const own = new Set(authored.shots.map((s) => s.scene));
  return {
    schemaVersion: 1,
    draft: false,
    shots: [...authored.shots, ...drafted.shots.filter((s) => !own.has(s.scene))],
  };
}
