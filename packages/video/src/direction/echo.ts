import { escapeUnprintable } from '@covi/core';

/** Characters a problem prints of a cited id, a phrase, or a scene id, escapes included. */
const ECHO_CHARS = 120;

/**
 * Text from the direction or the storyboard as a problem echoes it: their authors may be hostile,
 * so nothing unprintable reaches the terminal raw, and the printed text is at most `ECHO_CHARS`
 * long. A cut falls between characters, never inside an escape or a surrogate pair.
 */
export function shown(text: string): string {
  const parts: string[] = [];
  let length = 0;
  for (const char of text) {
    const part = escapeUnprintable(char);
    if (length + part.length > ECHO_CHARS) {
      while (length + 1 > ECHO_CHARS) length -= parts.pop()!.length;
      return `${parts.join('')}…`;
    }
    parts.push(part);
    length += part.length;
  }
  return parts.join('');
}
