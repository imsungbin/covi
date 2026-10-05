import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Short, stable content hash used for ids and cache keys (not for security). */
export function shortHash(...parts: Array<string | number | undefined>): string {
  const h = createHash('sha256');
  for (const part of parts) {
    h.update(String(part ?? ''));
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 12);
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** Deterministic PRNG (mulberry32) for anything that needs repeatable "randomness". */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  return Number.parseInt(shortHash(text).slice(0, 8), 16);
}
