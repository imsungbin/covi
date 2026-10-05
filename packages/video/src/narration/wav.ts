import { readFile, writeFile } from 'node:fs/promises';

/** Minimal PCM WAV I/O. Covi normalizes every take to mono 48 kHz 16-bit, so this is all it needs. */
export const SAMPLE_RATE = 48_000;

export interface Pcm {
  sampleRate: number;
  samples: Int16Array;
}

export async function readWav(path: string): Promise<Pcm> {
  const buf = await readFile(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`${path} is not a WAV file`);
  let offset = 12;
  let sampleRate = SAMPLE_RATE;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`${path}: expected 16-bit PCM, got ${bits}-bit`);
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / 2 / channels);
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = buf.readInt16LE(body + i * 2 * channels);
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

export async function writeWav(path: string, pcm: Pcm): Promise<void> {
  const data = Buffer.alloc(pcm.samples.length * 2);
  for (let i = 0; i < pcm.samples.length; i++) data.writeInt16LE(pcm.samples[i]!, i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(pcm.sampleRate, 24);
  header.writeUInt32LE(pcm.sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  await writeFile(path, Buffer.concat([header, data]));
}

export function durationOf(pcm: Pcm): number {
  return pcm.samples.length / pcm.sampleRate;
}

/** Places takes on a silent track at their start times (seconds). */
export function mixTakes(
  takes: Array<{ pcm: Pcm; start: number }>,
  totalSeconds: number,
  sampleRate = SAMPLE_RATE,
): Pcm {
  const out = new Int16Array(Math.ceil(totalSeconds * sampleRate));
  for (const { pcm, start } of takes) {
    const offset = Math.round(start * sampleRate);
    for (let i = 0; i < pcm.samples.length && offset + i < out.length; i++) {
      const v = out[offset + i]! + pcm.samples[i]!;
      out[offset + i] = Math.max(-32768, Math.min(32767, v));
    }
  }
  return { sampleRate, samples: out };
}

/**
 * Mouth openness per video frame from the voice track: windowed RMS, normalized to the loud end of
 * the take, gated, and smoothed with a fast attack and slower release so the fox "talks" in sync.
 */
export function mouthEnvelope(pcm: Pcm, fps: number, frames: number): number[] {
  const per = pcm.sampleRate / fps;
  const rms: number[] = [];
  for (let f = 0; f < frames; f++) {
    const from = Math.floor(f * per);
    const to = Math.min(pcm.samples.length, Math.floor((f + 1) * per));
    let sum = 0;
    for (let i = from; i < to; i++) sum += (pcm.samples[i]! / 32768) ** 2;
    rms.push(to > from ? Math.sqrt(sum / (to - from)) : 0);
  }
  const voiced = rms.filter((v) => v > 0.004).sort((a, b) => a - b);
  const ref = voiced[Math.floor(voiced.length * 0.9)] ?? 1;
  const out: number[] = [];
  let level = 0;
  for (const v of rms) {
    const target = v < 0.006 ? 0 : Math.min(1, Math.sqrt(v / ref));
    level = target > level ? level + (target - level) * 0.7 : level + (target - level) * 0.35;
    out.push(Math.round(level * 100) / 100);
  }
  return out;
}

/** A plausible talking rhythm when there is no audio (captions-only videos). */
export function syntheticMouth(
  windows: Array<{ start: number; end: number }>,
  fps: number,
  frames: number,
  seed = 1,
): number[] {
  const out = new Array<number>(frames).fill(0);
  for (const w of windows) {
    for (let f = Math.floor(w.start * fps); f < Math.min(frames, Math.ceil(w.end * fps)); f++) {
      const t = f / fps;
      const syllable = Math.abs(Math.sin((t * 4.3 + seed * 0.37) * Math.PI));
      const phrase = 0.65 + 0.35 * Math.sin(t * 1.3 + seed);
      out[f] = Math.round(Math.min(1, syllable * phrase) * 100) / 100;
    }
  }
  return out;
}
