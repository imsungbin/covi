import { describe, expect, it } from 'vitest';
import { chooseTts, ElevenLabsTts, OpenAiTts } from '../src/narration/tts.ts';

function fakeFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('hosted voices', () => {
  it('sends OpenAI speech requests in the documented shape', async () => {
    const { calls, fetchImpl } = fakeFetch();
    const tts = new OpenAiTts('key-123', 'sage', fetchImpl);
    await tts.synthesize('Hello', `${process.env.TMPDIR ?? '/tmp'}/covi-openai-test.wav`, 1.1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'sage',
      input: 'Hello',
      response_format: 'wav',
      speed: 1.1,
    });
  });

  it('sends ElevenLabs requests with the voice id in the path', async () => {
    const { calls, fetchImpl } = fakeFetch();
    const tts = new ElevenLabsTts('xi-key', 'voice-1', fetchImpl);
    await tts.synthesize('Hi', `${process.env.TMPDIR ?? '/tmp'}/covi-eleven-test.mp3`, 1);
    expect(calls[0]!.url).toContain('/v1/text-to-speech/voice-1');
    expect((calls[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('xi-key');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      text: 'Hi',
      model_id: 'eleven_multilingual_v2',
    });
  });

  it('reports API failures clearly', async () => {
    const tts = new OpenAiTts(
      'k',
      'sage',
      (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch,
    );
    await expect(tts.synthesize('x', '/tmp/never.wav', 1)).rejects.toThrow(
      /OpenAI TTS returned 429: quota/,
    );
  });
});

describe('chooseTts', () => {
  const narration = { enabled: true, provider: 'auto' as const, rate: 1 };
  it('prefers configured hosted voices and explains when nothing is available', async () => {
    expect((await chooseTts(narration, { ELEVENLABS_API_KEY: 'x' })).provider?.id).toBe(
      'elevenlabs',
    );
    expect((await chooseTts(narration, { OPENAI_API_KEY: 'x' })).provider?.id).toBe('openai');
    expect((await chooseTts({ ...narration, enabled: false }, {})).reason).toBe(
      'narration disabled',
    );
    expect((await chooseTts({ ...narration, provider: 'openai' }, {})).reason).toMatch(
      /OPENAI_API_KEY is not set/,
    );
    expect((await chooseTts({ ...narration, provider: 'none' }, {})).provider).toBeUndefined();
  });
});
