import { DEFAULT_CONFIG, parseConfigInput, resolveConfig } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  applyAnswers,
  followUpQuestions,
  parseVideoRequest,
  planVideo,
  resolveVideoSpec,
  respecVideo,
  SIZE_QUESTION,
} from '../src/spec.ts';

const config = (input = {}) =>
  resolveConfig([{ name: 'repository', values: parseConfigInput(input, 't') }]).config;

describe('parseVideoRequest', () => {
  it('reads "Make a 30-second vertical review video" without needing questions', () => {
    const { request, inferred } = parseVideoRequest('Make a 30-second vertical review video.');
    expect(request).toMatchObject({ mode: 'short', duration: 30 });
    expect(inferred.mode).toContain('vertical');
    expect(inferred.duration).toContain('30');
  });

  it.each([
    ['a 90 second walkthrough video', { mode: 'standard', duration: 90 }],
    ['quick 15s short for the team channel', { mode: 'short', duration: 15 }],
    ['make it 2 minutes', { mode: 'standard', duration: 120 }],
    ['a square video', { mode: 'custom', width: 1080, height: 1080 }],
    ['render at 1280x720', { mode: 'custom', width: 1280, height: 720 }],
    ['a silent video with no narration', { narration: false }],
    ['landscape, dark mode please', { mode: 'standard', theme: 'dark' }],
    ['without captions', { captions: false }],
  ])('%s', (text, expected) => {
    expect(parseVideoRequest(text).request).toMatchObject(expected);
  });

  it('infers nothing from vague requests', () => {
    expect(parseVideoRequest('make a review video').request).toEqual({});
  });
});

