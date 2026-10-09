import type { EvidenceIndex } from '@covi/core';
import { sceneEvidence } from '../grounding.ts';
import { highlightGroups } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import type { TransitionKind } from '../timeline/types.ts';
import type { Direction, Shot, ShotBeat } from './schema.ts';

/** How far the camera zooms toward the lines a code scene highlights. */
export const CODE_ZOOM = 1.25;

export interface DirectorInput {
  /** The storyboard's scenes as they will be drawn (redacted), with their ids. */
  scenes: readonly Scene[];
  evidence?: EvidenceIndex;
  /** The timeline's seed (from the title): a different change starts the rotation differently. */
  seed: number;
}

const sceneId = (scene: Pick<Scene, 'id'>, i: number) => scene.id ?? `s${i + 1}`;

/**
 * Covi's own direction, for every run without an agent's (CI and `--json` runs get the same
 * motion as interactive ones): each scene keeps its storyboard visual, a code scene that
 * highlights lines zooms toward them as they light, and each scene after the first gets its
 * entrance from the rotation unless the storyboard set its `transition`. Pure and deterministic.
 * It never invents content: what it adds later (morphs, metrics, flows) comes from evidence too.
 */
export function defaultDirection(input: DirectorInput): Direction {
  const shots: Shot[] = input.scenes.map((scene, i) => ({
    scene: sceneId(scene, i),
    elements: [{ id: 'visual', kind: 'visual' }],
    beats: cameraBeats(scene),
  }));
  const entered = entrances({ shots }, input.scenes, input.evidence, input.seed);
  input.scenes.forEach((scene, i) => {
    const kind = entered.get(sceneId(scene, i));
    // A transition the storyboard chose stays the storyboard's: the shot does not repeat it.
    if (kind && !scene.transition) shots[i]!.enter = kind;
  });
  return { schemaVersion: 1, draft: true, shots };
}

/**
 * A code scene that highlights lines zooms toward them, on the phrase that lights its first group
 * (or all of them), else spread through its line. Captures move their own camera inside their
 * frame (marks, focus), so a stage zoom would compound it; they get none.
 */
function cameraBeats(scene: Scene): ShotBeat[] {
  const v = scene.visual;
  if (v.kind !== 'code' || !v.highlight.length) return [];
  const sync = scene.sync ?? {};
  const phase = [highlightGroups(v.highlight)[0]?.phase, 'highlight'].find(
    (name): name is string => name !== undefined && Object.hasOwn(sync, name),
  );
  return [
    {
      verb: 'camera',
      move: 'zoom',
      to: 'visual',
      zoom: CODE_ZOOM,
      ...(phase ? { at: sync[phase]! } : {}),
    },
  ];
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
