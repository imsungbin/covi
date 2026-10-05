import { open } from 'node:fs/promises';

/** Reads pixel dimensions from PNG, JPEG, WebP, or GIF headers (no decoding). */
export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const b = head.subarray(0, bytesRead);
    if (b.readUInt32BE(0) === 0x89504e47)
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.toString('ascii', 0, 3) === 'GIF')
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8X')
        return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let offset = 2;
      while (offset < b.length) {
        if (b[offset] !== 0xff) break;
        const marker = b[offset + 1]!;
        const length = b.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    throw new Error(`Unsupported image format: ${path}`);
  } finally {
    await handle.close();
  }
}
