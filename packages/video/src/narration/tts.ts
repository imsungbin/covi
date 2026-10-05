import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ensureSelfIgnored,
  exec,
  LANGUAGE_NAME,
  type Language,
  shortHash,
  which,
} from '@covi/core';
import type { Media } from '../render/ffmpeg.ts';
import type { VideoSpec } from '../spec.ts';
import { localeLanguage } from './speech.ts';
import { durationOf, readWav } from './wav.ts';

export interface TtsProvider {
  readonly id: 'system' | 'openai' | 'elevenlabs';
  readonly voice: string;
  /** The voice's locale when the engine reports one (`ko_KR`, `en-us`); hosted voices have none. */
  readonly locale?: string;
  /** Distinguishes takes of the same text and voice that sound different (cache key). */
  readonly variant?: string;
  /** Writes raw audio for `text` to `file` (any format ffmpeg can decode). */
  synthesize(text: string, file: string, rate: number): Promise<void>;
}

export interface Take {
  file: string;
  duration: number;
  cached: boolean;
}

/** macOS voices that read technical narration well, best first, per language. */
const MAC_VOICES: Record<Language, string[]> = {
  en: [
    'Ava (Premium)',
    'Zoe (Premium)',
    'Samantha (Enhanced)',
    'Ava',
    'Samantha',
    'Allison',
    'Alex',
    'Daniel',
  ],
  ko: [
    'Yuna (Premium)',
    'Yuna (Enhanced)',
    'Yuna',
    'Jian (Premium)',
    'Jian (Enhanced)',
    'Jian',
    'Suhyun',
    'Minsu',
    'Sora',
  ],
  ja: [
    'Kyoko (Premium)',
    'Kyoko (Enhanced)',
    'Kyoko',
    'Otoya (Premium)',
    'Otoya (Enhanced)',
    'Otoya',
    'Hattori',
    'O-Ren',
  ],
  zh: [
    'Tingting (Premium)',
    'Tingting (Enhanced)',
    'Tingting',
    'Lili (Premium)',
    'Lili (Enhanced)',
    'Lili',
    'Yu-shu',
    'Lilian',
    'Meijia',
    'Sinji',
  ],
};

/** espeak voices are language codes; Mandarin is `cmn` in espeak-ng (`zh` in older espeak). */
const ESPEAK_VOICES: Record<Language, string[]> = {
  en: ['en-us', 'en'],
  ko: ['ko'],
  ja: ['ja'],
  zh: ['cmn', 'zh'],
};

/** Regional locales a language prefers when several match (Simplified Chinese: mainland first). */
const PREFERRED_LOCALE: Partial<Record<Language, string>> = { zh: 'zh_CN', en: 'en_US' };

/** A voice to suggest for a language when the configured one speaks another. */
export function suggestedVoice(provider: string, language: Language): string | undefined {
  if (provider !== 'system') return undefined;
  if (process.platform === 'darwin') return MAC_VOICES[language].find((v) => !v.includes('('));
  return ESPEAK_VOICES[language][0];
}

export interface SystemVoice {
  name: string;
  locale: string;
}

/**
 * Parses `say -v '?'`: `Name  locale  # sample`. Names can be long and localized
 * (`Grandma (중국어(중국 본토)) zh_CN`), so the locale column, not spacing, ends the name.
 */
export function parseSayVoices(listing: string): SystemVoice[] {
  const out: SystemVoice[] = [];
  for (const line of listing.split('\n')) {
    const m = /^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]{2,4})\s+#/.exec(line);
    if (m) out.push({ name: m[1]!.trim(), locale: m[2]! });
  }
  return out;
}

/** Parses `espeak-ng --voices`: the second column is the language code each voice speaks. */
export function parseEspeakVoices(listing: string): string[] {
  return listing
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[1] ?? '')
    .filter(Boolean);
}

/** The voice to use: the one asked for when installed, else the best installed one for the language. */
export function pickMacVoice(
  voices: readonly SystemVoice[],
  language: Language,
  preferred?: string,
): SystemVoice | undefined {
  const find = (v: string) => voices.find((x) => x.name === v || x.name.startsWith(`${v} (`));
  const asked = preferred ? find(preferred) : undefined;
  if (asked) return { name: preferred!, locale: asked.locale };
  for (const name of MAC_VOICES[language]) {
    const found = find(name);
    if (found) return { name, locale: found.locale };
  }
  const speaking = voices.filter((v) => localeLanguage(v.locale) === language);
  const regional = speaking.find((v) => v.locale === PREFERRED_LOCALE[language]);
  return regional ?? speaking[0] ?? voices[0];
}