describe('parseVideoRequest: music and sound', () => {
  it.each([
    ['a review video, no music', 'none'],
    ['make it without music please', 'none'],
    ['short video, no bgm', 'none'],
    ['a 30-second vertical video with no background music, in Korean', 'none'],
    ['make a 30s video of the login fix, no music', 'none'],
    ['make a short video of this PR without music', 'none'],
    ['turn the music off', 'none'],
    ['효과음 빼고 음악 없이', 'none'],
    ['버그 수정 영상을 음악 없이 만들어줘', 'none'],
    ['バグ修正の動画を音楽なしで作って', 'none'],
    ['做一个修复bug的视频，不要音乐', 'none'],
    ['음악 없이 30초 영상', 'none'],
    ['음악 빼고 만들어줘', 'none'],
    ['BGM 없이 세로 영상', 'none'],
    ['음악 없는 영상으로', 'none'],
    ['音楽なしで縦動画を', 'none'],
    ['BGMなしのショート動画', 'none'],
    ['不要音乐的短视频', 'none'],
    ['无音乐，30秒', 'none'],
    ['没有背景音乐的视频', 'none'],
    ['compose music for it', 'compose'],
    ['compose a score for this video', 'compose'],
    ['can you compose music for it?', 'compose'],
    ['I want you to compose a soundtrack', 'compose'],
    ['a video with original music', 'compose'],
    ['give it an original score', 'compose'],
    ['음악은 새로 작곡해줘', 'compose'],
    ['이 영상에 맞춰 작곡해 주세요', 'compose'],
    ['작곡도 해줘', 'compose'],
    ['この動画のために作曲して', 'compose'],
    ['作曲をお願いします', 'compose'],
    ['配上原创音乐', 'compose'],
    ['为这个视频作曲', 'compose'],
    ['a walkthrough with music', 'theme'],
    ['add some background music', 'theme'],
    ['30s short with bgm', 'theme'],
    ['background music, please', 'theme'],
    ['음악 넣어서 만들어줘', 'theme'],
    ['BGM 넣어줘', 'theme'],
    ['音楽付きの動画', 'theme'],
    ['加上背景音乐', 'theme'],
  ])('%s → music %s', (text, music) => {
    const { request, inferred } = parseVideoRequest(text);
    expect(request.music).toBe(music);
    expect(inferred.music).toBeDefined();
  });

  it.each([
    'a silent video',
    'a silent 30-second vertical video',
    'make it silent',
    'vertical, silent, 30s',
    'mute the video',
    'make a silent video',
    'can you make a silent video?',
    'make a silent, 30-second video',
    'no sound at all please',
    'turn off all sound',
    'can you make it silent?',
    'I want a silent version',
    '무음 처리해 줘',
    '소리 없이 30초 세로 영상',
    '無音にして',
    '無音で縦動画を作って',
    '做成静音视频',
    '无声版本，30秒',
    'a video with no audio',
    'without sound, please',
    '무음 영상',
    '무음으로 만들어줘',
    '소리 없이 만들어줘',
    '소리 없는 영상',
    '無音の動画',
    '静音视频',
    '无声的短视频',
    '没有声音的视频',
  ])('%s turns narration, music, and effects off', (text) => {
    expect(parseVideoRequest(text).request).toMatchObject({
      narration: false,
      music: 'none',
      soundEffects: false,
    });
  });

  it.each([
    '30-second vertical video with no sound effects',
    'make a video, music but no sound effects',
    'without sfx',
    'sound effects off',
    '효과음 없이 30초 영상',
    '効果音なしで',
    '不要音效',
    '不要声音效果',
  ])('%s turns only the sound effects off', (text) => {
    const { request, inferred } = parseVideoRequest(text);
    expect(request.soundEffects).toBe(false);
    expect(inferred.soundEffects).toBeDefined();
    expect(request.narration).toBeUndefined();
    expect(request.music).toBeUndefined();
  });

  it.each([
    'a video with no narration',
    'without voiceover',
    '내레이션 없이',
    'ナレーションなしで',
    '无旁白',
  ])('%s turns only narration off', (text) => {
    const { request } = parseVideoRequest(text);
    expect(request.narration).toBe(false);
    expect(request.music).toBeUndefined();
    expect(request.soundEffects).toBeUndefined();
  });

  it.each([
    'a video about the new music app playlist',
    'show the change that integrates with music players',
    'review video for the composer settings page',
    'a video about restoring the original score calculation',
    'the fix for no music after resume',
    'the PR that fixes the silent failure in uploads',
    'the background music player keeps playing after pause',
    'fix: the mute button does not mute the audio',
    'fix the muted video bug',
    'a muted color palette, dark mode',
    '음악 앱 변경 영상',
    '작곡 앱의 새 기능 영상',
    '작곡을 돕는 기능 리뷰 영상',
    '작곡한 곡 저장 기능 영상',
    '소리 끄기 버튼 버그 수정 영상',
    '무음 모드 버그 수정 영상',
    '음악 끄기 버튼 영상',
    '音楽アプリの変更を動画に',
    '作曲する機能のレビュー動画',
    '音乐应用的改动视频',
    '原创音乐平台上传功能的视频',
    '修复没有音乐的问题的视频',
    '无声模式的问题',
    'review video for the fix to the silent video bug',
    'the change that lets users mute the video',
    'explain the fix: clips exported with no sound',
    'show the empty state when there is no music in the library',
    'the feature lets users play music in the background',
    'the app with music and podcast support',
    'use music for notifications',
    'a toggle for no sound effects',
    '무음으로 재생되는 버그 수정 영상',
    '무음이 되는 문제 수정 영상',
    '소리 없이 재생되는 버그 수정 영상 만들어줘',
    '음악 없이 실행하면 크래시 나는 문제 영상',
    '작곡해 주는 AI 기능 리뷰 영상 만들어줘',
    '효과음 없이 재생되는 버그 수정 영상',
    '無音になる不具合の修正動画',
    '音楽なしで起動するとクラッシュする不具合の動画',
    '作曲してくれるAI機能のレビュー動画',
    '効果音なしで再生される不具合の修正動画',
    '修复静音后无法恢复的bug的视频',
    '修复导出的视频无声，做个视频',
    '修复切换歌曲时没有背景音乐',
    '用原创音乐做背景的功能的视频',
    '무음 구간 자동 삭제 PR 리뷰 영상 만들어줘',
    '무음 감지 로직 리뷰 영상',
    '소리 없는 영상을 걸러내는 PR 영상 만들어줘',
    '無音区間を自動でカットするPRの動画',
    '無音の動画を検出する処理のレビュー動画',
    '静音检测的PR视频',
    '无声片段自动剪辑的视频',
    '给无声视频加字幕的PR视频',
    'make a video of the PR that handles clips with no audio',
    'a video showing how we transcode videos without sound',
    'video for the change that strips tracks with no audio.',
    'the PR adds silent video detection',
    'review the silent video thumbnail change',
    'make a video of the PR that exports a silent version for autoplay',
    'make a review video of this PR: turn off the sound when the screen locks',
    "make a video for PR #123 'Mute the video on focus loss'",
    'make a video for the "No audio on Safari" PR',
    'the change to compose music playlists',
    '作曲して保存する画面のレビュー動画',
    'the PR that renames bgm',
    '음악 넣어 주는 편집기 PR 영상',
    'BGM付きのテンプレートを追加するPRの動画',
    '加上音乐推荐的PR视频',
    'the importer now accepts files without music',
    '배경 음악 없이 녹음된 파일 정리하는 PR 영상',
    '音楽なしのプレイリストを除外するPRの動画',
    '没有背景音乐的歌单过滤PR的视频',
    '효과음 없이 녹화된 클립 정리 PR 영상',
    'make a video of the transcoder PR: exported clips were black and silent.',
    'make a video of the autoplay change: keep the video muted until users tap',
    '자동재생 시 무음으로 시작하도록 한 것 영상 만들어줘',
    '自動再生は無音で始まるようにした件の動画',
    'make a video for this PR, which makes the exporter create a silent version of each clip',
    'make a video of the change; we now generate a silent version for autoplay',
    'make a video of the PR that exports a version with no audio for previews',
    'the importer now handles it with no audio',
    'make a video: the preview now plays the demo with no sound',
    'make a video of the change to keep the video muted on load',
    'autoplay change: mute the video on load. make a review video',
    '무음 영상을 만들 수 있게 해 주는 옵션 리뷰 영상',
    '무음 영상도 썸네일이 나오게 바꾼 거 영상으로 만들어줘',
    '無音の動画でもサムネイルが出るようにしたの、動画にして',
    '無音版を書き出せるようにした件を動画にして',
    '让无声视频也能生成缩略图的视频',
  ])('%s says nothing about music or sound', (text) => {
    const { request } = parseVideoRequest(text);
    expect(request.music).toBeUndefined();
    expect(request.soundEffects).toBeUndefined();
    expect(request.narration).toBeUndefined();
  });

  it.each([
    'a silent video of the fix',
    'make a silent video of this PR',
    'このPRの動画を無音で作って',
  ])('%s keeps the narration: "silent" next to words about the change is not trusted', (text) => {
    expect(parseVideoRequest(text).request.narration).toBeUndefined();
  });

  it('lets a music phrase win over "silent" for the music alone', () => {
    expect(parseVideoRequest('a silent video with background music').request).toMatchObject({
      narration: false,
      music: 'theme',
      soundEffects: false,
    });
  });
});

