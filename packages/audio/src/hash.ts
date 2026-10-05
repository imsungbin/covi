import { createHash } from 'node:crypto';

/**
 * JSON.stringify with object keys sorted recursively, so equal data always serializes
 * identically.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable 16-hex-char sha256 digest of strings, buffers, typed arrays, and plain data. */
export function hashOf(...parts: unknown[]): string {
  const h = createHash('sha256');
  for (const part of parts) {
    if (Buffer.isBuffer(part)) {
      h.update('b:');
      h.update(part);
    } else if (ArrayBuffer.isView(part)) {
      h.update('t:');
      h.update(Buffer.from(part.buffer, part.byteOffset, part.byteLength));
    } else if (typeof part === 'string') {
      h.update('s:');
      h.update(part);
    } else {
      h.update('j:');
      h.update(stableStringify(part) ?? 'undefined');
    }
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 16);
}
