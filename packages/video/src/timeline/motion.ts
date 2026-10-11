import { entranceSeconds, type Span, settledAt, shotMotion, shotSettledAt } from './cues.ts';
import { HERO_PHASE, type Timeline, type TimelineScene } from './types.ts';

/*
 * When the picture moves, as pure functions of the timeline: the scene camera's plan, which the
 * runtime pushes in with, and every stretch of motion a timeline plans, which QC holds against
 * the narration. No DOM and no Node APIs: the runtime bundles this file.
 */

export interface CameraPlan {
  duration: number;
  /** A capture: the camera drifts through the whole scene. */
  drift: boolean;
  /** When the push-in may start (seconds since the scene started): the choreography is done, or
   * the visual has entered when its moments wait on the line. */
  settled: number;
  /** When its line ends; a visual that settles before it pushes in. */
  speechEnd?: number;
  /**
   * The push-in moves at an even pace from `settled` to the end, never easing in: a shot whose
   * beats wait on its line, so the frame moves from its entrance to its first beat.
   */
  steady: boolean;
  /** `camera: static`: neither drift nor push-in. */
  still: boolean;
  /** The hero phase, where the camera punches in. */
  hero?: number;
}

/** Visuals that are captures of the running software. */
const CAPTURES = new Set<TimelineScene['visual']['kind']>([
  'screenshot',
  'before-after',
  'interaction',
]);

/** When a visual's entrance has risen into place (the first `rise` of every component). */
export const ENTERED = 0.5;
/** The hero's punch is over this long after its phase. */
export const PUNCH_OUT = 0.6;

/**
 * How the camera moves in a scene; the outro moves on its own. A capture drifts through its whole
 * scene; any other visual pushes in once its choreography is done, or once it has entered when
 * its moments wait on the line: an event pinned to a phrase, a diagram's edges drawing under its
 * nodes, or a shot's beats spread through the line (the frame would otherwise hold still until
 * the first of them).
 */
export function cameraPlan(scene: TimelineScene): CameraPlan | undefined {
  const v = scene.visual;
  if (v.kind === 'outro') return undefined;
  const duration = scene.end - scene.start;
  const hero = scene.hero ? scene.phases?.[HERO_PHASE] : undefined;
  // A directed scene settles once its elements have played and its beats have ended.
  const settled = scene.direction ? shotSettledAt(scene) : settledAt(v, duration, scene.phases);
  const pinned = Object.keys(scene.phases ?? {}).some((name) => name !== HERO_PHASE);
  const waits = Boolean(scene.direction?.beats.length);
  const early = pinned || v.kind === 'diagram' || waits;
  return {
    duration,
    // A shot that lays the capture out beside other elements holds it still: they move instead.
    drift:
      (!scene.direction || scene.direction.whole) &&
      (CAPTURES.has(v.kind) || (v.kind === 'title' && v.background !== undefined)),
    settled: early ? Math.min(settled, ENTERED) : settled,
    ...(scene.speech ? { speechEnd: scene.speech.end - scene.start } : {}),
    steady: waits,
    still: scene.camera === 'static',
    ...(hero === undefined ? {} : { hero }),
  };
}

/** What moves in a stretch of motion. */
export type MotionKind = 'entrance' | 'element' | 'beat' | 'camera';

/** A stretch in which something on screen moves, in seconds from the start of the video. */
export interface MotionSpan {
  scene: string;
  kind: MotionKind;
  /** The element or the beat's verb that moves; for the camera, how it moves. */
  name: string;
  span: Span;
  /**
   * A shot's steady push: from its entrance at an even pace while its beats wait on the line, so
   * the frame never holds still before the first of them.
   */
  steady?: true;
}

/**
 * Every stretch in which the picture moves, ordered by start: each scene's entrance (a camera
 * move between stops among them), each story scene's visual or shot elements entering and
 * playing their own choreography, its beats, and the scene camera (a capture's drift, the push-in
 * once settled, the hero's punch). The outro's own choreography is Covi's and is not listed.
 */
export function motionSpans(timeline: Pick<Timeline, 'scenes' | 'transition'>): MotionSpan[] {
  const spans: MotionSpan[] = [];
  timeline.scenes.forEach((scene, i) => {
    const add = (kind: MotionKind, name: string, s: Span, steady = false) => {
      if (s[1] > s[0] + 1e-9)
        spans.push({
          scene: scene.id,
          kind,
          name,
          span: [scene.start + s[0], scene.start + s[1]],
          ...(steady ? { steady: true as const } : {}),
        });
    };
    add('entrance', scene.transition?.kind ?? 'fade', [0, entranceSeconds(timeline, i)]);
    if (scene.visual.kind === 'outro') return;
    const duration = scene.end - scene.start;
    if (scene.direction)
      for (const m of shotMotion(scene)) add(m.beat ? 'beat' : 'element', m.name, m.span);
    else add('element', scene.visual.kind, [0, settledAt(scene.visual, duration, scene.phases)]);
    const plan = cameraPlan(scene);
    if (!plan) return;
    if (!plan.still && plan.drift) add('camera', 'drift', [0, duration]);
    else if (
      !plan.still &&
      plan.speechEnd !== undefined &&
      plan.settled < Math.min(plan.speechEnd, duration)
    )
      add('camera', 'push', [plan.settled, duration], plan.steady);
    if (plan.hero !== undefined) add('camera', 'punch', [plan.hero, plan.hero + PUNCH_OUT]);
  });
  return spans.sort((a, b) => a.span[0] - b.span[0]);
}