describe('resolveVideoSpec', () => {
  it('applies mode presets', () => {
    expect(resolveVideoSpec(config(), { mode: 'short' })).toMatchObject({
      width: 1080,
      height: 1920,
      duration: { target: 28, min: 20, max: 35, auto: true },
      style: 'concise',
    });
    expect(resolveVideoSpec(config(), { mode: 'standard' })).toMatchObject({
      width: 1920,
      height: 1080,
      duration: { min: 60, max: 120 },
      style: 'explanatory',
    });
  });

  it('turns an explicit duration into a tolerance window', () => {
    expect(resolveVideoSpec(config(), { mode: 'short', duration: 30 }).duration).toEqual({
      target: 30,
      min: 25.5,
      max: 34.5,
      auto: false,
    });
  });

  it('keeps custom sizes even, and fills a missing side', () => {
    expect(resolveVideoSpec(config(), { mode: 'custom', width: 1001, height: 701 })).toMatchObject({
      width: 1002,
      height: 702,
    });
    expect(resolveVideoSpec(config(), { mode: 'custom', width: 1280 })).toMatchObject({
      width: 1280,
      height: 720,
    });
  });

  it('defaults to the Covi theme and subtle sound effects', () => {
    expect(resolveVideoSpec(config())).toMatchObject({
      music: { use: 'theme', placement: 'continuous' },
      soundEffects: true,
    });
    expect(
      resolveVideoSpec(
        config({ video: { music: { use: 'none' }, soundEffects: { enabled: false } } }),
      ),
    ).toMatchObject({ music: { use: 'none' }, soundEffects: false });
    expect(resolveVideoSpec(config(), { music: 'compose', soundEffects: false })).toMatchObject({
      music: { use: 'compose' },
      soundEffects: false,
    });
  });

  it('lays a continuous bed under every kind of video', () => {
    const place = (request: Parameters<typeof resolveVideoSpec>[1]) =>
      resolveVideoSpec(config(), request).music.placement;
    for (const request of [
      { mode: 'short' },
      { mode: 'standard' },
      { mode: 'custom', width: 1080, height: 1920 },
      { mode: 'custom', width: 1080, height: 1080 },
      { mode: 'custom', width: 1280, height: 720 },
      { mode: 'standard', narration: false },
    ] as const)
      expect(place(request), JSON.stringify(request)).toBe('continuous');
  });

  it('respects repository defaults', () => {
    expect(
      resolveVideoSpec(config({ video: { mode: 'standard', narration: false, theme: 'dark' } })),
    ).toMatchObject({ mode: 'standard', narration: { enabled: false }, theme: 'dark' });
  });
});

