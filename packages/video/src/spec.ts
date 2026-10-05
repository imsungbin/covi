import type {
  CoviConfig,
  Language,
  MusicChoice,
  MusicPlacementSetting,
  VideoMode,
} from '@covi/core';
import { detectLanguage, parseDuration, t } from '@covi/core';

/**
 * Video intent → a concrete, renderable spec. Strong defaults per mode; explicit requests win;
 * CI never asks. Interactive agents ask only what is missing (see `planVideo`).
 */
export interface VideoSpec {
  mode: VideoMode;
  width: number;
  height: number;
  fps: number;
  /** Target length in seconds, and the window QC accepts. */
  duration: { target: number; min: number; max: number; auto: boolean };
  narration: {
    enabled: boolean;
    provider: CoviConfig['video']['narration']['provider'];
    voice?: string;
    rate: number;
  };
  captions: boolean;
  style: 'concise' | 'explanatory';
  theme: 'light' | 'dark';
  mascot: boolean;
  /** A language the request named ("a Korean video"); it wins over the run's language. */
  language?: Language;
  /** Background music: what plays, and where. */
  music: {
    use: MusicChoice;
    /** Where it plays in this video: the placement chosen, or the one the kind of video implies. */
    placement: MusicPlacement;
    /** The placement as chosen; `auto` lets the kind of video decide. Older specs lack it. */
    setting?: MusicPlacementSetting;
  };
  /** Subtle sound effects for what happens on screen. */
  soundEffects: boolean;
  /** The branded outro after the last scene (older specs lack it). */
  outro: boolean;
}

/**
 * Where music plays. Feed formats (short-form, vertical, square) keep a quiet bed under the whole
 * video; standard reviews play it at the start, in the breaths between lines, and at the end,
 * because a two-minute bed under technical narration is tiring. `video.music.placement` chooses
 * one explicitly.
 */
export type MusicPlacement = 'continuous' | 'bookends';

export const MODE_PRESETS: Record<
  'short' | 'standard',
  {
    width: number;
    height: number;
    target: number;
    min: number;
    max: number;
    style: VideoSpec['style'];
  }
> = {
  short: { width: 1080, height: 1920, target: 28, min: 20, max: 35, style: 'concise' },
  standard: { width: 1920, height: 1080, target: 80, min: 60, max: 120, style: 'explanatory' },
};

export type Orientation = 'vertical' | 'landscape' | 'square';

export function orientationOf(width: number, height: number): Orientation {
  if (Math.abs(width - height) / Math.max(width, height) < 0.1) return 'square';
  return height > width ? 'vertical' : 'landscape';
}

/**
 * The preset a video takes its timing from. A custom size takes the closest one: square and
 * vertical videos are feed formats (short); landscape ones are walkthroughs (standard).
 */
export function timingPreset(
  spec: Pick<VideoSpec, 'mode' | 'width' | 'height'>,
): keyof typeof MODE_PRESETS {
  if (spec.mode !== 'custom') return spec.mode;
  return orientationOf(spec.width, spec.height) === 'landscape' ? 'standard' : 'short';
}

/** What a person (or agent) asked for, before defaults. */
export interface VideoRequest {
  mode?: VideoMode;
  width?: number;
  height?: number;
  duration?: number | 'auto';
  narration?: boolean;
  captions?: boolean;
  theme?: 'light' | 'dark';
  style?: 'concise' | 'explanatory';
  /** A language the request names: "in Korean", "한국어로", "日本語で", "用中文". */
  language?: Language;
  music?: MusicChoice;
  musicPlacement?: MusicPlacementSetting;
  soundEffects?: boolean;
  outro?: boolean;
}

export interface ParsedRequest {
  request: VideoRequest;
  /** Human-readable reasons for each inferred field, e.g. `mode: "vertical"`. */
  inferred: Record<string, string>;
}

const NUMBER_WORDS: Record<string, number> = {
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  'one-minute': 60,
  'two-minute': 120,
  'a minute': 60,
  'one minute': 60,
  'two minutes': 120,
};

/** Language names in English, Korean, Japanese, and Chinese. */
const LANGUAGE_WORDS: Array<[Language, string]> = [
  ['ko', 'korean|한국어|韓国語|韩语|韩文'],
  ['ja', 'japanese|일본어|日本語|日语|日文'],
  ['zh', 'chinese|mandarin|중국어|中国語|中文|汉语|普通话|简体中文'],
  ['en', 'english|영어|英語|英文|英语'],
];

/** Phrases that ask for a language explicitly, not merely mention one. */
function requestedLanguage(t: string): { language: Language; phrase: string } | undefined {
  for (const [language, names] of LANGUAGE_WORDS) {
    const patterns = [
      new RegExp(`\\b(?:in|into)\\s+(?:${names})\\b`),
      new RegExp(
        `\\b(?:${names})\\s+(?:video|narration|narrated|voice(?:over)?|captions?|subtitles?|version)\\b`,
      ),
      new RegExp(`(?:${names})\\s*(?:로|으로|버전|영상|내레이션|나레이션|음성|자막)`),
      new RegExp(`(?:${names})\\s*(?:で|の(?:動画|ナレーション|音声|字幕))`),
      new RegExp(`(?:用|以|说)\\s*(?:${names})|(?:${names})\\s*(?:视频|旁白|配音|字幕|版)`),
    ];
    for (const re of patterns) {
      const m = re.exec(t);
      if (m) return { language, phrase: m[0].trim() };
    }
  }
  return undefined;
}

