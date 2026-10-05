import { describe, expect, it } from 'vitest';
import { type Pronunciations, type SpeechRecord, speakScenes } from '../src/narration/speech.ts';
import {
  OpenAiTts,
  parseEspeakVoices,
  parseSayVoices,
  pickMacVoice,
} from '../src/narration/tts.ts';
import { speechChecks } from '../src/qc.ts';

/** A Korean storyboard whose narration still contains acronyms a Korean voice would misread. */
const scenes = [
  { id: 's1', narration: 'c2-delegate CLI를 추가합니다.' },
  { id: 's2', narration: '`JSON.parse` 대신 GRAPHQL 응답을 읽습니다.' },
  { id: 's3', narration: '요약입니다.', say: '요약입니다. API는 그대로입니다.' },
];

function record(pronunciations?: Pronunciations, voice?: SpeechRecord['voice']): SpeechRecord {
  return {
    schemaVersion: 1,
    narrated: true,
    language: 'ko',
    source: 'test',
    voice: voice ?? { provider: 'system', name: 'Yuna', locale: 'ko_KR' },
    scenes: speakScenes(scenes, { language: 'ko', pronunciations }),
  };
}

describe('speech QC', () => {
  it('warns about acronyms the voice is still given, naming the scene and the token', () => {
    const [acronyms] = speechChecks(record());
    expect(acronyms!.id).toBe('speech-acronyms');
    expect(acronyms!.status).toBe('warn');
    expect(acronyms!.message).toContain('"JSON", "GRAPHQL" in scene s2');
    expect(acronyms!.message).not.toContain('s1');
    expect(acronyms!.message).toMatch(/`say`.*pronunciations/);
  });

  it('passes once pronunciations spell them out', () => {
    const fixed = record({ JSON: '제이슨', GRAPHQL: '그래프큐엘' });
    expect(fixed.scenes.map((s) => s.spoken)).toEqual([
      'c2-delegate 씨엘아이를 추가합니다.',
      '`제이슨.parse` 대신 그래프큐엘 응답을 읽습니다.',
      '요약입니다. 에이피아이는 그대로입니다.',
    ]);
    expect(speechChecks(fixed).map((c) => c.status)).toEqual(['pass', 'pass']);
  });

  it('warns when the voice speaks another language than the narration', () => {
    const [, voice] = speechChecks(
      record(
        { JSON: '제이슨', GRAPHQL: '그래프큐엘' },
        {
          provider: 'system',
          name: 'Samantha',
          locale: 'en_US',
        },
      ),
    );
    expect(voice!.status).toBe('warn');
    expect(voice!.message).toMatch(/Samantha speaks en_US, but the narration is Korean/);
    const hosted = speechChecks(record(undefined, { provider: 'openai', name: 'sage' }))[1]!;
    expect(hosted.status).toBe('pass');
  });

  it('has nothing to check without narration or for English', () => {
    expect(speechChecks(undefined).every((c) => c.status === 'pass')).toBe(true);
    const english: SpeechRecord = { ...record(), language: 'en', voice: undefined };
    expect(speechChecks(english).every((c) => c.status === 'pass')).toBe(true);
  });
});

describe('voices', () => {
  const listing = [
    'Albert              en_US    # Hello! My name is Albert.',
    'Grandma (중국어(중국 본토)) zh_CN    # 你好！我叫Grandma。',
    'Kyoko               ja_JP    # こんにちは! 私の名前はKyokoです。',
    'Meijia              zh_TW    # 你好，我叫美佳。',
    'Samantha (영어(미국))   en_US    # Hello! My name is Samantha.',
    'Tingting            zh_CN    # 你好！我叫婷婷。',
    'Yuna (한국어(한국))      ko_KR    # 안녕하세요. 제 이름은 유나입니다.',
  ].join('\n');

  it('reads names and locales from say, even when long names leave one space', () => {
    expect(parseSayVoices(listing)).toContainEqual({
      name: 'Grandma (중국어(중국 본토))',
      locale: 'zh_CN',
    });
    expect(parseSayVoices(listing)).toHaveLength(7);
  });

  it('picks a voice that speaks the language, unless one was asked for', () => {
    const voices = parseSayVoices(listing);
    expect(pickMacVoice(voices, 'ko')).toEqual({ name: 'Yuna', locale: 'ko_KR' });
    expect(pickMacVoice(voices, 'ja')).toEqual({ name: 'Kyoko', locale: 'ja_JP' });
    expect(pickMacVoice(voices, 'zh')).toEqual({ name: 'Tingting', locale: 'zh_CN' });
    expect(pickMacVoice(voices, 'en')).toEqual({ name: 'Samantha', locale: 'en_US' });
    expect(pickMacVoice(voices, 'ko', 'Kyoko')).toEqual({ name: 'Kyoko', locale: 'ja_JP' });
    // A missing voice falls back to the language's best one.
    expect(pickMacVoice(voices, 'zh', 'Lili')).toEqual({ name: 'Tingting', locale: 'zh_CN' });
    // Without a preferred name, any voice for the language will do, mainland first for zh.
    const others = parseSayVoices(listing.replace(/^Tingting.*$/m, ''));
    expect(pickMacVoice(others, 'zh')).toEqual({ name: 'Meijia', locale: 'zh_TW' });
  });

  it('reads espeak voice languages', () => {
    expect(
      parseEspeakVoices(
        'Pty Language       Age/Gender VoiceName          File                 Other Languages\n 5  cmn             --/M      Chinese_(Mandarin) sit/cmn\n 5  ko              --/M      Korean             sit/ko\n',
      ),
    ).toEqual(['cmn', 'ko']);
  });

  it('tells hosted voices the language, and keeps their takes apart', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    const tmp = `${process.env.TMPDIR ?? '/tmp'}/covi-openai-ko.wav`;
    await new OpenAiTts('k', 'sage', fetchImpl, 'ko').synthesize('안녕하세요', tmp, 1);
    await new OpenAiTts('k', 'sage', fetchImpl, 'en').synthesize('Hello', tmp, 1);
    expect(JSON.parse(calls[0]!).instructions).toMatch(/Speak natural Korean\.$/);
    expect(JSON.parse(calls[1]!).instructions).toBe(
      'Calm, friendly, and concise: a senior engineer walking a teammate through a code change.',
    );
    expect(new OpenAiTts('k', 'sage', fetchImpl, 'ko').variant).toBe('ko');
    expect(new OpenAiTts('k', 'sage', fetchImpl, 'en').variant).toBeUndefined();
  });
});