describe('planVideo (the question protocol)', () => {
  it('asks type and length together when nothing was specified in an interactive session', () => {
    const plan = planVideo(config(), { text: 'make a review video', interactive: true });
    expect(plan.missing).toEqual(['mode', 'duration', 'music']);
    expect(plan.questions.map((q) => q.id)).toEqual(['mode', 'duration', 'music']);
    expect(plan.questions[0]!.options.map((o) => o.label)).toEqual([
      'Short-form',
      'Standard review',
      'Custom',
    ]);
    expect(plan.questions[1]!.options.map((o) => o.label)).toEqual([
      '~15 sec',
      '~30 sec',
      '~60 sec',
      'Let Covi decide',
    ]);
  });

  it('asks nothing when the request is specific', () => {
    const plan = planVideo(config(), {
      text: 'Make a 30-second vertical review video.',
      interactive: true,
    });
    expect(plan.questions).toEqual([]);
    // Music was not specified, so the default applies (and the result says how to change it).
    expect(plan.missing).toEqual(['music']);
    expect(plan.spec.music.use).toBe('theme');
  });

  it('asks about music only alongside another question', () => {
    const music = (input: Parameters<typeof planVideo>[1]) =>
      planVideo(config(), input).questions.find((q) => q.id === 'music');
    const question = music({ text: 'make a review video', interactive: true })!;
    expect(question).toMatchObject({
      header: 'Music',
      question: 'What music should the video have?',
    });
    // The kind of video is asked too; whichever it is, the music is a bed under the narration.
    expect(question.options.map((o) => [o.value, o.label, o.description])).toEqual([
      [
        'theme',
        'Covi theme (default)',
        'Arranged to the story and the verdict. A quiet bed under the narration, louder before the first line and at the end',
      ],
      [
        'compose',
        'Compose for this video',
        'A new score written for this change; takes a little longer. A quiet bed under the narration, louder before the first line and at the end',
      ],
      ['none', 'No music', 'Narration and subtle sound effects only'],
    ]);
    // Already decided: by the request, by a flag, or by configuration.
    expect(music({ text: 'make a review video without music', interactive: true })).toBeUndefined();
    expect(music({ explicit: { music: 'compose' }, interactive: true })).toBeUndefined();
    expect(music({ provided: ['music'], interactive: true })).toBeUndefined();
    // Never on its own, and never when nobody may be asked.
    expect(music({ explicit: { mode: 'standard' }, interactive: true })).toBeUndefined();
    expect(music({ text: 'make a review video', interactive: false })).toBeUndefined();
  });

  it('describes "No music" by what remains', () => {
    const none = (input: Parameters<typeof planVideo>[1]) =>
      planVideo(config(), input).questions.find((q) => q.id === 'music')!.options[2]!.description;
    expect(none({ text: 'make a review video with no narration', interactive: true })).toBe(
      'Subtle sound effects only',
    );
    expect(none({ text: '음성 없이 리뷰 영상', interactive: true, language: 'ko' })).toBe(
      '은은한 효과음만',
    );
    expect(none({ text: '리뷰 영상 만들어줘', interactive: true })).toBe(
      '내레이션과 은은한 효과음만',
    );
  });

  it('does not ask for length when only the type was given (strong defaults)', () => {
    expect(
      planVideo(config(), { explicit: { mode: 'standard' }, interactive: true }).questions,
    ).toEqual([]);
  });

  it('never asks in non-interactive contexts', () => {
    const plan = planVideo(config(), { interactive: false });
    expect(plan.questions).toEqual([]);
    expect(plan.spec.mode).toBe('short');
  });

  it('treats repository configuration as decided', () => {
    expect(
      planVideo(config({ video: { mode: 'standard' } }), {
        provided: ['mode', 'duration'],
        interactive: true,
      }).questions,
    ).toEqual([]);
  });

  it('asks for a size only for custom videos', () => {
    expect(
      planVideo(config(), {
        explicit: { mode: 'custom' },
        provided: ['duration'],
        interactive: true,
      }).questions.map((q) => q.id),
    ).toEqual(['size', 'music']);
  });

  it('asks how long a custom-size video should be: a size implies no length', () => {
    const plan = planVideo(config(), { text: 'a square video', interactive: true });
    expect(plan.questions.map((q) => q.id)).toEqual(['duration', 'music']);
    // Without an answer, a square video gets feed-length timing, not a walkthrough's.
    expect(plan.spec.duration.target).toBeLessThanOrEqual(35);
  });

  it('follows a Custom answer with the size question unless a size is known', () => {
    const plan = planVideo(config(), { text: 'make a review video', interactive: true });
    expect(followUpQuestions(plan, { mode: 'custom' }, ['mode', 'duration'])).toEqual([
      SIZE_QUESTION,
    ]);
    expect(followUpQuestions(plan, { mode: 'short' }, ['mode', 'duration'])).toEqual([]);
    expect(followUpQuestions(plan, { mode: 'custom' }, ['mode', 'size'])).toEqual([]);
    const sized = planVideo(config({ video: { width: 1200, height: 1200 } }), {
      interactive: true,
    });
    expect(followUpQuestions(sized, { mode: 'custom' }, ['mode'])).toEqual([]);
  });

  it('applies answers', () => {
    expect(
      applyAnswers({}, { mode: 'custom', duration: '45', size: '1080x1080', music: 'none' }),
    ).toEqual({
      mode: 'custom',
      duration: 45,
      width: 1080,
      height: 1080,
      music: 'none',
    });
    expect(applyAnswers({}, { duration: 'auto' })).toEqual({ duration: 'auto' });
    expect(applyAnswers({}, { music: 'compose' })).toEqual({ music: 'compose' });
  });
});