/*
 * Sound requests. Each pattern is a request, not a word, because the same words describe changes:
 * "the fix for no music after resume", "the PR that handles clips with no audio", "무음 구간 자동
 * 삭제" (removing silent stretches), "原创音乐平台" (an original-music platform). An English
 * phrase must follow the start of a clause, the video, or a request verb, and end where a request
 * ends. A Korean, Japanese, or Chinese phrase must be followed by a request ending, the video, or
 * another sound request. Then the clause around a match decides (`aboutTheChange`), and quoted
 * text, such as a PR title, decides nothing.
 */
const anyOf = (...patterns: string[]) => new RegExp(patterns.join('|'), 'g');
/** The phrase ends here: the end, punctuation, or a word that starts the next request. */
const ENDS = String.raw`(?=\s*(?:$|[.,!?;:)，。！？；、]|and\b|or\b|but\b|please\b|in\b|for\b|on\b|too\b|with\b|behind\b|under\b))`;
/** Music asked for ends its clause: "with music and podcast support" names a feature. */
const ENDS_CLAUSE = String.raw`(?=\s*(?:$|[.,!?;:)，。！？；、]|please\b|too\b|behind\b|under\b))`;
/** Where an English request's sound phrase starts: a clause, the video, or a request verb. */
const AT_START = String.raw`(?<=(?:^|[,;:(]|\b(?:and|but|please|also|then)\b)\s*)`;
const AFTER_VIDEO = String.raw`(?<=\b(?:video|it|this|one|version|cut|clip|short|reel|walkthrough|demo|render|pr|change)\s+(?:with\s+)?)`;
const AFTER_VERB = String.raw`(?<=\b(?:make|create|render|give|want|need|produce|generate|prefer|do)\s+(?:me\s+|us\s+)?(?:(?:a|an|the|this|it)\s+)?)`;
const ASKED = `(?:${AT_START}|${AFTER_VIDEO}|${AFTER_VERB})`;
/** Words between "silent" and "video": "a silent 30-second vertical video". */
const VIDEO_WORDS = String.raw`(?:\d[\w.:-]*|(?:[a-z]+-)?(?:second|minute)s?|short|vertical|horizontal|square|standard|landscape|portrait|review|demo|quick|dark|light|walkthrough)`;
const KO_OFF = String.raw`(?:없이|없는(?=\s*(?:영상|버전|비디오|동영상))|없게|빼고|빼서|빼\s*줘|빼\s*주세요|꺼\s*줘|꺼\s*주세요|끄고|꺼서)`;
/** What follows a CJK sound request: an ending, the video, a request verb, or another request. */
const KO_NEXT = String.raw`(?=\s*(?:$|[.,!?;:)，。！？；、]|만들|해|부탁|줘|주세요|주실|영상|버전|비디오|동영상|숏폼|쇼츠|릴스|\d|세로|가로|정사각|짧|길|가능|되|돼|좋|원|하고|음악|효과음|소리|내레이션|나레이션|자막|bgm|배경))`;
const JA_NEXT = String.raw`(?=\s*(?:$|[.,!?;:)，。！？；、]|で(?!\s*(?:起動|再生|録|保存|開))|の(?:ショート|縦|横)?(?:動画|ビデオ|バージョン)|にして|版|バージョン|動画|ビデオ|お願い|ください|ほしい|欲しい|作って|\d|縦|横|ショート|音楽|効果音|ナレーション|字幕|bgm))`;
const ZH_NEXT = String.raw`(?=\s*(?:$|[.,!?;:)，。！？；、]|的?(?:短视频|竖屏视频|横屏视频|视频|版本|版)|和|也|吧))`;
const ZH_START = String.raw`(?<=(?:^|[,，;；。:：])\s*)`;
const EFFECTS = String.raw`(?:sound\s*(?:effects?|fx)|sfx)`;

/**
 * Where a request to silence the video starts: an English clause, optionally after "can you",
 * "please", or "I want", and optionally with its request verb ("make a silent video"). A wrong
 * "silent" costs the narration, so nothing later in a clause anchors it.
 */
const CLAUSE_OPENING = String.raw`(?:^|[,;:(]|\b(?:and|but|please|also|then)\b)\s*(?:(?:can|could|would|will)\s+you\s+|please\s+|i\s+(?:want|need|would\s+like|'d\s+like)\s+(?:you\s+to\s+)?)?`;
const ASK_START = `(?<=${CLAUSE_OPENING})`;
const VERB_AT_START = String.raw`(?<=${CLAUSE_OPENING}(?:(?:make|create|render|give|produce|generate|do)\s+(?:me\s+|us\s+)?)?)`;

