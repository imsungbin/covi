import { isCjk } from '../text.ts';
import { keptTokens } from './cues.ts';
import type { MorphVisual } from './types.ts';

/*
 * How long words on screen take to read. The resolver times a morph by it and QC's `reading-time`
 * checks the timeline against it, so neither depends on the other. Node only: it counts CJK
 * characters with the text module, which the runtime does not bundle.
 */

/** Reading time: a fixed glance, then characters at 15 a second, or 8 for CJK characters. */
export const READING = { glance: 0.4, latin: 15, cjk: 8 } as const;
/** The code a morph adds is held at most this long (s): a long hunk is read with the narration. */
export const MORPH_READING = 2;

/** How long `text` takes to read, in seconds: whitespace is free. */
export function readingSeconds(text: string): number {
  let latin = 0;
  let cjk = 0;
  for (const char of text) {
    if (/\s/u.test(char)) continue;
    if (isCjk(char)) cjk++;
    else latin++;
  }
  return READING.glance + latin / READING.latin + cjk / READING.cjk;
}

/** The code a morph adds: the head's tokens it does not keep, its markers for elided runs aside. */
function addedCode(morph: MorphVisual): string {
  const kept = keptTokens(morph).head;
  return morph.head
    .flatMap((row, r) =>
      row.type === 'elided'
        ? []
        : row.tokens.flatMap((t, i) => (kept.has(`${r}:${i}`) ? [] : [t.text])),
    )
    .join('');
}

/**
 * How long the code a morph adds must stay on screen once it has settled: its reading time, at
 * most 2 s; nothing when it adds no code.
 */
export function morphReading(morph: MorphVisual): number {
  const added = addedCode(morph);
  return added.trim() ? Math.min(MORPH_READING, readingSeconds(added)) : 0;
}
