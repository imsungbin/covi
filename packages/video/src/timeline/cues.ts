import type { TimelineCue, TimelineScene } from './types.ts';

/*
 * When things happen on screen, as pure functions of a scene's length. The browser runtime draws
 * with these windows and the sound engine places effects at the same moments, so a click is heard
 * when it is seen. No DOM and no Node APIs: the runtime bundles this file.
 *
 * Every window is [start, end] in seconds since the scene started.
 */

export type Span = readonly [number, number];

/** A screenshot's pointer travels to the click point, then presses. */
export function screenshotPointer(duration: number): { move: Span; press: Span } {
  return {
    move: [duration * 0.42, duration * 0.62],
    press: [duration * 0.62, duration * 0.8],
  };
}

/** Each interaction step gets an equal share of the scene. */
export function interactionSlot(duration: number, steps: number): number {
  return duration / Math.max(1, steps);
}

/** An interaction step's pointer, within the step's slot. */
export function interactionPointer(slot: number): { move: Span; press: Span } {
  return {
    move: [slot * 0.25, slot * 0.6],
    press: [slot * 0.6, slot * 0.85],
  };
}

/**
 * When the after state appears next to the before state. A wipe uncovers it across most of the
 * scene; a split or stack brings the after panel in just after the before panel.
 */
export function beforeAfterReveal(layout: 'split' | 'stack' | 'wipe', duration: number): Span {
  return layout === 'wipe' ? [duration * 0.25, duration * 0.7] : [0.35, 0.85];
}

/** Finding cards slide in one after another. */
export function findingEntrance(index: number): Span {
  return [0.15 + index * 0.45, 0.7 + index * 0.45];
}

/** Ease-out travel covered at the landing: the card reads as arrived at 90%. */
const LANDED = 1 - Math.cbrt(0.1);

/** The moment finding card `index` lands. */
export function findingLanding(index: number): number {
  const [start, end] = findingEntrance(index);
  return start + (end - start) * LANDED;
}

/** The summary's verdict badge rises into view. */
export function verdictEntrance(): Span {
  return [0.3, 0.7];
}

/**
 * When the outro card settles: the fox has landed, the wordmark is written, and the ▶ over its
 * i lands. The music's sonic logo lands on this moment, so it never depends on the music.
 */
export function outroSettle(): number {
  return 1;
}

/**
 * Every moment with a sound, in time order. Scene transitions, code, and terminals have none. The
 * outro's moment is where the music's logo lands, or, without music, its own sign-off sound.
 */
export function buildCues(scenes: readonly TimelineScene[]): TimelineCue[] {
  const cues: TimelineCue[] = [];
  for (const scene of scenes) {
    const v = scene.visual;
    const duration = scene.end - scene.start;
    const at = (t: number) => scene.start + t;
    switch (v.kind) {
      case 'screenshot':
        if (v.click)
          cues.push({
            t: at(screenshotPointer(duration).press[0]),
            kind: 'click',
            scene: scene.id,
          });
        break;
      case 'interaction': {
        const slot = interactionSlot(duration, v.steps.length);
        v.steps.forEach((step, i) => {
          if (step.click)
            cues.push({
              t: at(i * slot + interactionPointer(slot).press[0]),
              kind: 'click',
              scene: scene.id,
            });
        });
        break;
      }
      case 'before-after':
        cues.push({
          t: at(beforeAfterReveal(v.layout, duration)[0]),
          kind: 'reveal',
          scene: scene.id,
        });
        break;
      case 'findings':
        v.findings.forEach((f, i) => {
          cues.push({
            t: at(findingLanding(i)),
            kind: 'finding',
            scene: scene.id,
            ...(f.severity === 'high' ? { detail: 'high' } : {}),
          });
        });
        break;
      case 'summary':
        cues.push({
          t: at(verdictEntrance()[0]),
          kind: 'verdict',
          scene: scene.id,
          detail: v.verdict,
        });
        break;
      case 'outro':
        cues.push({
          t: at(outroSettle()),
          kind: 'outro',
          scene: scene.id,
          ...(v.verdict ? { detail: v.verdict } : {}),
        });
        break;
      default:
        break;
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}