/** No sound at all. "muted" alone is not enough: "a muted palette" is about color. */
const SILENT = anyOf(
  String.raw`${VERB_AT_START}(?:(?:a|an)\s+)?silent[\s,]+(?:${VIDEO_WORDS}[\s,]+){0,3}(?:video|version|cut|render|clip|one)\b`,
  String.raw`${ASK_START}(?:make|keep|render|leave)\s+(?:it|this|the\s+video)\s+(?:completely\s+|fully\s+)?(?:silent|muted)\b`,
  String.raw`(?<=(?:^|[,;(]|\band\b)\s*)silent${ENDS}`,
  String.raw`${ASK_START}(?:mute\s+(?:the\s+|this\s+)?video|(?:a\s+)?muted\s+video)\b${ENDS}`,
  String.raw`(?:${ASK_START}|(?<=\bvideo\s+(?:with\s+)?))(?:no|without)\s+(?:any\s+)?(?:audio|sound)\b(?!\s*(?:effects?|fx)\b)(?:\s+at\s+all)?${ENDS}`,
  String.raw`${ASK_START}(?:turn|switch)\s+off\s+(?:all\s+(?:the\s+)?|the\s+)?(?:audio|sound)\b(?!\s*(?:effects?|fx)\b)${ENDS}`,
  String.raw`무음\s*처리\s*해|무음(?=\s*(?:으로|영상|버전|비디오|동영상|$|[.,!?，。]))|소리\s*${KO_OFF}${KO_NEXT}`,
  `無音${JA_NEXT}`,
  String.raw`(?:静音|无声)${ZH_NEXT}|(?<=(?:做成|改成|变成|设为|设成|弄成)\s*)(?:静音|无声)|(?:无|不要|没有|去掉)\s*声音(?!\s*效果)${ZH_NEXT}`,
);

/** No sound effects, the rest unchanged. */
const EFFECTS_OFF = anyOf(
  String.raw`${ASKED}(?:no|without)\s+(?:any\s+)?${EFFECTS}\b${ENDS}`,
  String.raw`${AT_START}(?:${EFFECTS}\s+off|(?:turn|switch)\s+off\s+(?:the\s+)?${EFFECTS}|mute\s+(?:the\s+)?${EFFECTS})\b${ENDS}`,
  String.raw`효과음\s*(?:은|는)?\s*${KO_OFF}${KO_NEXT}`,
  String.raw`効果音\s*(?:は)?\s*(?:なし|無し|不要|いらない|を?消して|を?オフにして)${JA_NEXT}`,
  String.raw`(?:无|不要|没有|去掉|关闭|关掉|不加)\s*(?:音效|声音效果)${ZH_NEXT}`,
);

const MUSIC_NONE = anyOf(
  String.raw`${ASKED}(?:no|without)\s+(?:any\s+)?(?:background\s+)?(?:music|bgm|soundtrack)\b${ENDS}`,
  String.raw`${AT_START}(?:(?:music|bgm)\s+off|(?:turn|switch)\s+off\s+(?:the\s+)?(?:background\s+)?(?:music|bgm)|(?:turn|switch)\s+(?:the\s+)?(?:background\s+)?(?:music|bgm)\s+off)\b${ENDS}`,
  String.raw`(?:음악|배경\s*음악|배경음|bgm)\s*(?:은|는)?\s*${KO_OFF}${KO_NEXT}`,
  String.raw`(?:音楽|bgm)\s*(?:は)?\s*(?:なし|無し|不要|いらない)${JA_NEXT}`,
  String.raw`(?:不要|无|没有|去掉|不加|关闭|关掉)\s*(?:背景\s*)?(?:音乐|bgm)${ZH_NEXT}`,
);

/**
 * A score written for the video: an imperative, or original music asked for by name. 해 주는
 * and してくれる ("that composes") describe a feature, so the request ending excludes them.
 */
const MUSIC_COMPOSE = anyOf(
  String.raw`(?:${AT_START}|(?<=\b(?:you|you\s+to|please)\s+))compose\s+(?:(?:a|an|the|some|new|original|custom)\s+)*(?:music|score|soundtrack)\b${ENDS}`,
  String.raw`(?:${AT_START}|(?<=\b(?:you|please)\s+))compose\s+(?:it\s+)?for\s+(?:this|the)\s+video\b`,
  String.raw`${ASKED}(?:with|use|using|add)\s+(?:an?\s+)?(?:composed|custom|original)\s+(?:music|score|soundtrack)\b${ENDS}`,
  String.raw`(?:${AT_START}|${AFTER_VERB})(?:an?\s+)?(?:original|custom)\s+(?:music|score|soundtrack)\b${ENDS}`,
  String.raw`작곡\s*(?:을|도|은)?\s*(?:해(?!\s*(?:주는|준|줄|둔|놓은|본|보는))|부탁)|(?:영상|비디오)에\s*맞(?:춰|게|춘)\s*(?:새로\s*)?작곡`,
  String.raw`作曲\s*(?:を|も)?\s*(?:して(?=\s*(?:$|[、。,.!！?？]|ください|ほしい|欲しい|もらえ|頂け|いただけ|動画|ビデオ))|お願い|頼)|(?:動画|ビデオ)\s*(?:のため(?:に)?|に合わせて)\s*作曲`,
  String.raw`(?:用|配|加|要|来|写)\s*(?:上|一段|一首|一些)?\s*原创\s*(?:音乐|配乐)${ZH_NEXT}|${ZH_START}原创\s*(?:音乐|配乐)${ZH_NEXT}`,
  String.raw`为\s*(?:这个|该|此)?\s*(?:视频|影片)\s*(?:作曲|谱曲|配乐)|(?:作曲|谱曲|写)\s*(?:一段|一首)\s*(?:配乐|音乐|曲子)${ZH_NEXT}`,
);

