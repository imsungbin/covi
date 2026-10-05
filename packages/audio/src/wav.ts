import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type WavFormat = 'pcm16' | 'float32';

export interface WavData {
  sampleRate: number;
  channels: Float32Array[];
}

/** Encode planar float channels (−1..1) as a RIFF/WAVE file. */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  format: WavFormat = 'pcm16',
): Buffer {
  const first = channels[0];
  if (!first) throw new Error('encodeWav: no channels');
  const frames = first.length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('encodeWav: channels differ in length');
  }
  const numCh = channels.length;
  const bytesPerSample = format === 'pcm16' ? 2 : 4;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(format === 'pcm16' ? 1 : 3, 20); // 1 = PCM, 3 = IEEE float
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bytesPerSample * 8, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = channels[c]![i]!;
      if (format === 'pcm16') {
        const clamped = v > 1 ? 1 : v < -1 ? -1 : v;
        buf.writeInt16LE(Math.round(clamped * 32767), off);
        off += 2;
      } else {
        buf.writeFloatLE(v, off);
        off += 4;
      }
    }
  }
  return buf;
}

/** Write a WAV file, creating its directory. */
export function writeWav(
  file: string,
  channels: Float32Array[],
  sampleRate: number,
  format: WavFormat = 'pcm16',
): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodeWav(channels, sampleRate, format));
}

/** Decode a PCM16/PCM24/PCM32/float32/float64 WAV into planar float channels. */
export function decodeWav(buf: Buffer): WavData {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('decodeWav: not a RIFF/WAVE file');
  }
  let off = 12;
  let fmt: { audioFormat: number; numCh: number; sampleRate: number; bits: number } | undefined;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      let audioFormat = buf.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (audioFormat === 0xfffe && size >= 40) audioFormat = buf.readUInt16LE(body + 24);
      fmt = {
        audioFormat,
        numCh: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('decodeWav: data chunk before fmt chunk');
      const bytes = fmt.bits / 8;
      const dataLen = Math.min(size, buf.length - body);
      const frames = Math.floor(dataLen / (bytes * fmt.numCh));
      const channels = Array.from({ length: fmt.numCh }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.numCh; c++) {
          let v: number;
          if (fmt.audioFormat === 3 && fmt.bits === 32) v = buf.readFloatLE(p);
          else if (fmt.audioFormat === 3 && fmt.bits === 64) v = buf.readDoubleLE(p);
          else if (fmt.bits === 16) v = buf.readInt16LE(p) / 32768;
          else if (fmt.bits === 24) v = buf.readIntLE(p, 3) / 8388608;
          else if (fmt.bits === 32) v = buf.readInt32LE(p) / 2147483648;
          else throw new Error(`decodeWav: unsupported ${fmt.bits}-bit format ${fmt.audioFormat}`);
          channels[c]![i] = v;
          p += bytes;
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    off = body + size + (size % 2);
  }
  throw new Error('decodeWav: no data chunk');
}

export function readWav(file: string): WavData {
  return decodeWav(readFileSync(file));
}