describe('respecVideo', () => {
  const saved = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard', duration: 90 });

  it('re-renders with the settings chosen at draft time', () => {
    const spec = respecVideo(DEFAULT_CONFIG, saved, {});
    expect(spec).toMatchObject({ mode: 'standard', width: 1920, height: 1080 });
    expect(spec.duration.target).toBe(90);
  });

  it('applies new choices on top, and a new mode resets what came with the old one', () => {
    expect(respecVideo(DEFAULT_CONFIG, saved, { captions: false })).toMatchObject({
      mode: 'standard',
      captions: false,
    });
    const short = respecVideo(DEFAULT_CONFIG, saved, { mode: 'short' });
    expect(short).toMatchObject({ mode: 'short', width: 1080, height: 1920 });
    expect(short.duration.target).toBeLessThanOrEqual(35);
  });

  it('keeps the drafted frame rate and voice unless they are set again', () => {
    const drafted = resolveVideoSpec(config({ video: { fps: 24, narration: { voice: 'Reed' } } }), {
      mode: 'short',
    });
    const kept = respecVideo(DEFAULT_CONFIG, drafted, {});
    expect(kept.fps).toBe(24);
    expect(kept.narration.voice).toBe('Reed');
    const changed = respecVideo(
      config({ video: { fps: 60 } }),
      drafted,
      {},
      new Set(['video.fps']),
    );
    expect(changed.fps).toBe(60);
    expect(changed.narration.voice).toBe('Reed');
  });

  it('keeps the drafted music and effects unless they are set again', () => {
    const drafted = resolveVideoSpec(DEFAULT_CONFIG, {
      mode: 'short',
      music: 'compose',
      soundEffects: false,
    });
    expect(respecVideo(DEFAULT_CONFIG, drafted, {})).toMatchObject({
      music: { use: 'compose', placement: 'continuous' },
      soundEffects: false,
    });
    expect(respecVideo(DEFAULT_CONFIG, drafted, { music: 'none' }).music.use).toBe('none');
    // COVI_MUSIC (explicit configuration) wins over the drafted choice too.
    const env = config({ video: { music: { use: 'theme' }, soundEffects: { enabled: true } } });
    const changed = respecVideo(
      env,
      drafted,
      {},
      new Set(['video.music.use', 'video.soundEffects.enabled']),
    );
    expect(changed).toMatchObject({ music: { use: 'theme' }, soundEffects: true });
    // A new mode keeps the bed: `auto` is continuous for every kind of video.
    expect(respecVideo(DEFAULT_CONFIG, drafted, { mode: 'standard' }).music).toEqual({
      use: 'compose',
      placement: 'continuous',
      setting: 'auto',
    });
    // A run drafted when `auto` meant bookends for standard reviews gets the bed now.
    const older = {
      ...drafted,
      mode: 'standard' as const,
      music: { use: 'theme' as const, placement: 'bookends' as const, setting: 'auto' as const },
    };
    expect(respecVideo(DEFAULT_CONFIG, older, {}).music.placement).toBe('continuous');
  });

  it('keeps a chosen placement and the outro through a re-render, unless set again', () => {
    const drafted = resolveVideoSpec(DEFAULT_CONFIG, {
      mode: 'standard',
      musicPlacement: 'bookends',
      outro: false,
    });
    expect(drafted.music).toEqual({ use: 'theme', placement: 'bookends', setting: 'bookends' });
    expect(drafted.outro).toBe(false);
    // A chosen placement holds whatever the kind of video; `auto` is continuous.
    expect(respecVideo(DEFAULT_CONFIG, drafted, {})).toMatchObject({
      music: { placement: 'bookends', setting: 'bookends' },
      outro: false,
    });
    expect(respecVideo(DEFAULT_CONFIG, drafted, { musicPlacement: 'auto' }).music.placement).toBe(
      'continuous',
    );
    expect(respecVideo(DEFAULT_CONFIG, drafted, { outro: true }).outro).toBe(true);
    // Only the music: the drafted placement and outro stay.
    expect(respecVideo(DEFAULT_CONFIG, drafted, { music: 'none' })).toMatchObject({
      music: { use: 'none', placement: 'bookends' },
      outro: false,
    });
    // COVI_MUSIC_PLACEMENT and COVI_OUTRO (explicit configuration) win over the drafted choice,
    // and setting the placement leaves the drafted music alone.
    const composed = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard', music: 'compose' });
    const env = config({ video: { music: { placement: 'bookends' }, outro: false } });
    expect(
      respecVideo(env, composed, {}, new Set(['video.music.placement', 'video.outro'])),
    ).toMatchObject({ music: { use: 'compose', placement: 'bookends' }, outro: false });
  });

  it('lets configuration place the music of runs saved before placement was a setting', () => {
    const { setting: _setting, ...music } = resolveVideoSpec(DEFAULT_CONFIG, {
      mode: 'standard',
    }).music;
    const old = { ...resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }), music };
    const configured = config({ video: { music: { placement: 'bookends' } } });
    expect(respecVideo(configured, old, {}).music.placement).toBe('bookends');
    expect(respecVideo(DEFAULT_CONFIG, old, {}).music.placement).toBe('continuous');
  });

  it('places music continuously unless a placement is chosen', () => {
    const place = (request: Parameters<typeof resolveVideoSpec>[1]) =>
      resolveVideoSpec(DEFAULT_CONFIG, request).music.placement;
    expect(place({ mode: 'short' })).toBe('continuous');
    expect(place({ mode: 'standard' })).toBe('continuous');
    expect(place({ mode: 'standard', narration: false })).toBe('continuous');
    expect(place({ mode: 'custom', width: 1280, height: 720 })).toBe('continuous');
    expect(place({ mode: 'custom', width: 1080, height: 1080 })).toBe('continuous');
    expect(place({ mode: 'standard', musicPlacement: 'continuous' })).toBe('continuous');
    expect(place({ mode: 'short', musicPlacement: 'bookends' })).toBe('bookends');
    expect(resolveVideoSpec(config({ video: { music: { placement: 'bookends' } } })).music).toEqual(
      { use: 'theme', placement: 'bookends', setting: 'bookends' },
    );
    expect(resolveVideoSpec(DEFAULT_CONFIG).outro).toBe(true);
  });

  it('says where the music plays in the music question', () => {
    const where = (input: Parameters<typeof planVideo>[1], cfg = config()) =>
      planVideo(cfg, input).questions.find((q) => q.id === 'music')!.options[0]!.description;
    // A standard review gets the bed, like every kind of video.
    expect(
      where({ explicit: { mode: 'custom', width: 1920, height: 1080 }, interactive: true }),
    ).toBe(
      'Arranged to the story and the verdict. A quiet bed under the narration, louder before the first line and at the end',
    );
    expect(
      where({ explicit: { mode: 'custom', width: 1080, height: 1080 }, interactive: true }),
    ).toBe(
      'Arranged to the story and the verdict. A quiet bed under the narration, louder before the first line and at the end',
    );
    expect(
      where({
        explicit: { mode: 'custom', width: 1080, height: 1080, narration: false },
        interactive: true,
      }),
    ).toBe('Arranged to the story and the verdict. Plays under the whole video');
    // A placement in configuration says where, even while the kind of video is asked.
    expect(
      where(
        { text: 'make a review video', interactive: true },
        config({ video: { music: { placement: 'bookends' } } }),
      ),
    ).toBe(
      'Arranged to the story and the verdict. Plays at the opening and the end, and drops out under the narration',
    );
  });

  it('reads specs saved before videos had sound', () => {
    const {
      music: _music,
      soundEffects: _effects,
      ...old
    } = resolveVideoSpec(DEFAULT_CONFIG, {
      mode: 'short',
    });
    expect(respecVideo(DEFAULT_CONFIG, old as never, {})).toMatchObject({
      music: { use: 'theme' },
      soundEffects: true,
    });
  });

  it('falls back to configuration when nothing was saved', () => {
    expect(respecVideo(DEFAULT_CONFIG, undefined, {}).mode).toBe(DEFAULT_CONFIG.video.mode);
  });
});
