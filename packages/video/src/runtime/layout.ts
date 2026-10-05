import type { Rect, Timeline } from '../timeline/types.ts';

/**
 * Safe-area layout per orientation. Regions never overlap: captions get their own band, the
 * narrator sits in the header, and the product being demonstrated owns the media region.
 */
export interface Regions {
  unit: number;
  progress: Rect;
  header: Rect;
  media: Rect;
  /** Media plus header, for title and summary scenes that have no header. */
  full: Rect;
  captions: Rect;
  narrator: { x: number; y: number; size: number };
  captionFont: number;
}

export function computeRegions(t: Pick<Timeline, 'width' | 'height' | 'orientation'>): Regions {
  const { width: W, height: H } = t;
  if (t.orientation === 'vertical') {
    const u = W / 1080;
    const side = 72 * u;
    const captions = { x: side, y: H - 250 * u - 220 * u, width: W - 2 * side, height: 220 * u };
    const header = { x: side, y: 112 * u, width: W - 2 * side - 190 * u, height: 220 * u };
    const media = {
      x: side,
      y: 372 * u,
      width: W - 2 * side,
      height: captions.y - 36 * u - 372 * u,
    };
    return {
      unit: u,
      progress: { x: side, y: 64 * u, width: W - 2 * side, height: 6 * u },
      header,
      media,
      full: { x: side, y: 112 * u, width: W - 2 * side, height: captions.y - 36 * u - 112 * u },
      captions,
      narrator: { x: W - side - 156 * u, y: 96 * u, size: 156 * u },
      captionFont: 50 * u,
    };
  }
  if (t.orientation === 'square') {
    const u = W / 1080;
    const side = 64 * u;
    const captions = { x: side, y: H - 56 * u - 150 * u, width: W - 2 * side, height: 150 * u };
    const header = { x: side, y: 92 * u, width: W - 2 * side - 150 * u, height: 140 * u };
    const media = {
      x: side,
      y: 250 * u,
      width: W - 2 * side,
      height: captions.y - 24 * u - 250 * u,
    };
    return {
      unit: u,
      progress: { x: side, y: 52 * u, width: W - 2 * side, height: 6 * u },
      header,
      media,
      full: { x: side, y: 92 * u, width: W - 2 * side, height: captions.y - 24 * u - 92 * u },
      captions,
      narrator: { x: W - side - 128 * u, y: 76 * u, size: 128 * u },
      captionFont: 42 * u,
    };
  }
  const u = H / 1080;
  const side = 96 * u;
  const captions = {
    x: (W - 1520 * u) / 2,
    y: H - 58 * u - 128 * u,
    width: 1520 * u,
    height: 128 * u,
  };
  const header = { x: side, y: 74 * u, width: W - 2 * side - 170 * u, height: 116 * u };
  const media = { x: side, y: 206 * u, width: W - 2 * side, height: captions.y - 26 * u - 206 * u };
  return {
    unit: u,
    progress: { x: side, y: 42 * u, width: W - 2 * side, height: 6 * u },
    header,
    media,
    full: { x: side, y: 74 * u, width: W - 2 * side, height: captions.y - 26 * u - 74 * u },
    captions,
    narrator: { x: W - side - 132 * u, y: 52 * u, size: 132 * u },
    captionFont: 38 * u,
  };
}

/** Fits an image of size (w, h) inside a box, centered (CSS object-fit: contain, computed). */
export function contain(w: number, h: number, box: Rect): Rect {
  const scale = Math.min(box.width / w, box.height / h);
  const width = w * scale;
  const height = h * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

export function inset(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: rect.width - 2 * by,
    height: rect.height - 2 * by,
  };
}
