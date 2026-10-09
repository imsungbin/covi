import { type EvidenceIndex, UsageError } from '@covi/core';
import type { Scene } from '../storyboard/schema.ts';
import type { TransitionKind } from '../timeline/types.ts';
import { defaultDirection, entrances, mergeDirection } from './director.ts';
import { directionProblems } from './refs.ts';
import { DIRECTION_HINT, type Direction } from './schema.ts';
import type { DirectionSources } from './sources.ts';

/** `video.direction`: direct on the canvas, or render as 0.2.0 did. */
export type DirectionMode = 'auto' | 'off';

export interface PlanInput {
  mode: DirectionMode;
  /** The run's `video/direction.json` as read; undefined when it has none. */
  file?: Direction;
  /**
   * The storyboard's scenes as written (before redaction): `at` phrases are checked against them,
   * as `sync` phrases are.
   */
  authored: readonly Scene[];
  /** The scenes as they will be drawn (redacted): the default director reads them. */
  scenes: readonly Scene[];
  evidence?: EvidenceIndex;
  sources: DirectionSources;
  seed: number;
}

export interface DirectionPlan {
  /** Covi's own direction (`"draft": true`), for `covi video --draft` to write; absent when off. */
  draft?: Direction;
  /** The shots to render: the agent's over Covi's; absent when off. */
  plan?: Direction;
  /** How each scene after the first enters; empty when off (each keeps its own transition). */
  entrances: Map<string, TransitionKind>;
}

/**
 * What directs this video. Off: nothing (0.2.0's rendering). Otherwise Covi's default director,
 * with the agent's shots over it when the run has a direction the agent rewrote (`"draft": false`);
 * that one must fit the run, and every problem is listed at once (exit 2). A direction still marked
 * as Covi's draft is derived again instead of checked, so a stale draft never blocks a render.
 */
export function planDirection(input: PlanInput): DirectionPlan {
  if (input.mode === 'off') return { entrances: new Map() };
  const draft = defaultDirection({
    scenes: input.scenes,
    evidence: input.evidence,
    seed: input.seed,
  });
  const own = input.file && !input.file.draft ? input.file : undefined;
  if (own) {
    const problems = directionProblems(own, input.authored, input.evidence, input.sources);
    if (problems.length)
      throw new UsageError(
        `video/direction.json does not fit this run:\n  ${problems.join('\n  ')}`,
        DIRECTION_HINT,
      );
  }
  const plan = mergeDirection(own, draft);
  return { draft, plan, entrances: entrances(plan, input.scenes, input.evidence, input.seed) };
}