/** Music, without saying which: the theme. */
const MUSIC_THEME = anyOf(
  String.raw`${ASKED}(?:with|add|use|include|play)\s+(?:(?:some|the|a)\s+)?(?:background\s+)?(?:music|bgm)\b${ENDS_CLAUSE}`,
  String.raw`${AT_START}(?:background\s+music|bgm)\b${ENDS_CLAUSE}`,
  String.raw`(?:음악|배경\s*음악|배경음|bgm)\s*(?:을|를|도|은|는)?\s*(?:넣어(?!\s*(?:주는|준|둔|놓은))|넣고|깔아|깔고|추가해|포함해|켜\s*(?:줘|주세요|고|서))`,
  String.raw`(?:音楽|bgm)\s*(?:付き|つき|あり|入り|を入れて|をつけて|を付けて)${JA_NEXT}`,
  String.raw`背景音乐${ZH_NEXT}|(?:加|配|带)上?\s*(?:背景)?\s*(?:音乐|bgm)${ZH_NEXT}`,
);

/*
 * Words that make a phrase part of the change's description: bugs, fixes, failures, conditions,
 * features, and the pull request itself. English and Chinese name them before a phrase ("the fix
 * for no music", "修复…无声"); Korean, Japanese, and Chinese after it, where the phrase modifies
 * what follows ("무음으로 재생되는 버그", "無音の動画を検出する処理", "没有声音的问题").
 */
const TOPIC_EN = String.raw`\b(?:about|bugs?|fix(?:es|ed|ing)?|issues?|crash(?:es|ed|ing)?|errors?|fail(?:s|ed|ing|ures?)?|broken|regressions?|when(?:ever)?|if|while|after|until|there\s+is|there's|lets?|allows?|users?|features?|apps?|buttons?|toggles?|settings?|players?|supports?|librar(?:y|ies)|playlists?|notifications?)\b`;
const TOPIC_PR = String.raw`\bprs?\b|pull\s*requests?|merge\s*requests?|\bmrs?\b|\bcommits?\b|\bdiffs?\b`;
const TOPIC_KO =
  '버그|수정|문제|오류|에러|크래시|고장|실패|기능|버튼|설정|모드|앱|사용자|유저|지원|때|경우|하면|되면|재생|처리|상태|현상|커밋|변경|머지|화면|저장|편집|템플릿|파일|목록|클립|구간|감지|로직|삭제|추가|정리|필터|녹음|녹화|검출';
const TOPIC_JA =
  '不具合|修正|バグ|問題|エラー|クラッシュ|障害|失敗|機能|ボタン|設定|モード|アプリ|ユーザー|対応|再生|状態|時|とき|場合|すると|したら|すれば|プルリク|コミット|変更|マージ|画面|保存|編集|テンプレート|ファイル|一覧|クリップ|区間|検出|処理|削除|追加|除外|録音|録画';
const TOPIC_ZH = String.raw`修复|问题|错误|故障|崩溃|失败|(?<=[\u4e00-\u9fff])bug|bug(?=[\u4e00-\u9fff])|功能|按钮|设置|模式|应用|用户|支持|播放|状态|情况|时(?![长间])|如果|的话|之后|以后|改动|提交|合并请求|拉取请求|变更|检测|片段|字幕|剪辑|编辑|模板|文件|列表|删除|添加|过滤|录音|录制|推荐`;
/** More of what a change does, which only "silent" is strict enough to need. */
const TOPIC_MORE = String.raw`\b(?:changes?|export(?:s|ed|er|ers|ing)?|upload(?:s|ed|er|ers|ing)?|thumbnails?|previews?|autoplay|we|our|now)\b|옵션|썸네일|업로드|자동\s*재생|내보내|있게|있도록|하도록|바꾼|바뀐|생성|(?<=\s)시(?=\s)|件|書き出|サムネイル|ように|自動再生|エクスポート|アップロード|プレビュー|生成|オプション|缩略图|导出|让|自动播放|上传|预览|选项`;
const TOPIC_BEFORE = new RegExp(`${TOPIC_EN}|${TOPIC_ZH}`);
/** Every topic word, on either side: "silent" next to any of them keeps the narration. */
const TOPIC_ANY = new RegExp(
  `${TOPIC_EN}|${TOPIC_PR}|${TOPIC_KO}|${TOPIC_JA}|${TOPIC_ZH}|${TOPIC_MORE}`,
);
const TOPIC_AFTER = new RegExp(`${TOPIC_PR}|${TOPIC_KO}|${TOPIC_JA}|${TOPIC_ZH}`);
const CLAUSE_BREAK = /[.;!?,，。；！？、]/;
/** Quoted text names something, such as a PR title ("Mute the video on focus loss"). */
const QUOTED = /"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』|(?<!\w)'[^'\n]*'(?!\w)/g;