export class SystemTts implements TtsProvider {
  readonly id = 'system' as const;
  readonly voice: string;
  readonly locale?: string;
  private readonly binary: 'say' | 'espeak-ng' | 'espeak';

  private constructor(binary: SystemTts['binary'], voice: string, locale?: string) {
    this.binary = binary;
    this.voice = voice;
    this.locale = locale;
  }

  /** The best installed voice for `language`, or `preferredVoice` when it is installed. */
  static async detect(
    preferredVoice?: string,
    language: Language = 'en',
  ): Promise<SystemTts | undefined> {
    if (process.platform === 'darwin' && (await which(['say']))) {
      // Listing voices can take seconds on a busy machine; a missing list must not silently turn
      // into an English voice reading Korean.
      let voices: SystemVoice[] = [];
      for (const timeoutMs of [20_000, 60_000]) {
        const listing = await exec('say', ['-v', '?'], { cwd: process.cwd(), timeoutMs }).catch(
          () => undefined,
        );
        voices = parseSayVoices(listing?.stdout ?? '');
        if (voices.length) break;
      }
      if (!voices.length)
        return new SystemTts(
          'say',
          preferredVoice ?? MAC_VOICES[language].find((v) => !v.includes('(')) ?? 'Samantha',
        );
      const voice = pickMacVoice(voices, language, preferredVoice);
      return new SystemTts('say', voice?.name ?? preferredVoice ?? 'Samantha', voice?.locale);
    }
    for (const bin of ['espeak-ng', 'espeak'] as const) {
      if (!(await which([bin]))) continue;
      if (preferredVoice) return new SystemTts(bin, preferredVoice, preferredVoice);
      const listing = await exec(bin, ['--voices'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
      }).catch(() => undefined);
      const installed = new Set(parseEspeakVoices(listing?.stdout ?? ''));
      const voice = ESPEAK_VOICES[language].find((v) => installed.has(v)) ?? 'en-us';
      return new SystemTts(bin, voice, voice);
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

const OPENAI_INSTRUCTIONS =
  'Calm, friendly, and concise: a senior engineer walking a teammate through a code change.';

export class OpenAiTts implements TtsProvider {
  readonly id = 'openai' as const;
  readonly voice: string;
  readonly variant?: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly instructions: string;

  constructor(
    apiKey: string,
    voice = 'sage',
    fetchImpl: typeof fetch = fetch,
    language: Language = 'en',
  ) {
    this.apiKey = apiKey;
    this.voice = voice;
    this.fetchImpl = fetchImpl;
    // The model follows the text's language on its own; naming it avoids an English accent.
    this.instructions =
      language === 'en'
        ? OPENAI_INSTRUCTIONS
        : `${OPENAI_INSTRUCTIONS} Speak natural ${LANGUAGE_NAME[language]}.`;
    if (language !== 'en') this.variant = language;
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
        instructions: this.instructions,
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
      // eleven_multilingual_v2 detects the language from the text; it rejects language_code.
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

/**
 * `auto` prefers a configured hosted voice, then the operating system's speech engine. Without a
 * configured voice, the system engine picks one that speaks `language`.
 */
export async function chooseTts(
  narration: VideoSpec['narration'],
  env: NodeJS.ProcessEnv = process.env,
  language: Language = 'en',
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
      provider: new OpenAiTts(env.OPENAI_API_KEY, narration.voice, fetch, language),
      reason: p === 'auto' ? 'OPENAI_API_KEY is set' : 'configured',
    };
  }
  const system = await SystemTts.detect(narration.voice, language);
  if (system) return { provider: system, reason: `system speech (${system.voice})` };
  return {
    reason:
      'no speech engine found (install espeak-ng, or set OPENAI_API_KEY / ELEVENLABS_API_KEY)',
  };
}

/**
 * Synthesizes one narration line into a normalized mono 48 kHz take. Takes are content-addressed
 * (provider, voice, variant, rate, text), so re-rendering a storyboard never pays for unchanged
 * lines.
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
    ...(provider.variant ? [provider.variant] : []),
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
