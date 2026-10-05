import { readFile, writeFile } from 'node:fs/promises';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelDiff {
  changedRatio: number;
  changedPixels: number;
  bounds?: Rect;
  sizeChanged: boolean;
}

export async function readPng(path: string): Promise<PNG> {
  return PNG.sync.read(await readFile(path));
}

/** Compares two screenshots; writes a diff image and returns where pixels changed. */
export async function comparePngs(
  beforePath: string,
  afterPath: string,
  diffPath?: string,
): Promise<PixelDiff> {
  const a = await readPng(beforePath);
  const b = await readPng(afterPath);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img: PNG) => {
    if (img.width === width && img.height === height) return img.data;
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      img.data.copy(out, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4);
    return out;
  };
  const da = crop(a);
  const db = crop(b);
  const diff = new PNG({ width, height });
  const changedPixels = pixelmatch(da, db, diff.data, width, height, {
    threshold: 0.12,
    includeAA: false,
    alpha: 0.25,
  });
  if (diffPath) await writeFile(diffPath, PNG.sync.write(diff));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // pixelmatch paints changed pixels in its diff color (red by default).
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const sizeChanged = a.width !== b.width || a.height !== b.height;
  return {
    changedPixels,
    changedRatio: changedPixels / (width * height),
    bounds:
      maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined,
    sizeChanged,
  };
}

/** Crops a PNG to a rectangle (clamped to the image) and writes it. */
export async function cropPng(
  source: string,
  rect: Rect,
  out: string,
): Promise<{ width: number; height: number }> {
  const img = await readPng(source);
  const x = Math.max(0, Math.min(img.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(img.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(img.height - y, Math.round(rect.height)));
  const target = new PNG({ width, height });
  for (let row = 0; row < height; row++)
    img.data.copy(
      target.data,
      row * width * 4,
      ((y + row) * img.width + x) * 4,
      ((y + row) * img.width + x + width) * 4,
    );
  await writeFile(out, PNG.sync.write(target));
  return { width, height };
}