/** Whether the phrase at `index` sits in a clause about the change rather than in a request. */
function aboutTheChange(t: string, index: number, length: number, strict: boolean): boolean {
  let start = index;
  while (start > 0 && !CLAUSE_BREAK.test(t[start - 1]!)) start--;
  let end = index + length;
  while (end < t.length && !CLAUSE_BREAK.test(t[end]!)) end++;
  const before = t.slice(start, index);
  const after = t.slice(index + length, end);
  if (strict) return TOPIC_ANY.test(before) || TOPIC_ANY.test(after);
  return TOPIC_BEFORE.test(before) || TOPIC_AFTER.test(after);
}

type Matcher = (t: string) => string | undefined;

/**
 * The first phrase `re` finds that asks for something, skipping clauses about the change. With
 * `strict`, a topic word on either side of the phrase, in any language, rules it out.
 */
const requested =
  (re: RegExp, strict = false): Matcher =>
  (t) => {
    for (const m of t.matchAll(re))
      if (!aboutTheChange(t, m.index ?? 0, m[0].length, strict)) return m[0].trim();
    return undefined;
  };

/**
 * Reads video intent from natural language so "Make a 30-second vertical review video" (or
 * "30초 세로 영상", "30秒の縦動画", "30秒竖屏视频") needs no follow-up questions. Only unambiguous
 * phrases are interpreted.
 */
