import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ensureSelfIgnored, exec, shortHash, which } from '@covi/core';
import type { Media } from '../render/ffmpeg.ts';
import type { VideoSpec } from '../spec.ts';
import { durationOf, readWav } from './wav.ts';

export interface TtsProvider {
  readonly id: 'system' | 'openai' | 'elevenlabs';
  readonly voice: string;
  /** Writes raw audio for `text` to `file` (any format ffmpeg can decode). */
  synthesize(text: string, file: string, rate: number): Promise<void>;
}

export interface Take {
  file: string;
  duration: number;
  cached: boolean;
}

/** Voices that read technical narration well, best first. */
const MAC_VOICES = [
  'Ava (Premium)',
  'Zoe (Premium)',
  'Samantha (Enhanced)',
  'Ava',
  'Samantha',
  'Allison',
  'Alex',
  'Daniel',
];

export class SystemTts implements TtsProvider {
  readonly id = 'system' as const;
  readonly voice: string;
  private readonly binary: 'say' | 'espeak-ng' | 'espeak';

  private constructor(binary: SystemTts['binary'], voice: string) {
    this.binary = binary;
    this.voice = voice;
  }

  static async detect(preferredVoice?: string): Promise<SystemTts | undefined> {
    if (process.platform === 'darwin' && (await which(['say']))) {
      const listing = await exec('say', ['-v', '?'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
      }).catch(() => undefined);
      const names = (listing?.stdout ?? '')
        .split('\n')
        .map((l) => l.split(/\s{2,}/)[0]?.trim() ?? '')
        .filter(Boolean);
      const has = (v: string) => names.some((n) => n === v || n.startsWith(`${v} (`));
      const voice =
        preferredVoice && has(preferredVoice)
          ? preferredVoice
          : (MAC_VOICES.find(has) ?? names[0] ?? 'Samantha');
      return new SystemTts('say', voice);
    }
    for (const bin of ['espeak-ng', 'espeak'] as const) {
      if (await which([bin])) return new SystemTts(bin, preferredVoice ?? 'en-us');
    }
    return undefined;
  }

  async synthesize(text: string, file: string, rate: number): Promise<void> {
    // `[[` starts an embedded speech command in macOS say; narration text never needs it.
    const safe = text.replace(/\[\[|\]\]/g, ' ');
    const result =
      this.binary === 'say'
        ? await exec(
            'say',
            ['-v', this.voice, '-r', String(Math.round(172 * rate)), '-o', file, '--', safe],
            { cwd: dirname(file), timeoutMs: 60_000 },
          )
        : await exec(
            this.binary,
            ['-v', this.voice, '-s', String(Math.round(165 * rate)), '-w', file, '--', safe],
            { cwd: dirname(file), timeoutMs: 60_000 },
          );
    if (result.exitCode !== 0) throw new Error(`${this.binary} failed: ${result.stderr.trim()}`);
  }
}

export class OpenAiTts implements TtsProvider {
  readonly id = 'openai' as const;
  readonly voice: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, voice = 'sage', fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.voice = voice;
    this.fetchImpl = fetchImpl;
  }

  async synthesize(text: string, file: string, rate: number): Promise<void> {
    const response = await this.fetchImpl('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: this.voice,
        input: text,
        response_format: 'wav',
        speed: rate,
        instructions:
          'Calm, friendly, and concise: a senior engineer walking a teammate through a code change.',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(
        `OpenAI TTS returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
}

export class ElevenLabsTts implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly voice: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, voice = '21m00Tcm4TlvDq8ikWAM', fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.voice = voice;
    this.fetchImpl = fetchImpl;
  }

  async synthesize(text: string, file: string, rate: number): Promise<void> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voice)}?output_format=mp3_44100_128`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          speed: Math.min(1.2, Math.max(0.7, rate)),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(
        `ElevenLabs TTS returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
}

export interface TtsChoice {
  provider?: TtsProvider;
  reason: string;
}

/** `auto` prefers a configured hosted voice, then the operating system's speech engine. */
export async function chooseTts(
  narration: VideoSpec['narration'],
  env: NodeJS.ProcessEnv = process.env,
): Promise<TtsChoice> {
  if (!narration.enabled) return { reason: 'narration disabled' };
  const p = narration.provider;
  if (p === 'none') return { reason: 'narration provider is none' };
  if (p === 'elevenlabs' || (p === 'auto' && env.ELEVENLABS_API_KEY)) {
    if (!env.ELEVENLABS_API_KEY) return { reason: 'ELEVENLABS_API_KEY is not set' };
    return {
      provider: new ElevenLabsTts(env.ELEVENLABS_API_KEY, narration.voice),
      reason: p === 'auto' ? 'ELEVENLABS_API_KEY is set' : 'configured',
    };
  }
  if (p === 'openai' || (p === 'auto' && env.OPENAI_API_KEY)) {
    if (!env.OPENAI_API_KEY) return { reason: 'OPENAI_API_KEY is not set' };
    return {
      provider: new OpenAiTts(env.OPENAI_API_KEY, narration.voice),
      reason: p === 'auto' ? 'OPENAI_API_KEY is set' : 'configured',
    };
  }
  const system = await SystemTts.detect(narration.voice);
  if (system) return { provider: system, reason: `system speech (${system.voice})` };
  return {
    reason:
      'no speech engine found (install espeak-ng, or set OPENAI_API_KEY / ELEVENLABS_API_KEY)',
  };
}

/**
 * Synthesizes one narration line into a normalized mono 48 kHz take. Takes are content-addressed
 * (provider, voice, rate, text), so re-rendering a storyboard never pays for unchanged lines.
 */
export async function synthesizeTake(
  provider: TtsProvider,
  text: string,
  options: { rate: number; cacheDir: string; media: Media; tempo?: number },
): Promise<Take> {
  const key = shortHash(
    provider.id,
    provider.voice,
    options.rate,
    options.tempo ?? 1,
    text,
    'take-v1',
  );
  const file = join(options.cacheDir, 'tts', `${key}.wav`);
  const existing = await stat(file).catch(() => undefined);
  if (existing && existing.size > 44)
    return { file, duration: durationOf(await readWav(file)), cached: true };
  await mkdir(dirname(file), { recursive: true });
  await ensureSelfIgnored(options.cacheDir);
  const raw = join(
    dirname(file),
    `${key}.raw${provider.id === 'elevenlabs' ? '.mp3' : provider.id === 'openai' ? '.wav' : process.platform === 'darwin' ? '.aiff' : '.wav'}`,
  );
  await provider.synthesize(text, raw, options.rate);
  const tmp = `${file}.tmp.wav`;
  const tempo = options.tempo && options.tempo !== 1 ? `,atempo=${options.tempo.toFixed(3)}` : '';
  await options.media.ffmpeg([
    '-i',
    raw,
    '-af',
    `silenceremove=start_periods=1:start_silence=0.04:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-48dB,areverse,highpass=f=70${tempo},loudnorm=I=-18:TP=-2:LRA=9,apad=pad_dur=0.04`,
    '-ar',
    '48000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    tmp,
  ]);
  await rename(tmp, file);
  await rm(raw, { force: true });
  return { file, duration: durationOf(await readWav(file)), cached: false };
}
