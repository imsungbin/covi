import type { VideoSpec } from './spec.ts';

/*
 * The draft render (`covi render --run <id> --draft`): the same video at half size and 15 fps, for
 * an agent to look at before the real render. It is a scaled view, not another video: timing
 * never depends on the size or the frame rate, and every position scales with the frame, so the
 * full-size render of the same direction moves exactly the same way.
 */

/** Where a draft render writes, apart from the video's own files. */
export const DRAFT_DIR = 'video/draft';
export const DRAFT_PATHS = {
  preview: `${DRAFT_DIR}/preview.mp4`,
  poster: `${DRAFT_DIR}/poster.png`,
  contactSheet: `${DRAFT_DIR}/contact-sheet.jpg`,
  qc: `${DRAFT_DIR}/qc.json`,
  timeline: `${DRAFT_DIR}/timeline.json`,
  composition: `${DRAFT_DIR}/composition`,
  /** The voice, mastered, kept only until it is muxed into the preview. */
  master: `${DRAFT_DIR}/.master.wav`,
} as const;

/** A draft draws at this frame rate (or the video's, when that is lower)… */
export const DRAFT_FPS = 15;
/** …and at this share of the video's width and height. */
export const DRAFT_SCALE = 0.5;

/** The draft's spec: half the size, on even pixels as 4:2:0 video needs, at 15 fps. */
export function draftSpec(spec: VideoSpec): VideoSpec {
  const half = (n: number) => Math.max(2, 2 * Math.floor((n * DRAFT_SCALE) / 2));
  return {
    ...spec,
    width: half(spec.width),
    height: half(spec.height),
    fps: Math.min(DRAFT_FPS, spec.fps),
  };
}