export function parseVideoRequest(text: string): ParsedRequest {
  const lowered = ` ${text.toLowerCase()} `;
  const t = lowered.replace(/[“”"「」]/g, ' ');
  // Sound requests are read without quoted text: a quoted PR title names something, never asks.
  const unquoted = lowered.replace(QUOTED, (q) => ' '.repeat(q.length)).replace(/[“”"「」]/g, ' ');
  const request: VideoRequest = {};
  const inferred: Record<string, string> = {};
  const hit = (p: RegExp | Matcher) =>
    typeof p === 'function' ? p(unquoted) : p.exec(t)?.[0]?.trim();

  const size = /(\d{3,4})\s*[x×]\s*(\d{3,4})/.exec(t);
  if (size) {
    request.width = Number(size[1]);
    request.height = Number(size[2]);
    request.mode = 'custom';
    inferred.mode = `size "${size[0]}"`;
  }
  /** Applies the first pattern that matches and records which phrase implied the field. */
  const firstHit = (
    field: string,
    patterns: Array<[RegExp | Matcher, (r: VideoRequest) => void]>,
  ) => {
    for (const [re, apply] of patterns) {
      const phrase = hit(re);
      if (!phrase) continue;
      apply(request);
      inferred[field] = `"${phrase}"`;
      return;
    }
  };
  if (!request.mode) {
    firstHit('mode', [
      [
        /\b(vertical|portrait|9:16|9x16|short[- ]form|shorts|reels?|tiktok|mobile)\b|세로|숏폼|쇼츠|릴스|縦|ショート動画|リール|竖屏|竖版|竖向|短视频/,
        (r) => {
          r.mode = 'short';
        },
      ],
      [
        /\b(horizontal|landscape|16:9|16x9|widescreen|standard|full[- ]length|walkthrough|in[- ]depth)\b|가로|와이드|横長|横向き|横型|横屏|横版|横向|宽屏/,
        (r) => {
          r.mode = 'standard';
        },
      ],
      [
        /\b(square|1:1)\b|정사각|正方形|方形/,
        (r) => {
          r.mode = 'custom';
          r.width = 1080;
          r.height = 1080;
        },
      ],
    ]);
  }

  const secs = /(\d{1,3}(?:\.\d+)?)\s*[- ]?\s*(seconds?|secs?|s|minutes?|mins?|m)\b/.exec(t);
  // 30초, 1분 30초, 30秒, 1分半, 1分钟30秒, 2分钟.
  const cjk =
    /(?:(\d{1,3})\s*(?:분|分钟|分)\s*(반|半)?\s*)?(?:(\d{1,3}(?:\.\d+)?)\s*(?:초|秒钟|秒))?/g;
  const cjkHit = [...t.matchAll(cjk)].find((m) => m[1] || m[3]);
  if (cjkHit && !secs) {
    const minutes = Number(cjkHit[1] ?? 0) + (cjkHit[2] ? 0.5 : 0);
    request.duration = minutes * 60 + Number(cjkHit[3] ?? 0);
    inferred.duration = `"${cjkHit[0].trim()}"`;
  } else if (secs) {
    const value = Number(secs[1]);
    request.duration = /^m/.test(secs[2]!) ? value * 60 : value;
    inferred.duration = `"${secs[0].trim()}"`;
  } else {
    for (const [word, value] of Object.entries(NUMBER_WORDS)) {
      if (
        new RegExp(`\\b${word}[- ]?(second|minute|sec|min)`).test(t) ||
        (word.includes('minute') && t.includes(` ${word} `))
      ) {
        request.duration = value;
        inferred.duration = `"${word}"`;
        break;
      }
    }
  }
  if (typeof request.duration === 'number' && !request.mode) {
    request.mode = request.duration <= 45 ? 'short' : 'standard';
    inferred.mode = `${request.duration}s suggests ${request.mode === 'short' ? 'short-form' : 'a standard review'}`;
  }
  // "Silent" means no sound at all: narration, music, and sound effects. "No narration" and
  // "without voiceover" mean the voice alone.
  firstHit('narration', [
    [
      requested(SILENT, true),
      (r) => {
        r.narration = false;
        r.music = 'none';
        r.soundEffects = false;
      },
    ],
    [
      /\b(?:no|without)\s+(?:narration|narrator|voice(?:over)?)\b|\bmute[d]?\s+(?:narration|voice(?:over)?)\b|(?:내레이션|나레이션|음성)\s*(?:없|빼|끄)|(?:ナレーション|音声)\s*(?:なし|無し|不要|なしで)|(?:无|不要|没有|去掉)\s*(?:旁白|配音|语音)/,
      (r) => {
        r.narration = false;
      },
    ],
    [
      /\b(narrat\w*|voice(over)?)\b|내레이션|나레이션|ナレーション|旁白|配音/,
      (r) => {
        r.narration = true;
      },
    ],
  ]);
  if (inferred.narration && request.music === 'none') {
    inferred.music = inferred.narration;
    inferred.soundEffects = inferred.narration;
  }
  firstHit('soundEffects', [
    [
      requested(EFFECTS_OFF),
      (r) => {
        r.soundEffects = false;
      },
    ],
  ]);
  // A phrase about music is more specific than "silent", so it decides the music.
  firstHit('music', [
    [
      requested(MUSIC_NONE),
      (r) => {
        r.music = 'none';
      },
    ],
    [
      requested(MUSIC_COMPOSE),
      (r) => {
        r.music = 'compose';
      },
    ],
    [
      requested(MUSIC_THEME),
      (r) => {
        r.music = 'theme';
      },
    ],
  ]);
  firstHit('captions', [
    [
      /\b(no|without)\s+(captions|subtitles)\b|자막\s*(?:없|빼|끄)|字幕\s*(?:なし|無し|不要)|(?:无|不要|没有|去掉)\s*字幕/,
      (r) => {
        r.captions = false;
      },
    ],
  ]);
  firstHit('theme', [
    [
      /\bdark( mode| theme)?\b|다크|어두운|ダーク|深色|暗色|暗黑/,
      (r) => {
        r.theme = 'dark';
      },
    ],
    [
      /\blight( mode| theme)\b|라이트\s*(?:모드|테마)|밝은|ライト(?:モード|テーマ)|浅色|亮色/,
      (r) => {
        r.theme = 'light';
      },
    ],
  ]);
  const named = requestedLanguage(t);
  if (named) {
    request.language = named.language;
    inferred.language = `"${named.phrase}"`;
  }
  return { request, inferred };
}

/** Resolves config + explicit request into a concrete spec (no questions asked). */
export function resolveVideoSpec(config: CoviConfig, request: VideoRequest = {}): VideoSpec {
  const v = config.video;
  const mode = request.mode ?? v.mode;
  const preset = mode === 'custom' ? undefined : MODE_PRESETS[mode];
  let width = request.width ?? v.width ?? preset?.width;
  let height = request.height ?? v.height ?? preset?.height;
  if (mode === 'custom' && (!width || !height)) {
    // Custom without a size: keep whatever was given and fill the other side to 16:9.
    width ??= height ? Math.round((height * 16) / 9) : 1920;
    height ??= Math.round((width * 9) / 16);
  }
  width = even(width ?? 1080);
  height = even(height ?? 1920);

  const requested = request.duration ?? v.duration;
  const base = MODE_PRESETS[timingPreset({ mode, width, height })];
  let duration: VideoSpec['duration'];
  if (requested === 'auto') {
    duration = { target: base.target, min: base.min, max: base.max, auto: true };
  } else {
    const target = Math.max(5, Math.min(600, requested));
    const slack = Math.max(2, target * 0.15);
    duration = { target, min: Math.max(4, target - slack), max: target + slack, auto: false };
  }

  const setting = request.musicPlacement ?? v.music.placement ?? 'auto';
  // `auto`: the kind of video decides, with the same mapping the timing presets use.
  const placement: MusicPlacement =
    setting !== 'auto'
      ? setting
      : (request.narration ?? v.narration.enabled) && base === MODE_PRESETS.standard
        ? 'bookends'
        : 'continuous';
  return {
    mode,
    width,
    height,
    fps: v.fps,
    duration,
    narration: {
      enabled: request.narration ?? v.narration.enabled,
      provider: v.narration.provider,
      voice: v.narration.voice,
      rate: v.narration.rate,
    },
    captions: request.captions ?? v.captions,
    style:
      request.style ??
      v.style ??
      preset?.style ??
      (duration.target > 45 ? 'explanatory' : 'concise'),
    theme: request.theme ?? v.theme,
    mascot: v.mascot,
    ...(request.language ? { language: request.language } : {}),
    music: { use: request.music ?? v.music.use, placement, setting },
    soundEffects: request.soundEffects ?? v.soundEffects.enabled,
    outro: request.outro ?? v.outro ?? true,
  };
}

/** The request that reproduces a spec (used to re-render a drafted video with the same settings). */
export function requestFromSpec(spec: VideoSpec): VideoRequest {
  return {
    mode: spec.mode,
    width: spec.width,
    height: spec.height,
    duration: spec.duration.auto ? 'auto' : spec.duration.target,
    narration: spec.narration.enabled,
    captions: spec.captions,
    theme: spec.theme,
    style: spec.style,
    ...(spec.language ? { language: spec.language } : {}),
    // Specs saved by older runs (video/decision.json) have no sound fields, no placement setting
    // (configuration decides it now), and no outro.
    ...(spec.music
      ? {
          music: spec.music.use,
          ...(spec.music.setting ? { musicPlacement: spec.music.setting } : {}),
        }
      : {}),
    ...(spec.soundEffects === undefined ? {} : { soundEffects: spec.soundEffects }),
    ...(spec.outro === undefined ? {} : { outro: spec.outro }),
  };
}

/**
 * The spec for re-rendering: what was chosen when the storyboard was drafted, with the new
 * request on top. Choosing a different mode resets the size, length, and style that came with it.
 */
export function respecVideo(
  config: CoviConfig,
  saved: VideoSpec | undefined,
  request: VideoRequest,
  /** Config keys set explicitly for this command (flags, COVI_*): those win over the saved spec. */
  explicit: ReadonlySet<string> = new Set(),
): VideoSpec {
  if (!saved) return resolveVideoSpec(config, request);
  const given = (key: string) => [...explicit].some((k) => k === key || k.startsWith(`${key}.`));
  const { width, height, duration, style, ...rest } = requestFromSpec(saved);
  // Sound and outro settings made for this command (a flag or COVI_*) win over the drafted ones.
  if (given('video.music.use')) delete rest.music;
  if (given('video.music.placement')) delete rest.musicPlacement;
  if (given('video.soundEffects')) delete rest.soundEffects;
  if (given('video.outro')) delete rest.outro;
  const base =
    request.mode && request.mode !== saved.mode
      ? rest
      : { ...rest, width, height, duration, style };
  const spec = resolveVideoSpec(config, { ...base, ...request });
  // The frame rate and voice are not part of a request; keep them as drafted unless set now.
  if (!given('video.fps')) spec.fps = saved.fps;
  if (!given('video.narration'))
    spec.narration = {
      ...spec.narration,
      provider: saved.narration.provider,
      voice: saved.narration.voice,
      rate: saved.narration.rate,
    };
  return spec;
}

function even(n: number): number {
  // H.264 with yuv420p needs even dimensions.
  return Math.max(2, Math.round(n / 2) * 2);
}

export interface VideoQuestion {
  id: 'mode' | 'duration' | 'size' | 'music';
  question: string;
  header: string;
  options: Array<{ value: string; label: string; description: string }>;
}

export interface VideoPlan {
  spec: VideoSpec;
  inferred: Record<string, string>;
  /** Fields nobody specified (request, flags, or repository config). */
  missing: Array<'mode' | 'duration' | 'size' | 'music'>;
  /** Minimal, intention-oriented questions an interactive agent may ask. Empty in CI. */
  questions: VideoQuestion[];
  /** A size is known (request, flags, or configuration), so choosing Custom needs no size question. */
  sizeKnown: boolean;
}

/** What the music question knows about the video: what else it has, and where music would play. */
export interface MusicQuestionContext {
  narration: boolean;
  soundEffects: boolean;
  /**
   * Where music would play; undefined while the kind of video is still being asked and the kind
   * decides (the placement is `auto`).
   */
  placement?: MusicPlacement;
}

/** The questions in a language (English by default, as the constants below). */
export function videoQuestion(
  id: VideoQuestion['id'],
  language: Language = 'en',
  /** For the music question: what else the video has, and where the music would play. */
  sound: MusicQuestionContext = { narration: true, soundEffects: true },
): VideoQuestion {
  const say = (key: string, params?: Record<string, string>) =>
    t(language, `question.${id}.${key}`, params);
  if (id === 'music') {
    const rest = sound.narration
      ? sound.soundEffects
        ? 'noneDescription'
        : 'noneDescriptionNoEffects'
      : sound.soundEffects
        ? 'noneDescriptionNoNarration'
        : 'noneDescriptionSilent';
    // Say where the music plays: under bookends a standard review hears it mostly around the
    // narration, which is worth knowing before choosing to compose.
    const where = !sound.narration ? 'throughout' : (sound.placement ?? 'byMode');
    return {
      id,
      header: say('header'),
      question: say('question'),
      options: (['theme', 'compose', 'none'] as const).map((value) => ({
        value,
        label: say(value),
        description:
          value === 'none'
            ? say(rest)
            : say(`where.${where}`, { what: say(`${value}Description`) }),
      })),
    };
  }
  if (id === 'mode')
    return {
      id,
      header: say('header'),
      question: say('question'),
      options: (['short', 'standard', 'custom'] as const).map((value) => ({
        value,
        label: say(value),
        description: say(`${value}Description`),
      })),
    };
  if (id === 'duration')
    return {
      id,
      header: say('header'),
      question: say('question'),
      options: (['15', '30', '60', 'auto'] as const).map((value) => {
        const key = value === 'auto' ? 'auto' : `s${value}`;
        return { value, label: say(key), description: say(`${key}Description`) };
      }),
    };
  return {
    id,
    header: say('header'),
    question: say('question'),
    options: (
      [
        ['1080x1920', '1080×1920', 'vertical'],
        ['1920x1080', '1920×1080', 'landscape'],
        ['1080x1080', '1080×1080', 'square'],
      ] as const
    ).map(([value, label, key]) => ({ value, label, description: say(key) })),
  };
}

export const MODE_QUESTION: VideoQuestion = {
  id: 'mode',
  header: 'Video type',
  question: 'What kind of video should Covi create?',
  options: [
    {
      value: 'short',
      label: 'Short-form',
      description: 'Vertical 9:16, about 30 seconds, concise',
    },
    {
      value: 'standard',
      label: 'Standard review',
      description: '16:9, 60–120 seconds, more explanatory',
    },
    { value: 'custom', label: 'Custom', description: 'Choose the size, length, and narration' },
  ],
};

export const DURATION_QUESTION: VideoQuestion = {
  id: 'duration',
  header: 'Length',
  question: 'How long?',
  options: [
    { value: '15', label: '~15 sec', description: 'Just the key moment' },
    { value: '30', label: '~30 sec', description: 'The change and one review note' },
    { value: '60', label: '~60 sec', description: 'Room to explain why it matters' },
    { value: 'auto', label: 'Let Covi decide', description: 'Fit the length to the change' },
  ],
};

export const SIZE_QUESTION: VideoQuestion = {
  id: 'size',
  header: 'Size',
  question: 'Which size should the custom video be?',
  options: [
    { value: '1080x1920', label: '1080×1920', description: 'Vertical' },
    { value: '1920x1080', label: '1920×1080', description: 'Landscape' },
    { value: '1080x1080', label: '1080×1080', description: 'Square' },
  ],
};

/**
 * Plans a video from a natural-language request plus explicit flags. `provided` names the fields
 * that came from flags or repository config, so they never trigger questions.
 */
export function planVideo(
  config: CoviConfig,
  options: {
    text?: string;
    explicit?: VideoRequest;
    provided?: Iterable<string>;
    interactive: boolean;
    /** The language to ask in: the run's, unless the request itself is written in another. */
    language?: Language;
  },
): VideoPlan {
  const parsed = options.text ? parseVideoRequest(options.text) : { request: {}, inferred: {} };
  const written = options.text ? detectLanguage(options.text)?.language : undefined;
  const asking = written && written !== 'en' ? written : (options.language ?? 'en');
  const ask = (id: VideoQuestion['id']) => videoQuestion(id, asking);
  const request: VideoRequest = { ...parsed.request, ...stripUndefined(options.explicit ?? {}) };
  const provided = new Set(options.provided ?? []);
  for (const key of Object.keys(stripUndefined(options.explicit ?? {}))) provided.add(key);
  for (const key of Object.keys(parsed.request)) provided.add(key);

  const missing: VideoPlan['missing'] = [];
  if (!provided.has('mode')) missing.push('mode');
  if (!provided.has('duration')) missing.push('duration');
  const mode = request.mode ?? config.video.mode;
  const sizeKnown = Boolean(
    (request.width && request.height) || (config.video.width && config.video.height),
  );
  if (mode === 'custom' && !sizeKnown) missing.push('size');
  if (!provided.has('music')) missing.push('music');
  const spec = resolveVideoSpec(config, request);

  // Short and standard imply a length; a custom size does not, so its length is worth asking.
  const questions: VideoQuestion[] = [];
  if (options.interactive) {
    if (missing.includes('mode')) questions.push(ask('mode'));
    if (missing.includes('duration') && (missing.includes('mode') || mode === 'custom'))
      questions.push(ask('duration'));
    if (missing.includes('size')) questions.push(ask('size'));
    // Music is worth a question only while Covi is asking anyway; otherwise the default applies
    // and the result says how to change it. While the kind of video is asked too, it may still
    // decide where the music plays.
    if (questions.length && missing.includes('music'))
      questions.push(
        videoQuestion('music', asking, {
          narration: spec.narration.enabled,
          soundEffects: spec.soundEffects,
          placement:
            missing.includes('mode') && spec.music.setting === 'auto'
              ? undefined
              : spec.music.placement,
        }),
      );
  }
  return {
    spec,
    inferred: parsed.inferred,
    missing,
    questions,
    sizeKnown,
  };
}

/** Questions that an answer makes necessary: choosing Custom without a known size needs one. */
export function followUpQuestions(
  plan: Pick<VideoPlan, 'sizeKnown'>,
  answers: Partial<Record<VideoQuestion['id'], string>>,
  asked: Iterable<VideoQuestion['id']>,
  language: Language = 'en',
): VideoQuestion[] {
  const done = new Set(asked);
  return answers.mode === 'custom' && !plan.sizeKnown && !done.has('size')
    ? [videoQuestion('size', language)]
    : [];
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Applies answers to the questions (values from the option lists) to a request. */
export function applyAnswers(
  request: VideoRequest,
  answers: Partial<Record<VideoQuestion['id'], string>>,
): VideoRequest {
  const next = { ...request };
  if (answers.mode) next.mode = answers.mode as VideoMode;
  if (answers.duration)
    next.duration = answers.duration === 'auto' ? 'auto' : parseDuration(answers.duration);
  if (answers.size) {
    const [w, h] = answers.size.split('x').map(Number);
    next.width = w;
    next.height = h;
  }
  if (answers.music) next.music = answers.music as MusicChoice;
  return next;
}
