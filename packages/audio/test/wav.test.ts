import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeWav, encodeWav, readWav, writeWav } from '../src/wav.ts';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'covi-wav-'));
  return dir;
}

function sine(freq: number, seconds: number, sr: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe('wav io', () => {
  it('round-trips pcm16 within quantization error, creating the directory', () => {
    const file = join(tempDir(), 'nested', 'deeper', 'a.wav');
    const s = sine(440, 0.25, 48000);
    writeWav(file, [s, s], 48000, 'pcm16');
    const back = readWav(file);
    expect(back.sampleRate).toBe(48000);
    expect(back.channels).toHaveLength(2);
    expect(back.channels[0]!.length).toBe(s.length);
    let maxErr = 0;
    for (let i = 0; i < s.length; i++)
      maxErr = Math.max(maxErr, Math.abs(back.channels[1]![i]! - s[i]!));
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('round-trips float32 exactly', () => {
    const s = sine(220, 0.1, 44100, 0.9);
    const buf = encodeWav([s], 44100, 'float32');
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
    const file = join(tempDir(), 'b.wav');
    writeWav(file, [s], 44100, 'float32');
    const back = readWav(file);
    expect(Array.from(back.channels[0]!)).toEqual(Array.from(s));
  });

  it('encodes pcm16 by rounding, clamped to ±32767', () => {
    const buf = encodeWav([Float32Array.of(0, 0.5, -0.5, 1.5, -1.5)], 8000);
    const samples = Array.from({ length: 5 }, (_, i) => buf.readInt16LE(44 + 2 * i));
    expect(samples).toEqual([0, 16384, -16383, 32767, -32767]);
    expect(encodeWav([Float32Array.of(0.25, -0.75)], 8000)).toEqual(
      encodeWav([Float32Array.of(0.25, -0.75)], 8000),
    );
  });

  it('rejects mismatched channels and files that are not WAV', () => {
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 8000)).toThrow(/length/);
    expect(() => encodeWav([], 8000)).toThrow(/no channels/);
    expect(() => decodeWav(Buffer.from('not a wav file at all, really'))).toThrow(/RIFF/);
  });
});
