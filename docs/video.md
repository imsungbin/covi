# Video

This page explains how Covi decides whether a change deserves a review video and how a request becomes a concrete video spec, including which questions get asked and when. It then walks through each pipeline stage and what it writes: storyboard, capture, narration, captions, timeline, the outro, sound, composition, render, and quality checks.

A Covi video explains a change. It is not a screen recording. It follows the review loop (what changed, see it, how it works, what to check) and is built from real captures of the software, real code from the diff, and real findings.

## When Covi makes a video

Covi does not make a video just because it can. `decideVideo` (`packages/video/src/pipeline.ts`) bases the decision on the demonstration assessment that the Understand phase writes to `context.json` → `demonstration`:

| `demonstration.recommendation` | Typical change | Decision |
|---|---|---|
| `video` | New or changed interactions, UI changes of more than 12 lines, API changes Covi can run, CLI changes with configured `demo.commands`, other UI/API/CLI changes, large restructurings across several areas | Render |
| `screenshots` | A small visual-only change (styles or UI, 12 changed lines or fewer) | Decline: a before/after screenshot shows it better |
| `text-only` | Nothing user-visible: refactors, tests, CI, docs, configuration, dependency bumps | Decline: the explanation and review serve reviewers better |

When Covi declines, the result says why. For example, the `refactor-retry-helper` example returns:

```
Nothing user-visible changes: no UI, API, or CLI surface is touched, so a written explanation serves
reviewers better than a demo. The explanation and review cover it better than a video. Pass --force
to render an explainer anyway.
```

Overrides:

| Setting | Effect |
|---|---|
| `covi video --force` | Render regardless of the assessment |
| `covi video --storyboard <file>` | Render the given storyboard regardless of the assessment |
| `video.when: never` (config) | `covi video` and `covi ci` decline, unless `--force` is passed to `covi video` |
| `video.when: always` (config), `covi ci --video always` | `covi video` and `covi ci` render for every change |
| `video.when: auto` (default), `covi ci --video auto` | Follow the assessment |

`covi video` writes its decision, the resolved spec, and the demonstration assessment to `video/decision.json`; `covi render` reads the spec back from there. Producing a video never fails on findings: review gates belong to `covi review` and `covi ci`.

## Modes

| Mode | Flag | Size | Duration when `auto` | Narration style |
|---|---|---|---|---|
| Short-form (default) | `--short` (or `--mode short`) | 1080×1920, 9:16 | target 28 s, up to 35 s (window 20–35 s) | concise |
| Standard review | `--standard` (or `--mode standard`) | 1920×1080, 16:9 | target 80 s, up to 120 s (window 60–120 s) | explanatory |
| Custom | `--custom --width W --height H` (or `--mode custom`) | any size from 240 to 3840 px | the short-form window when vertical or square, the standard window when landscape | concise up to a 45 s target, explanatory above |

Durations:

- `--duration` accepts seconds (`90`), unit forms (`30s`, `1m30s`, `2 minutes`), or `auto`.
- A specific duration becomes a window: the target is clamped to 5–600 s, and the window is the target ± max(2 s, 15%), never below 4 s. For example, `30s` becomes 25.5–34.5 s. The window's maximum is a ceiling; Covi never pads, so a video may end below the window (QC warns only when you asked for the duration).
- In short-form mode, or with a target of 45 s or less, Covi tells the story with the template's short beat list.

Sizes for custom videos:

- Given only one side, Covi fills in the other for a 16:9 frame. Given neither, it uses 1920×1080.
- Odd dimensions are rounded to even numbers, because H.264 with 4:2:0 chroma needs them.

Other spec fields:

- `--fps` (default 30, 10–60)
- `--narration` / `--no-narration`
- `--no-captions`
- `--theme light|dark`
- `--voice`
- `--tts`
- `--music theme|compose|none`, `--music-placement auto|continuous|bookends`, and `--no-sound-effects` (see [Sound](#sound))
- `--no-outro` (and `--outro`): end without the branded outro (see [The outro](#the-outro))
- `video.style` and `video.mascot` in the config

The `video` configuration section:

| Key | Default | Notes |
|---|---|---|
| `video.when` | `auto` | `auto`, `always`, `never` |
| `video.mode` | `short` | `short`, `standard`, `custom` |
| `video.duration` | `auto` | seconds, a duration string, or `auto` |
| `video.width`, `video.height` | — | 240–3840 |
| `video.fps` | `30` | 10–60 |
| `video.narration` | `{ enabled: true, provider: auto, rate: 1 }` | `false` turns narration off. Fields: `enabled`, `provider` (`auto`, `system`, `openai`, `elevenlabs`, `none`), `voice`, and `rate` (0.8–1.3) |
| `video.captions` | `true` | burned-in captions and caption files |
| `video.theme` | `light` | `light`, `dark` |
| `video.style` | — | `concise`, `explanatory`; when unset, the mode decides |
| `video.mascot` | `true` | show the fox narrator |
| `video.music.use` | `theme` | `theme`, `compose`, `none`; see [Sound](#sound) |
| `video.music.placement` | `auto` | where music plays: `auto` (continuous), `continuous`, `bookends`; see [Where the music plays](#where-the-music-plays) |
| `video.soundEffects.enabled` | `true` | subtle sound effects for clicks, reveals, findings, the verdict, and the outro |
| `video.outro` | `true` | end with the branded outro; `false` holds the last scene for 1 s instead |
| `publish.video` | `link` | how CI comments reference the video: `link`, `upload`, `none` |

Environment variables can set the same values: `COVI_VIDEO_MODE`, `COVI_VIDEO_DURATION`, `COVI_NARRATION`, `COVI_TTS_PROVIDER`, `COVI_TTS_VOICE`, `COVI_CAPTIONS`, `COVI_MUSIC`, `COVI_MUSIC_PLACEMENT`, `COVI_SOUND_EFFECTS`, and `COVI_OUTRO`. See [Configuration](configuration.md) for how flags, environment, repository configuration, and defaults combine.

## From a request to a spec

### Reading the request

`covi video --request "<words>"` reads the request in plain language. Covi interprets only phrases that are unambiguous:

| Phrase | Result |
|---|---|
| A size such as `1280x720` or `1080×1080` | custom mode at that size |
| vertical, portrait, 9:16, short-form, shorts, reel, TikTok, mobile | short-form |
| horizontal, landscape, 16:9, widescreen, standard, full-length, walkthrough, in-depth | standard |
| square, 1:1 | custom, 1080×1080 |
| 30-second, 45 s, 2 minutes, 1.5 min, fifteen-second, a minute | duration |
| A duration with no shape word | short-form at 45 s or less, standard above |
| no narration, without voiceover / narrated, voiceover | narration off / on |
| a silent video, make it silent, mute the video, no audio, without sound | no sound at all: narration, music, and effects off |
| no sound effects, without sfx, sound effects off | sound effects off |
| no music, without music, no bgm, music off | no music |
| compose music, compose for this video, original music, an original score | a score composed for this video |
| with music, add background music, bgm | the Covi theme |
| no captions, without subtitles | captions off |
| dark, dark mode / light mode, light theme | theme |
| in Korean, Japanese video, Chinese narration, 한국어로, 日本語で, 用中文 | the video's language (a passing mention such as "the Korean locale" does not count) |

The same fields are read in Korean, Japanese, and Chinese:

| Field | Korean | Japanese | Chinese |
|---|---|---|---|
| Duration | 30초, 1분 30초, 2분 | 30秒, 1分半, 2分 | 30秒, 1分钟30秒, 2分钟 |
| Short-form | 세로, 숏폼, 쇼츠, 릴스 | 縦, ショート動画, リール | 竖屏, 竖版, 短视频 |
| Standard | 가로, 와이드 | 横長, 横向き, 横型 | 横屏, 横版, 宽屏 |
| Square | 정사각 | 正方形 | 正方形, 方形 |
| No narration / narration | 내레이션 없이, 음성 없이 / 내레이션 | ナレーションなし, 音声なし / ナレーション | 无旁白, 无配音 / 旁白, 配音 |
| No sound at all | 무음, 소리 없이 | 無音 | 静音, 无声, 没有声音 |
| No sound effects | 효과음 없이, 효과음 빼고 | 効果音なし | 不要音效, 无音效 |
| No music | 음악 없이, 음악 빼고, BGM 없이 | 音楽なし, BGMなし | 不要音乐, 无音乐, 没有背景音乐 |
| Composed music | 작곡해 줘, 영상에 맞춰 작곡 | 作曲して, この動画のために作曲 | 为这个视频作曲, 配上原创音乐 |
| The theme | 음악 넣어, BGM 넣어 | 音楽付き | 背景音乐, 加上音乐 |
| No captions | 자막 없이 | 字幕なし | 无字幕, 不要字幕 |
| Theme | 다크, 라이트 모드 | ダーク, ライトモード | 深色, 浅色 |

Words that only name what a change is about decide nothing: "a video about the music app", "the fix for no music after resume", "the silent failure in uploads", "작곡을 돕는 기능" (a feature that helps composing), and "无声模式的问题" (a silent-mode problem) leave the sound to configuration. Each phrase must be shaped like a request. In English it follows the start of a clause, the video, or a request verb ("no music, please", "a video with no audio", "make it silent"). In Korean, Japanese, and Chinese it is followed by a request ending, the video, or another sound request ("음악 없이 만들어줘", "無音の動画で", "静音视频"). A phrase whose clause names a bug, a fix, a condition, a feature, or the pull request decides nothing: English and Chinese put those words before the phrase ("the fix for no music"), and Korean, Japanese, and Chinese after it ("무음으로 재생되는 버그"). Quoted text, such as a PR title, decides nothing either. A request for no sound at all is read most strictly, because a wrong guess would cost the narration. In English it has to open its clause ("make it silent", "a silent video", "no audio, please"), or follow "a video with". Any word about the change on either side of it, in any language, keeps the narration on: "make a silent video of the fix" keeps it, while "make a silent video, it's for the fix" turns the sound off. So "make a 30-second video of the login fix, no music" turns the music off, while "make a video of this bug fix without music" leaves it to configuration. Put a sound request in its own clause, or pass `--music` and `--no-sound-effects`. A phrase about music is more specific than "silent", so "a silent video with background music" turns off the narration and the effects but keeps the theme.

Explicit flags override anything inferred from the words. "Make a 30-second vertical review video" resolves completely: short-form, 1080×1920, 25.5–34.5 s.

### Which questions are asked

`planVideo` (`packages/video/src/spec.ts`) decides what is still open. A field counts as decided when it comes from the request, a flag, the environment, or the repository configuration. Built-in defaults do not count. Covi asks only about mode, length, (for custom videos) size, and music:

| Still undecided | Questions |
|---|---|
| Mode and length | Both, together: "What kind of video should Covi create?" (Short-form · Standard review · Custom) and "How long?" (~15 sec · ~30 sec · ~60 sec · Let Covi decide) |
| Only the length, for short-form or standard | None: the mode's `auto` window applies |
| Only the length, for a custom size (for example "a square video") | "How long?": a size implies no length |
| A custom mode without a size | "Which size should the custom video be?" (1080×1920 · 1920×1080 · 1080×1080) |
| Nothing | None |

When Covi asks any of these and nothing decided the music, it adds "What music should the video have?" (Covi theme (default) · Compose for this video · No music). The theme's and the score's descriptions say where the music would play: with narration (continuous, the default) "a quiet bed under the narration, louder before the first line and at the end"; with `bookends` "plays at the opening and the end, and drops out under the narration"; without narration "under the whole video". Music alone never triggers a question: "make a 30-second vertical video" still gets none, the theme plays, and the result carries `video.music.hint` ("Music: Covi theme. To change it, run `covi render --run <id> --music none` or `--music compose`.") in the run's language. At a terminal, "Compose for this video" is offered only when a model provider can write the score. Without narration, "No music" is described as "Subtle sound effects only".

The questions are asked in the language of the request when it is written in Korean, Japanese, or Chinese, else in the run's language (message keys `question.*` in `templates/i18n/`).

Choosing Custom in the mode question leads to the size question, unless a size is already known from the request, flags, or configuration (`followUpQuestions`). At a terminal Covi asks it next; an agent runs the dry run again with `--custom` to get it.

Where questions are asked:

- **At a terminal.** `covi video` asks the questions as numbered prompts on stderr; pressing Enter picks the first option.
- **Never, in non-interactive runs.** That means runs with `--json` or `--yes`, runs with `CI` or `COVI_NONINTERACTIVE` set, and runs without a TTY. Configuration and defaults decide. `covi ci` never asks.
- **Through an agent.** The agent passes the user's words to a dry run, which plans and returns the open questions without rendering:

  ```bash
  covi video --dry-run --request "make a review video" --json
  ```

  The result's `data` contains the resolved `spec`, what was `inferred` and from which phrase, what is `missing`, the `questions` with option values, the `decision`, and the `demonstration` assessment. Trimmed:

  ```json
  {
    "spec": { "mode": "short", "width": 1080, "height": 1920, "fps": 30,
              "duration": { "target": 28, "min": 20, "max": 35, "auto": true }, "...": "..." },
    "inferred": {},
    "missing": ["mode", "duration"],
    "questions": [
      { "id": "mode", "header": "Video type", "question": "What kind of video should Covi create?",
        "options": [{ "value": "short", "label": "Short-form", "description": "Vertical 9:16, about 30 seconds, concise" }, "..."] },
      { "id": "duration", "header": "Length", "question": "How long?", "options": ["..."] }
    ],
    "decision": { "render": true, "reason": "A stylesheet changes, which is best judged by looking at it." }
  }
  ```

  The agent asks with its own question tool, then passes the answers as flags (`--short`, `--standard`, `--custom`, or `--mode <mode>`, plus `--duration`, `--width`, `--height`, and `--music`). `--dry-run --yes` returns no questions. The `covi-video` skill describes this protocol for agents ([Skills](skills.md)).

## The pipeline

`covi video` runs these stages in one run directory (`.covi/runs/<run-id>/`). Each stage writes files that the next reads.

| Stage | What happens | Writes |
|---|---|---|
| Decide | Applies the decision rules above | `video/decision.json` |
| Capture | Runs the software at base and head when a video will be made, the project is runnable, and the change has something to show (the same demonstration as `covi demo`, at desktop and mobile unless `demo.viewports` says otherwise) | `demo/captures.json`, `demo/screenshots/`, `demo/diffs/`, `demo/recordings/`, `demo/traces/`, `demo/behavior-diff.json`, `demo/demo.md` |
| Review | Explains and reviews the change; the story's review note comes from here | `explanation.json`, `review.json`, `review.md`, `summary.md`, … |
| Storyboard | Drafts scenes from the evidence with a storytelling template, or validates the one you supply, then redacts it | `video/storyboard.json` |
| Direction | Checks the run's `video/direction.json` (unless it is still Covi's draft) against the storyboard and the evidence, lays its shots over Covi's default director's, and decides how each scene enters; with `--draft`, writes Covi's direction for the agent to rewrite. Nothing when `video.direction` is `off` | `video/direction.json` (with `--draft`) |
| Narration | Picks the narration language and the voice, rewrites each scene's spoken text for that voice (acronyms spelled out, your pronunciations applied), then synthesizes and measures one take per scene and places them on the voice stem, at −16 LUFS | `video/speech.json`, `video/narration.wav` |
| Timing | Lays scenes out line by line from the measured speech (transitions start just before the next line, the hero holds, narrated standard reviews breathe, the outro ends it) and keeps the video under the duration window's maximum; it never pads | (inside the timeline) |
| Captions | Splits the narration into cues timed to the speech | `video/captions.vtt`, `video/captions.srt` |
| Timeline | Freezes everything the renderer needs: scenes (Covi's outro last; on the canvas, each story scene's stop and resolved shot), timings, captions, mouth movement, the moments that carry a sound (`cues`), theme, the language, and the labels the runtime draws (verdicts, stats, Before/After, the sign-off) in that language | `video/timeline.json`, `video/narration.md` |
| Sound | Picks the music (the theme, the run's score, a model's score, or none), fits it to the timeline, renders it (cached), places the sound effects, and mixes everything under the narration (see [Sound](#sound)) | `video/audio.json`, `video/music.wav`, `video/score.json` |
| Composition | Writes a self-contained HTML page that can draw any frame | `video/composition/` |
| Render | Captures every frame in headless Chromium, encodes H.264, and muxes the mix; or, when only the sound changed, keeps the frames and muxes the new mix | `video/covi-review.mp4`, `video/poster.png`, `video/contact-sheet.jpg`, `video/frames.json` |
| QC | Checks format, duration, audio and the mix, black frames, still pictures under narration, layout, caption timing, the hook and the speech share, and the text the voice was given | `video/qc.json` |

Two failures do not stop the run:

- If the demonstration fails, or the project's commands are not trusted on this machine yet (see [Security](security.md)), the run records a warning, and the story is told with code excerpts, findings, and callouts instead.
- If speech synthesis fails, the video renders with captions only.
- If the music cannot be rendered, the video keeps its voice and sound effects, and QC's `music-fit` says why.

All artifacts are listed with their SHA-256 in `run.json` (see [Artifacts](artifacts.md)).

### Storyboard

The storyboard is the editable script. It lists scenes, each with narration and a visual. Timing is never authored; it is derived from the narration audio.

**Drafting.** `selectTemplate` (`packages/video/src/templates.ts`) picks a storytelling template from the change. The first rule that matches wins:

| Rule | Template |
|---|---|
| intent `bug-fix` or `security` | `bug-fix` |
| a large structural change with nothing to click | `architecture-explainer` |
| mostly visual, no interaction | `before-after` |
| UI or interaction changes | `feature-demo` |
| API behavior changes | `api-change` |
| CLI behavior changes | `cli-change` |
| anything else | `quick-review` |

Override the choice with `--template <id>`.

How beats become scenes:

- **Choosing a visual.** Each beat lists preferred visuals, and the drafter uses the first one the evidence supports:
  - screenshots, before/after pairs, and interaction steps come from captures;
  - terminal and API visuals come from command and request captures;
  - code comes from the diff;
  - findings come from the review.
- **Missing evidence.** Optional beats without evidence are dropped. Required ones fall back to a callout with the explanation's summary, except the template's hero beats: a callout is never the payoff, so a hero beat without evidence is left out.
- **Cold open.** The draft opens on the subject, not on a title card. With a captured page, the title is set over the most-changed after capture (`background`). Without one, the first scene showing code, a command, or a response (the hero only when nothing else does) moves to the front with the title as its eyebrow (cut to at most 32 characters, at a word boundary when it can) and the opening line before its own. When that scene shows the hero's very lines, it is dropped and the hero opens instead, so the lines are shown once. Only a change with none of these keeps its title card. The opening line is the change's intent; the draft never lists what is coming, and no later scene says the intent again: a later line loses that sentence, and a scene with nothing else to say is left out (the hero and the summary always stay).
- **Hero.** The first scene playing one of the template's hero beats is marked `hero: true` and is never optional.
- **Language.** Covi drafts in the run's language, or in a language the request names, and records it as the storyboard's `language`. Narration sentences, headings, eyebrows (each template beat carries them in Korean, Japanese, and Chinese), Before/After labels, and the "… more lines" marker come from the message catalogs; text taken from the change (titles, commit messages, area names, findings) stays as written.
- **Narration budget.** Narration runs at about 2.5 words per second in English, 4.3 syllables per second in Korean, 4 characters per second in Japanese, and 3 in Chinese, scaled from measured voice rates with the same margin English has. It gets 80% of the target duration in short-form and 85% in standard, split by beat weight. The same idea takes more syllables in Korean, Japanese, and Chinese, so a short video says less; when a short video's findings lead does not fit, Covi keeps the finding ("Worth checking: …") instead of the lead.
- **Depth for longer videos.** Standard-length videos say more, and only what the evidence supports:
  - an API scene adds what the captured bodies show, such as a status change or sizes ("The old response listed 5 entries; the new items array holds 2.");
  - a terminal scene adds a changed exit code;
  - a code scene uses the explanation's own description of the file's area;
  - the findings scene names up to three findings with why the first ones matter, and announces only a count it covers;
  - the summary adds "Suggested next step: …" from the top finding when the verdict is not "looks good", or where to start reading the diff when it is.
- **Spoken form.** The `say` field holds the spoken form when it differs from the caption text. Identifiers and file names are spelled out for speech, for example `app.js` becomes "the app script" (in Korean "app 스크립트"), and in Korean, Japanese, and Chinese routes are said segment by segment ("API 슬래시 users").

**Model refinement.** If a model provider is configured (`intelligence.provider: anthropic` or `command`, or `auto` with an Anthropic key or a trusted `intelligence.command`), it rewrites the drafted narration within each scene's budget, following the `covi-video` methodology: the draft's length plus a margin, at most one 15-word line (six seconds of speech: 26 syllables in Korean, 24 characters in Japanese, 18 in Chinese), and a total no larger than those lines hold or the target length allows. A rewritten line that runs more than a quarter past its budget (and past its draft) or breaks its `[[…]]` markup keeps the draft. The prompt is redacted before it is sent. Visuals stay as drafted, because they are grounded in captured evidence. If refinement fails, Covi keeps the draft and records a warning.

**Redaction.** Every storyboard, drafted or supplied, passes through the `Redactor` before narration, captions, the timeline, or the composition are made from it, so a secret in a code excerpt or command output does not reach the audio or the frames. Screenshots are images of the running software and are shown as captured.

**Format.** Run `covi schema storyboard` for the full JSON Schema. Top level: `title`, `template`, `draft` (true for Covi's draft), `language` (optional: `en`, `ko`, `ja`, or `zh`; see [Narration language](#narration-language)), and `scenes`, 2–24 of them. Each scene:

| Field | Meaning |
|---|---|
| `id` | Optional (`s1`, `s2`, … by default), and each scene's own: timing, entrances, and direction find a scene by it |
| `beat` | The template beat this scene plays |
| `eyebrow`, `heading` | Section label (up to 40 characters) and heading (up to 90) |
| `narration` | What Covi says, also used for captions (up to 600 characters). `[[…]]` marks its key phrase (at most one), which the caption sweeps as it is spoken; the voice, reports, and subtitle files get the text without the brackets |
| `say` | Spoken form, when it differs from the caption text. Covi still normalizes it before synthesis (see [Spoken form](#spoken-form)) |
| `visual` | One of the kinds below |
| `expression` | Narrator expression: `neutral`, `explaining` (default), `thinking`, `reviewing`, `warning`, `success` |
| `minSeconds` | Overrides the visual's minimum time on screen (1–30) |
| `optional` | May be dropped to fit the duration (never the hero) |
| `sync` | Pins moments of the visual to phrases of `narration`: a phase name → a phrase that appears exactly once (see [Timing](#timing)) |
| `transition` | How the scene enters: `fade`, `cut`, `push`, `wipe`, or `zoom-through`. Without one, Covi picks the entrance on the canvas (see [Direction and the canvas](#direction-and-the-canvas)); with `video.direction: off`, the scene fades in, and the hero zooms through |
| `hero` | The one scene where the change clicks: it holds 0.4 s after its line, enters with the canvas camera's `zoom` (`zoom-through` with `video.direction: off`) unless it sets `transition`, plays the hero accent with a riser into it and a hit on it, and carries the music's lift |
| `camera` | `drift` (default) or `static`: a static scene neither drifts nor pushes in |
| `evidenceIds` | Optional: evidence ids from the run that the scene rests on (see [Evidence](artifacts.md#evidence)). A scene that shows a capture, code from the diff, a request, a command, or findings cites them without listing them; `covi render` exits 2 on an id the run does not have. `video/timeline.json` records each scene's evidence. |
| `cues` | Up to 4 sound effects of the scene's own: `at` (a phase the scene pins, or seconds into the scene) and `kind` (`click`, `reveal`, `finding`, `transition`, and on the hero `riser`, which ends at `at`, or `hero`). See [Sound effects](#sound-effects) |

| Visual `kind` | Shows |
|---|---|
| `title` | Title card with subtitle, eyebrow, and meta chips; with `background` (a capture), the capture fills the media region and the title goes in the header, without the subtitle and meta: a cold open |
| `change-map` | Up to 8 areas with their surfaces and line counts |
| `code` | Up to 40 diff lines (`add`, `del`, `context`), each with an optional `number`, as the diff numbers it: a deleted line's number before the change, an added or unchanged line's after it (Covi's default direction finds the hunk a scene shows by these numbers). `highlight` entries (up to 40) are line indexes, or groups (`{ "lines": [3, 4], "sync": "fix" }`) that light together at a phase. `mode: "morph"` shows the old code, then strikes the deleted lines to ghosts and types the added ones in their place at the `morph` phase. An optional `caption` (up to 160 characters) sits under the code |
| `screenshot` | One capture, with an optional `focus` region to zoom toward, or up to three `marks` (a `focus`, a `label` gloss shown under the frame, a `sync` phase, which may be `hero` on the hero scene) the camera pans between; a `click` point; and a `device` frame |
| `before-after` | Two captures in a `split`, `stack`, or `wipe` layout, with an optional focus region |
| `interaction` | 1–8 flow steps, each with a capture, click point, focus or up to three marks, and label |
| `terminal` | A command with its output, and optionally the base revision's output |
| `api` | A request with the base and head status and body, highlighted in colors that stay readable on the light cards |
| `findings` | 1–3 findings with certainty, severity, and location |
| `callout` | An `info`, `warning`, or `success` card |
| `diagram` | 2–8 nodes (marked changed or not) and up to 16 edges, each with an optional label (up to 40 characters) drawn on its line |
| `summary` | Verdict, headline, up to 4 points, and change stats |

Image paths are relative to the run directory (for example `demo/screenshots/home-desktop-after.png`) and must resolve inside it, so a storyboard cannot pull other files from the machine into a video. If an image is missing, rendering stops with an error that lists it.

A `focus`, on a screenshot, a before-after, an interaction step, or a mark, is a region in image pixels or a reference to an element of the [subject model](artifacts.md#the-subject-model): `"focus": "subject:home#start-trial"`. Covi places each reference right after it reads the storyboard, before anything is written, at the element's box in the head capture it focuses (the screenshot's or step's `image`, the before-after's `after`), from the run's `demo/subject.json`. `covi subject --run <id>` lists the elements each capture shows. A reference that cannot be placed stops the render with a usage error (exit 2) that names the scene, the reference, and what exists: a screen or element the model does not have, an element outside the capture or not visible in it, a base image, or a run with no `demo/subject.json`. `video/storyboard.json` keeps the references as written, so a render places them again; `video/timeline.json` gets the rects.

Validation also checks what the JSON Schema cannot express, and stops with a usage error (exit 2) that names the scene: two scenes with one id (a scene without an `id` is `s` and its number, so `s2` and an unnamed second scene collide), a `sync` phrase missing from its narration or appearing more than once, a phase the visual does not have, interaction steps synced out of order, `sync.hero` on a scene that is not the hero, a second hero, a second, empty, or unbalanced `[[…]]`, `marks` together with `focus`, two marks sharing a phase or synced out of order, a highlight group or mark naming a phase that `sync` does not define, a cue at a phase the scene does not pin, and a `riser` or `hero` cue off the hero.

The narrator, Covi's fox, appears in the header corner of content scenes. Title cards (without a `background`) and summary cards draw it large instead, and the outro takes the summary's fox over (see [The outro](#the-outro)). See [Visual system](visual-system.md).

### Storytelling templates

Templates are data in `templates/stories/*.yml`. Each one is an ordered list of beats, and each beat has:

- a goal;
- preferred visuals;
- a narrator expression;
- an optional flag.

A template also has a shorter beat list (`short`) for short-form videos. Covi validates templates when it loads them.

| Template | Use when | Beats (short-form beats in bold) |
|---|---|---|
| `bug-fix` | The change fixes incorrect behavior | **context** → **problem** → **fix** → proof → **review** → **summary** |
| `feature-demo` | User-facing UI behavior is added or changed | **context** → before → **interaction** → **implementation** → **review** → **summary** |
| `before-after` | The change is mostly styles or markup | **context** → **compare** → detail → styles → **review** → **summary** |
| `api-change` | HTTP routes, handlers, or response shapes change | **context** → **exchange** → implementation → **review** → **summary** |
| `cli-change` | Command-line behavior or output changes | **context** → **run** → **implementation** → review → **summary** |
| `architecture-explainer` | A large internal restructuring that reviewers need a mental model for | **context** → **map** → core → **review** → **summary** |
| `quick-review` | Nothing more specific fits | **context** → scope → **core** → **review** → **summary** |

```bash
covi templates                 # ids, descriptions, and beats
covi templates show bug-fix    # one template as JSON
```

**Template format:**

- Top-level keys: `id`, `name`, `description`, `use_when`, `beats`, `short` (beat ids, in order), and `hero` (the payoff beats, in priority order: the drafter marks the first scene that plays one of them `hero: true`, and the music lifts on a downbeat there).
- Each beat has an `id`, an `eyebrow` (up to 40 characters), a `goal`, a list of `visuals`, an `expression`, and an `optional` flag.
- A visual is a visual kind (`title`, `change-map`, `code`, `screenshot`, `before-after`, `interaction`, `terminal`, `api`, `findings`, `callout`, `diagram`, `summary`), optionally with `:before` or `:after` for screenshots.

To add a template:

1. Add a YAML file to `templates/stories/`.
2. Give its first beat a `title` visual and its last beat a `summary` visual. The template tests in `tests/examples.test.ts` require both, list the template ids, and draft a storyboard with every template.

The reasoning behind each pattern is in `skills/covi-video/references/storytelling.md`.

### Editing a storyboard before rendering

```bash
covi video --short --duration 30s --draft --json   # capture, review, write video/storyboard.json
# edit .covi/runs/<run-id>/video/storyboard.json
covi render --run latest --json                    # narrate, compose, render, check
```

- `--draft` stops after writing `video/storyboard.json` and, unless `video.direction` is `off`, Covi's `video/direction.json` (see [Direction and the canvas](#direction-and-the-canvas)). The result's `video.reason` says so.
- `covi render` reuses the spec saved in `video/decision.json` when the storyboard was drafted: mode, size, length, style, captions, narration on or off, theme, frame rate, voice, music and its placement, sound effects, and the outro. Flags you pass now (and `COVI_*` variables) change only what they name; a different mode (`--short`, `--standard`, `--custom`, `--mode`) resets the size, length, and style that came with the old one. `video.direction` is not saved: it comes from flags and configuration at each command, so pass `--direction off` again to render without the canvas.
- `covi render` reads `explanation.json`, `review.json`, `demo/captures.json`, and `video/direction.json` from the run.
- `covi render --storyboard <file>` renders a storyboard stored elsewhere. Image paths inside it are still relative to the run directory.
- `covi video --storyboard <file>` skips drafting and renders the given storyboard.
- Re-rendering after an edit only synthesizes the lines that changed; the rest come from the narration cache.

### Direction and the canvas

Evidence decides what a video shows; direction decides how. Every video is drawn on one large canvas. Each story scene sits at its stop, a frame-sized region on a path that runs to the right and turns down after two to four steps, so a row holds three to five stops (a seed from the title picks where, so a different change travels differently); the hero's stop drops half a frame below its row (less when a stop sits right below it), so the camera pulls back to reach it. Two entrances travel the canvas instead of fading: `pan` glides the camera to the next stop (0.7 s), and `zoom` pulls back until both stops show, then pushes into the next (0.9 s); both pictures stay fully opaque while the camera travels. Every other entrance (`push`, `cut`, `wipe`, `fade`, `zoom-through`) draws as in 0.2.0, each scene seen at its own stop, and the outro still fades in. Inside a stop, the push-in and the shot's `camera` beats move the camera.

- **What stays put.** The narrator, the captions, the progress bar, and the hero's flash keep their places in the frame. The header hands over across a move: the old one fades out over the move's first 40%, then the new one comes in, so two headers are never both shown. The narrator eases in or out over a move to or from a scene without it.
- **Clipping.** At rest a stop is drawn whole, as without the canvas. While the camera travels, or a beat magnifies the stop, the picture is clipped to the rows of the scene's region (the media region, or the whole frame for a card without a header) across the frame's full width, so a move or a zoom never covers the header or the captions. A magnified view never shows past the region's edges.
- **One dot grid** lies under the scenes and travels with the camera. Stops sit on its spacing, so at every stop its dots are where the stage's own would be.

`video/direction.json` (optional, `schemaVersion: 1`, `covi schema direction`) directs the video shot by shot. Without one, and for every scene it leaves out, Covi's default director directs the video, so runs in CI or with `--json` move the same way as the ones an agent directs.

```json
{
  "schemaVersion": 1,
  "draft": false,
  "shots": [
    {
      "scene": "s3",
      "enter": "pan",
      "layout": "row",
      "elements": [
        { "id": "req", "kind": "code", "evidence": "diff-hunk:src/request.js:12", "side": "head" },
        { "id": "out", "kind": "output", "evidence": "terminal:1" },
        { "id": "note", "kind": "label", "text": "Ids only", "tone": "success" }
      ],
      "beats": [
        { "verb": "reveal", "element": "note", "style": "pop", "at": "only the ids" },
        { "verb": "camera", "move": "zoom", "to": "req", "at": "the request" }
      ]
    }
  ]
}
```

- **Shots.** At most one per storyboard scene, 24 at most; a scene without one gets the default director's. `scene` names the storyboard scene (`s1`, `s2`, … for a scene without an `id`). `enter` is how the scene enters: `pan` or `zoom`, or any storyboard transition. It shapes the timing exactly like a storyboard `transition`; nothing else in a direction moves a scene in time. `layout`: `auto` (the default), `single`, `row`, `column`, or `split`.
- **Elements** (1–8 a shot; ids are a lowercase letter, then lowercase letters, digits, or dashes, 24 characters at most) take their content only from the run's evidence: `visual` (the scene's storyboard visual, drawn as without direction; a title or summary card only alone and without a reveal, since it draws its own header and fox); `code` (a `diff-hunk:` id, read from the run's `diff.patch`; `side` `head` (the default), `base`, or `diff`; `lines: [from, to]` within the side shown, at most 40; without it, the 14 lines richest in changes, 18 on tall frames); `output` (a `terminal:` id: a demo command's output at `head` or `base`, or the app's start-up log); `capture` (a `screenshot:` id); `morph` (a `diff-hunk:` id: the hunk's code before the change, turning into the code after it on its `morph` beat; see [The token morph](#the-token-morph)); `node` (a short `label`, and up to four evidence ids it stands for); and `label` (`text`, with `tone` `neutral`, `warning`, or `success`). A shot without a `visual` element replaces the storyboard visual for that scene, and the scene's evidence is then the ids it cites itself (`evidenceIds`) plus what its elements cite.
- **Beats** (0–12 a shot): `place` (the element is there from the start: the default, made explicit; it takes no `at`); `reveal` (0.5 s; `style` `rise`, `pop`, `wipe`, or `type`); `camera` (0.8 s; `move` `zoom`, `pan`, or `follow` toward an element; `zoom` 1–2.5, by default fitted); and `morph` (1.6 s: a morph element turns into the code after the change, once; a morph element no beat names morphs anyway, as if the shot ended with a `morph` beat without an `at`). A beat's `at` quotes a phrase of the scene's narration that occurs exactly once, as a `sync` phrase does, and the beat lands as it is spoken; beats without one spread through the line from 15% of it. A camera beat aimed at the visual frames what the visual highlights then (its lines, its focus). `follow` on a morph keeps its changed lines framed at every frame: it holds one scale (its `zoom`, else the one that fits the changed lines at the beat's start and at the scene's end) and moves with them as rows open and close; on anything else it frames its target like `zoom`. A camera beat toward a revealed element, and a morph of one, waits until it is in place.
- **Labels** are the only text the agent writes: 1–32 characters of letters and marks of any script, spaces, `-–—·,.'’:()/&+?!`, and the CJK punctuation `、。・「」『』（）！？：`. No digits (numbers come from evidence), no markup or other symbols, no default-ignorable characters (zero-width joiners, variation selectors, bidi controls), and no links: `://`, a word starting with `www.`, the `javascript:` and `vbscript:` schemes, and `data:` followed directly by text are looked for with the label's combining marks taken off, in its NFKC form, with ideographic full stops read as dots, so neither a mark between two characters nor a full-width look-alike hides one. The check is a heuristic: labels are only ever drawn as text, and numbers spelled as words (or in CJK numerals) cannot be caught in code, so the methodology forbids them. Labels are redacted like the storyboard.
- **Checks.** `covi render` refuses (exit 2) a direction that names a scene the storyboard does not have, gives a scene two shots, uses an element id twice in a shot, aims a beat at an element its shot does not have, cites evidence the run does not have or of the wrong kind, asks for a side or lines the evidence lacks, gives a morph a hunk that cannot morph (see [The token morph](#the-token-morph)), aims a `morph` beat at an element that is not a morph or that an earlier beat already morphs, shows a title or summary card beside other elements, gives a `single` layout more than one element, quotes a phrase that is not in the line exactly once, or breaks a bound, and lists every problem at once. Only a regular file is read, and one over 256 KB is refused before it is read.
- **Drafts.** `covi video --draft` writes Covi's direction beside the storyboard, with `"draft": true`, unless the run already has one the agent wrote. Rewrite it and set `"draft": false`: a direction still marked as Covi's draft is not read for its shots but derived again at render from the storyboard as it is then, so a stale draft never blocks a render.
- **The default director** morphs a code scene that shows changed lines of exactly one hunk, when that hunk can morph: the camera follows its changed lines at 1.25×, and the morph lands on the phrase that lights the scene's highlights, or, without one, as a beat without an `at` does. It finds the hunk by line number, so number a storyboard's deleted lines as before the change and its added lines as after it, as the diff does. A code scene that shows only unchanged lines, or changed lines of no hunk or of several, keeps its visual, and so does one in `mode: "morph"` or with a caption. Every other scene keeps its visual too, a code scene zooms 1.25× toward the lines it highlights as they light, and the director picks every entrance the storyboard left open: the hero (`hero: true`) zooms, a before/after wipes, a scene that shows what the one before it showed cuts, and the rest alternate pan and push. It reads what scenes show, never what they cite, so editing citations never moves a frame.
- **Off.** `video.direction: off` (`--direction off`, `COVI_VIDEO_DIRECTION=off`) draws the video as Covi 0.2.0 did: no canvas, no direction (`video/direction.json` is not read), and the storyboard's own transitions (a fade by default, `zoom-through` into the hero).

#### The token morph

A `morph` element shows a hunk's code before the change and turns it, token by token, into the code after it. Removed tokens tint red and fade; a removed line with nothing to replace it folds away. Added tokens slide in green and settle to their syntax colors over the half second after the morph; an added line opens room for itself. Tokens a replaced line keeps travel from their old place to their new one (Covi pairs a block's deleted and added lines in order, so that the most characters stay, never two lines that share little, and keeps the tokens each pair has in common, in order), and the lines below a change move with it. Before the morph the code reads as plain old code; after it, as the code after the change, its added lines tinted, and a token the change recolors (a name that became a call) in the new code's color. A morph takes 1.6 s. (A storyboard code visual in `mode: "morph"` is the line morph: its deleted lines are struck through and its added lines type in.)

- **Tokens** are words in any script, numbers, single punctuation characters, and whitespace; comments and strings split into their words, so a changed word moves on its own, and a line inside a block comment colors as a comment (in CSS only the line that opens one, since a star there starts a selector). Lines are cut at 96 characters, as code elements cut them, and split into at most 64 tokens; a line wider than the card ends in an ellipsis, as a code card's does.
- **Elision.** A morph shows at most 14 rows a side (18 in 9:16): every changed line first, then the context nearest them. A run left out between kept lines becomes one `… N lines` marker (Covi counts N on each side; the words come from the video's language); runs at the top or bottom of a hunk are cut, as a code card cuts a hunk to its window.
- **Size.** The code is sized as a code card's is, over the longer side and the lines of both: from 24 px up to 44 px at 1080p (48 px in 9:16), smaller only when the lines would not fit otherwise. The card covers at least 60% of the room the shot's layout gives it, and both sides start at the same line, so the code above the first change stays put.
- **What can morph.** Code on both sides (a new or deleted file has nothing to turn into), at most 12 deleted and 12 added lines, and changes close enough together that every changed line, and some code on each side, fit in 14 rows (each run of context left out between changes takes a row for its marker). `covi render` refuses a morph that does not fit and says why: show such a hunk as a `code` element with `lines`.
- Each hunk line is redacted whole before it is split into tokens, and every token is drawn as text.

### Narration

| `--tts` / `video.narration.provider` | Engine | Default voice |
|---|---|---|
| `auto` (default) | ElevenLabs if `ELEVENLABS_API_KEY` is set, else OpenAI if `OPENAI_API_KEY` is set, else the system engine | depends on the engine |
| `system` | macOS `say`, or `espeak-ng` / `espeak` elsewhere | The best installed voice for the [narration language](#narration-language). macOS, English: the first of Ava (Premium), Zoe (Premium), Samantha (Enhanced), Ava, Samantha, Allison, Alex, Daniel; Korean: Yuna, Jian, Suhyun; Japanese: Kyoko, Otoya; Chinese: Tingting, Lili (any voice whose locale matches comes next, mainland China first for Chinese). espeak: `en-us`, `ko`, `ja`, `cmn` |
| `openai` | OpenAI speech API, model `gpt-4o-mini-tts` (needs `OPENAI_API_KEY`) | `sage` |
| `elevenlabs` | ElevenLabs, model `eleven_multilingual_v2` (needs `ELEVENLABS_API_KEY`) | `21m00Tcm4TlvDq8ikWAM` |
| `none` | No speech; captions carry the video | — |

Options:

- **Voice.** `--voice` or `video.narration.voice` picks the voice. Without one, the system engine picks a voice that speaks the narration language.
- **Rate.** `video.narration.rate` (0.8–1.3) scales the speaking rate:
  - macOS `say`: 172 words per minute × rate;
  - espeak: 165 × rate;
  - OpenAI: the speed parameter;
  - ElevenLabs: speed, clamped to 0.7–1.2.
- **Turning it off.** `--no-narration` or `video.narration: false` turns narration off.

If narration is on but no engine is available, or synthesis fails, Covi renders with captions only, records a warning, and QC's `audio` check warns. `covi doctor` shows which engine Covi would use.

Covi processes each take before mixing:

1. It trims silence at both ends.
2. It applies a 70 Hz high-pass filter.
3. It normalizes loudness to −18 LUFS (true peak −2 dB).
4. It converts the take to 48 kHz mono.

The placed takes then make the voice stem, brought to −16 LUFS for the mix (see [The mix](#the-mix)).

Takes are cached in `.covi/cache/tts/`, keyed by engine, voice, rate, tempo, and the spoken text (and, for OpenAI, the language). The cache directory ignores itself for git.

With narration audio, the fox's mouth follows the loudness of the voice track. Without it, the mouth follows a talking rhythm inside each scene's speech window.

Hosted engines receive the narration text (already redacted), which can include identifiers and file names from the change. Use `system` or `none` to keep narration on the machine.

#### Narration language

The narration is spoken in the language its text is written in. Covi decides it in this order and records the answer and the reason in `video/speech.json`:

1. `--language` (or `COVI_LANGUAGE`).
2. The storyboard's `language`.
3. The script of the narration: Hangul means Korean, any kana means Japanese, Han characters without kana mean Chinese. Identifiers, code, and paths do not count, so "c2-delegate CLI를 추가합니다" is Korean.
4. `language` in configuration, when it names a language.
5. The locale of the system voice you chose (`--voice Yuna` is `ko_KR`). Hosted voices are multilingual, so their names say nothing.
6. English.

The language picks the system voice when you did not choose one. OpenAI is also told the language in its instructions; ElevenLabs' multilingual model detects it from the text.

#### Spoken form

Speech engines for Korean, Japanese, and Chinese read Latin acronyms as if they were words: a Korean voice says "CLI" as 클리 and "JSON" as 질선. Right before synthesis, Covi rewrites each scene's `say` (or its narration, when there is no `say`) into what a person would say, in this order:

1. Your pronunciations (`video.narration.pronunciations`, see [Configuration](configuration.md#pronunciations)): exact, case-sensitive matches, longest first.
2. Built-in words that are said as words, per language, such as JSON (제이슨, ジェイソン, Jason), YAML, GIF, REST, the HTTP methods, and names voices get wrong (git, GitHub). The tables are data in `templates/speech/`.
3. All-caps acronyms of two to six letters, spelled letter by letter with the language's letter names: CLI becomes 씨엘아이 in Korean and シーエルアイ in Japanese. Mandarin speakers say Latin letters by their English names, so Chinese spaces them apart instead (C L I). A plural `s` is dropped (APIs), and digits are left to the voice (X1 becomes 엑스1).

A token is a run of ASCII letters and digits, so particles and punctuation around it do not matter: `CLI를` becomes `씨엘아이를`. In Korean, a particle attached to a rewritten word is made to agree with its new final sound (`JSON를` becomes `제이슨을`).

Code spans, file paths, URLs, e-mail addresses, versions (`v1.47.0`), and redaction marks are never rewritten by the built-in steps; your pronunciations still apply inside code spans and paths. Text that is already spelled out stays as written, and normalizing twice changes nothing. English voices spell acronyms themselves, so English narration only gets your pronunciations.

Captions always show the narration as written. `video/speech.json` lists, for every scene, the caption text, the `say` you wrote, the text sent to the voice, and each rewrite with the rule that made it. QC reads it (see `speech-acronyms` below).

### Captions

Captions are drawn into the video in their own band, which never overlaps the product being shown. Covi also writes them to `video/captions.vtt` and `video/captions.srt`. `--no-captions` or `video.captions: false` turns off both the burned-in captions and the files.

Captions show the `narration` text, never the `say` form. How cues are built (`packages/video/src/captions.ts`):

- Each sentence is split into the fewest cues that fit. Words are spread evenly so no cue ends with an orphaned word, two-line cues are balanced, and a sentence end always closes a cue.
- A line holds at most 30 half-width cells in vertical videos, 34 in square ones, and 44 in landscape ones: a Latin letter takes one cell and a Korean, Japanese, or Chinese character two (East Asian Width), so a vertical line holds 15 CJK characters. A cue has at most two lines.
- Cues are timed within each scene's speech window, in proportion to their length, with at least 0.9 s per cue when the window allows.
- A phrase marked `[[…]]` is swept with a marker in the brand's primary color, from when its first character is spoken to its last, by the same text-weighted split that times the cues; it is split across lines and cues when it wraps. The brackets never reach the voice, `video/speech.json`, `video/narration.md`, or the subtitle files.

Line breaking follows the [narration language](#narration-language):

- **English** splits sentences after `.`, `!`, or `?` and lines at spaces, as before.
- **Korean** finds sentences with `Intl.Segmenter` and breaks lines between words (at spaces), never inside one, so particles stay with their word (`CLI를`).
- **Japanese and Chinese** have no spaces. Sentences also end at `。`, `！`, and `？`, and lines break between the words `Intl.Segmenter` finds, following line-break rules: closing punctuation (`、。，」』）ー` and small kana) never starts a line, opening brackets (`「『（`) never end one, Latin runs such as `c2-delegate` stay whole, and Japanese particles and endings in hiragana stay with the word they follow (`CLIを`, `追加します`).

### Timing

Timing starts from the narration. Covi measures each scene's take (or, when there is no audio, estimates it from the text plus 0.25 s: 2.5 words per second in English, 4.3 syllables per second in Korean, 4 characters per second in Japanese, and 3 in Chinese) and lays the scenes out:

- Lines are 0.35 s apart at an ordinary scene change. The transition into the next scene (length d) starts at `max(line end − 0.5·d, next line − 0.6·d)`: at most half of it plays over the end of the line before, and the next line starts within its first 60%. So an ordinary scene outlasts its line by at most 0.6 s, and the picture changes with the words.
- Transition lengths are the brand's `motion.transitions`: fade 0.45 s, cut 0, push 0.5 s, wipe 0.55 s, zoom-through 0.6 s, and the canvas camera's pan 0.7 s and zoom 0.9 s (only direction gives those; a scene outlasts its line by up to 0.63 s before a pan and 0.71 s before a zoom). The first scene has none; the outro fades in over 0.45 s.
- The first line starts 0.2 s in (0.3 s in narrated standard reviews), so the hook is heard by 0.5 s.
- A scene stays up for at least its visual's minimum (below), and the next line waits for it. The hero holds 0.4 s after its line. The last scene lingers 0.8 s after its last word before the outro.
- The video ends with [the outro](#the-outro), which enters like a scene. With `video.outro: false` (`--no-outro`), the last scene lingers 0.5 s and the video holds it for 1 s more: room for the sonic logo after the last line.
- **Phases.** A scene's `sync` phrases become `phases` in `video/timeline.json`: seconds since the scene started, placed within the line's speech by the text-weighted split the captions use. Components start those moments there (a zoom, a click, a step, a mark, a highlight, a morph, the after state, a finding card, terminal output, the after response) and keep their default fractions of the scene otherwise; a scene's sound `cues` can name them too. The hero's `hero` phase is its `sync.hero` phrase, else the start of its line but never before its transition has finished. A phrase that redaction later removed from the line pins nothing.

**Breathing room.** A narrated standard review (the standard preset, including landscape custom sizes) leaves the narration room to breathe: pauses where the picture holds and the music is heard without a voice over it:

| Breath | Where | How long |
|---|---|---|
| After the hook | A breath before the second line | 1.25 s more lead-in: a pause of about 1.6 s |
| The hero | The hero scene (`hero: true`, else the story's payoff, see [Fitting the music](#fitting-the-music-to-the-picture)) settles as its transition ends; its line waits 1.4 s more, so the music's lift lands clear of speech | a pause of about 2 s between lines (1.9 s with a fade, 2.0 s with `zoom-through`, 2.1 s with the canvas's `zoom`) |
| After the hero | The line after the hero's breathes again | 1.25 s more lead-in |
| The verdict | The summary's verdict lands before its line | 1.25 s more lead-in: a pause of about 1.6 s |
| Long talk | A line that would start more than 24 s after the last breath (or a pause as long as one, 1.5 s) waits for a breath at that scene change | 1.25 s more lead-in |

A line takes at most one breath. A breath belongs to the scene after it: the transition starts as at any scene change, and the new picture holds the pause.

Breaths come from the kind of video and the story only, never from the music, so changing only the sound still keeps every frame. Short-form videos keep their tight timing, and so do videos without narration (or whose voice could not be synthesized), whose music plays throughout.

Minimum time on screen per visual (a scene's `minSeconds` overrides it):

| Visual | Minimum |
|---|---|
| `title` | 1.5 s |
| `summary` | 3.4 s |
| `code` | 2.0 s, or 2.5 s for a morph |
| `screenshot` with marks | 3.0 s, or 1.5 s + 0.7 s per mark when that is more |
| `before-after` | 2.5 s |
| `interaction` | 1.2 s per step + 0.4 s per mark |
| `terminal` | 3.4 s, or 4.4 s with base output |
| `api` | 3.6 s, or 4.6 s with a base response |
| `findings` | 2.0 s + 0.4 s per finding |
| `diagram` | 3.8 s |
| others | 3.0 s |

`fitToDuration` (`packages/video/src/timeline/build.ts`) then keeps the layout under the window's maximum without touching required beats or the hero:

1. **Too long:** it drops optional scenes (never the hero), last first, while more than three scenes remain.
2. **Still too long:** it speeds speech up by at most 15%. The takes are synthesized again with an ffmpeg tempo filter; this applies only when there is narration audio.

The maximum is a ceiling, not a target: a video is as long as its narration needs, and Covi never pads a short one. Each adjustment is logged. The breaths and the outro count toward the length, and fitting never removes them. QC's `duration` warns only past the maximum, or under a length someone asked for.

### The outro

Every video ends with Covi's outro unless `video.outro` is `false` (`--no-outro`). Covi adds it after the last scene on its own: storyboards never mention it, and agents do not author it. It lasts 2.8 s in standard reviews and landscape videos, and 2.4 s in short-form, vertical, and square ones.

The outro is the stacked logo coming together: the seated fox above the `covi` wordmark, then the review's verdict and the sign-off line ("Reviewed with Covi", in the video's language) on one row beneath it. The choreography, with times from the start of the outro:

| When | What happens |
|---|---|
| 0–0.6 s | The summary card drifts away while its fox glides to center stage, its face easing from the verdict's expression to a calm smile (its badge shrinking away). Without a large fox to take over, the fox settles in instead. The progress bar fades out. |
| 0.34–0.88 s | `covi` writes itself in, letter by letter, while the fox glances down at it. |
| 0.58–0.98 s | The verdict chip and the sign-off rise into place. |
| 1.0 s | The card settles: the fox looks back at the viewer, the ▶ over the `i` lands with a small overshoot, and the tail gives one flick. This is the moment the music's sonic logo lands. |
| 1.85 s | One unhurried blink. The card then holds to the end of the video. |

Everything is a pure function of the frame time; the settle moment comes from `outroSettle()` in `packages/video/src/timeline/cues.ts`, which the music fitter uses too. With `video.mascot: false`, the outro draws the wordmark larger, without the fox. The outro is a visual setting, so turning it on or off renders the frames again; changing only the music never does.

### Sound

What the viewer hears, besides the narration:

- **Music:** the Covi theme (the default), a score composed for this video, or none. It lifts on a downbeat at the story's payoff, and its ending follows the review's verdict and rings out over the outro.
- **The sonic logo:** three notes Covi adds after the last line whenever music plays, landing as the outro card settles.
- **Sound effects** for what happens on screen: a pointer click, the before/after reveal, a finding card landing (heavier for high severity), the verdict appearing, a soft whoosh when a scene pushes, wipes, or zooms through, or the camera pans or zooms to it, a riser into the hero and a hit on it, and, when no music plays, the outro's sign-off. Fades, cuts, code, terminal output, API panels, and diagrams make no sound of their own; a scene's `cues` can add one. If an effect is noticeable, it is too loud.

The narration stays the product. All of it is synthesized from data in `templates/music/` by `@covi/audio`: nothing is sampled or downloaded, so the sound is license-clean (people post these videos publicly), exactly as long as the video, and the same bytes every time.

#### Choosing the music

| Setting | Music |
|---|---|
| `video.music.use: theme` (default), `--music theme`, `COVI_MUSIC=theme` | The Covi theme (`templates/music/scores/covi-theme.yml`): warm and quietly optimistic, with no lead melody under the voice |
| `--music compose` | A score written for this video. Covi plays the run's `video/score.json` (an agent wrote it; `covi video --draft --music compose` starts it from the theme, marked `"draft": true`). Without one, the configured model provider writes it; without either, the theme plays, with a warning. An agent score that is invalid or too dense to play fails with exit code 2; a model's falls back to the theme |
| `--music none` | No music; the narration and the effects remain |
| `video.soundEffects.enabled: false`, `--no-sound-effects`, `COVI_SOUND_EFFECTS=false` | No sound effects |

Requests can choose too (see [Reading the request](#reading-the-request)), and "silent" turns off narration, music, and effects together. The question protocol is in [Which questions are asked](#which-questions-are-asked). How to write a score is in `skills/covi-video/references/music.md`; `covi schema score` prints the format.

#### Where the music plays

With `video.music.placement: auto` (the default), every kind of video gets a continuous bed (`spec.music.placement` is `continuous`). Set `bookends` (`--music-placement`, `COVI_MUSIC_PLACEMENT`) to keep the music to the opening and the ending; the choice is kept when a drafted video is rendered again.

| Placement | Under speech | In a pause | Before the first line, after the last | Ramps |
|---|---|---|---|---|
| continuous (default) | −15 dB | −8 dB, in a pause long enough to rise and hold there 0.5 s (about 4.5 s); shorter pauses stay down | −6 dB | raised cosines in dB: 1.2 s into the first line, 1.5 s out of the last; between lines about 2 s each way, so the level never moves more than 5 dB in a second |
| bookends | −40 dB (effectively off) | at most −11 dB, rising and falling at 5 dB a second, so a short breath moves it only a few dB | −11 dB | raised cosines of 1.2 s and 1.5 s at the ends; straight lines at 5 dB a second between lines |

The levels apply to the music bus, which is at the voice's loudness (−16 LUFS; see [The mix](#the-mix)). While someone speaks, the voice's band is also carved out of the music. Without narration there is no speech to duck under, so the music plays at the ends' level throughout.

The placement never makes the music jump. Three moments may move faster: the opening, until 1 s after the first line starts; the hero, 1.5 s either side of its downbeat; and the ending, from 0.5 s before the last line ends. Everywhere else, the music's momentary loudness may change by at most 6 dB within a second: the ramps move at most 5 dB in a second, and a pause whose swell, added to the music's own movement, would come within 0.5 dB of that limit stays at the speech level instead (`levels.pausesHeld` in `video/audio.json` counts these pauses). Music that jumps on its own, such as a composed score with a sudden drop or entry, is not smoothed: QC's `music-jump` fails it. `music-range` checks the music's loudness range over the narration.

Where someone speaks, a continuous bed sits 12–20 dB under the voice. WCAG 1.4.7 (AAA) asks for 20 dB; choose `--music none` when that matters. Bookends are heard mainly before the first line and over the outro, so QC's `music-audible` may warn for them.

#### Fitting the music to the picture

Music fits the picture, never the reverse: the narration fixed every frame before the music is chosen, so changing only the music never moves a frame. The fitter (`fitMusic` in `packages/audio/src/music/fit.ts`) takes the video's length D, the hero moment H, the end of the last narration line L (without narration, the last story scene's start plus 0.45 s), the moment the outro card settles O, and the verdict (the summary scene's, else the review's):

- **Hero.** The hero scene is the scene marked `hero: true`; without one, each storytelling template names its payoff beats (`hero`), and the hero scene is the first scene playing one of them, taking the list in order. H is the hero scene's start plus its own transition's length (0.9 s for the canvas's `zoom`, 0.6 s for `zoom-through`, 0.45 s for a fade), the moment it has settled.
- **Bars.** Bar j starts at `start + j·bar`, where the music may start partway into its first bar (then it fades in over 0.3 s). The form is intro → loop sections → hero section → loop sections → ending; loops cycle and are cut at boundaries, and the intro is dropped when the hero comes too early for it.
- **Constraints, in priority order:** the logo's first note starts at least 0.1 s after L; the logo lands (on the ending's first downbeat, T) at least 0.8 s before the end; T is exactly O when the video has an outro (the outro leaves the logo at least 1.35 s after the last line, room for its pickup at any tempo); the tempo stays within ±6% of the score's (±10% when nothing else fits, recorded); and the hero section's first downbeat is exactly H. The fitter searches whole numbers of bars from H to T and picks the tempo closest to the score's. Without an outro it also chooses T, preferring a landing about a second before the end. When no tempo within ±10% reaches H, the hero starts on the nearest bar and the fallback is recorded. Without a hero, the score's tempo holds exactly. Should the last line leave no room before O, the landing follows the rule for videos without an outro, and the fallback is recorded.
- **The end.** The ending rings over the outro and past the video's end, then fades to silence: over 45% of its ring after the landing, between half a second and a second (0.81 s in a standard review's outro).
- **Short videos.** Under 8 s, there is no music (the reason is recorded); the effects remain.

The fitted arrangement is in `video/audio.json`: the tempo against the score's, where the first bar starts, the sections with their start times, the hero moment and downbeat (and whether the downbeat is clear of speech), the outro's settle moment, the logo's start and landing, the fade, and any fallbacks.

#### The sonic logo and the endings

The logo is Covi's, written by the engine and never by scores: in the score's key, at `form.logo.octave`, a pickup of 5 (an octave below, a sixteenth) and 1 (an eighth), then the landing at T, held about two beats. The landing follows the verdict:

| Verdict | Landing | The ending under it |
|---|---|---|
| looks good | 3 (resolved) | a resolved tonic (I) |
| needs attention | 2 (left open) | an open chord (IVadd9 or Vsus4) |
| needs changes | 6 below the tonic (a gentle minor) | a calm relative minor (vi7) |

The logo plays on `form.logo.track` and, when given, `form.logo.double` (the theme: a bell doubled by a pluck). A score's `form.ending` is one section, or one per verdict.

#### Sound effects

| On screen | Recipe | When |
|---|---|---|
| A pointer press (interaction steps, screenshot clicks) | `click` | as the press begins |
| The before/after reveal | `reveal` | as the after state starts to appear |
| A finding card landing | `finding`, or `finding-high` for high severity | as the card arrives |
| The summary's verdict | `verdict-looks-good`, `verdict-needs-attention`, `verdict-needs-changes` | as the badge rises |
| A scene entering with `push`, `wipe`, `zoom-through`, `pan`, or `zoom` | `transition` | its peak mid-transition; none when the riser into the hero already carries that move |
| The hero | `riser`, `hero` | the riser swells over the 0.8 s before the hero's moment (left out when the hero comes in a video's first 0.8 s); the hit lands on it, with the accent |
| A storyboard cue (`cues`) | its kind's recipe | at its `at` (a riser ends there); one past its scene's end is not played, one repeating Covi's own is merged, and a `riser` or `hero` cue elsewhere in the hero scene adds a second |
| The outro card settling, when no music plays | `outro-looks-good`, `outro-needs-attention`, `outro-needs-changes` | its landing as the card settles |

The moments come from `timeline.cues`, computed by the same functions the runtime draws with (`packages/video/src/timeline/cues.ts`), so a click is heard when it is seen. `templates/music/sound-effects.yml` maps cues to recipes and sets their level against the music bed's level under speech, the same with any placement or with no music. Each recipe is rendered to a −3 dBFS peak and plays 1 dB above the bed: the bed is 15 dB under the voice-normalized stems, so an effect is 14 dB under them. The verdict and the outro play 3 dB above it; swells (the whoosh and the riser) play 3 dB under. If any effect's peak comes within 8 dB of the voice's, the mix lowers every effect together (`levels.effectsCutDb`). Effects are at least 0.15 s apart (except a riser, whose onset is quiet: it neither crowds another effect nor is crowded) and at most 3 in any second, a riser included; when cues compete, the outro wins, then the verdict and the hero's hit, then a high-severity finding, then the rest, and the swells last. Pitched layers of a recipe are written in C and move into the music's key (the major scale sharing its notes, by the nearest octave); without music they play as written.

The outro's sign-off is the sonic logo on its own: the theme's bell doubled by its glass pluck play the pickup of 5 and 1 and land on 3, 2, or 6 below the tonic, as the verdict says, over a soft e-piano chord and a round-bass root, like the theme's endings. A recipe's `anchor` names the moment of the sound that meets its cue (0.45 s in, the landing), so the pickup starts before it. Every note's release ends inside the sound, which is silent before the shortest outro ends. With music, the music's own logo lands on that moment, so the sign-off is left out (`video/audio.json` lists it as dropped, with the reason); with music and effects both off, the outro is silent.

#### The mix

- **Voice:** the takes in place (`video/narration.wav`, mono 48 kHz 16-bit) at −16 LUFS, measured as heard on both channels. The fox's mouth follows the voice alone.
- **Music:** rendered (and cached in `.covi/cache/music/`, keyed by the score, the patches and kits, the timing, the verdict, and the engine version), then made a bus. The bus is brought to −16 LUFS and glued by a compressor (a stereo-linked 50 ms RMS detector; 2:1 above −24 dB RMS with a 6 dB soft knee; 30 ms attack, 400 ms release). On the theme, measured over half seconds, it takes off about 3 dB at the median and 3.7–4.5 dB at the 90th percentile; quiet passages are left alone. It is brought back to −16 LUFS. While someone speaks, its 1–4 kHz band is carved out: `x − k·BP(x)`, an RBJ band-pass at 2 kHz with Q 0.7, where `k` is 0.5 under speech (−6 dB at the centre) and follows the duck. Finally the placement shapes it. `video/music.wav` keeps the stem as placed, so it can be heard alone.
- **Effects:** at their cue times, at levels written against the bed; lowered together if any comes within 8 dB of the voice's peak.
- **Master:** linear gain to the target, then a deterministic lookahead limiter at −1.5 dBFS, up to three times, until the loudness is within ±0.5 LU of the target and the true peak at or below −1 dBTP. The target is −16 LUFS for narrated videos (with or without music, so every narrated video is equally loud) and −20 LUFS for music without narration; effects alone are only limited. Loudness and true peak are measured in TypeScript (ITU-R BS.1770-4), which agrees with ffmpeg's `ebur128`; a linear gain plus a limiter, rather than ffmpeg's `loudnorm`, keeps it deterministic.
- **Levels** go to `video/audio.json`:
  - the voice's loudness
  - how far the music sits under the voice where it speaks (K-weighted RMS)
  - the music's loudness range over the narration (`musicRangeLu`, EBU Tech 3342)
  - its largest momentary jump within 1 s outside the exempt windows (`musicJumps`, with its time and the windows)
  - the pauses held down (`pausesHeld`)
  - how far the effects' peaks sit under the voice's, and how far the mix lowered them (`effectsCutDb`)
  - the master's loudness and true peak
- **What is heard:** `music.audible` in `video/audio.json` counts the seconds of music a viewer hears outside the logo (from the logo's first note to the end): 0.25 s windows of the placed stem (`video/music.wav`) whose RMS, both channels together, is above −45 dBFS. The stem is at the voice's loudness before placement and the master keeps the narration at −16 LUFS, so −45 dBFS sits about 29 dB under the voice as heard: between a continuous bed under speech (about −31 dBFS, quiet but heard) and bookends' ducked level (about −56 dBFS, masked by the voice), 14 dB under the one and 11 dB over the other, margin for the music's own dynamics. `music.hero.clear` says whether the music plays at a pause's full level or above at the hero's downbeat (−8 dB for continuous, −11 dB for bookends): before the first line, after the last, or in a pause long enough to rise all the way.

If the synthesizer or the mix fails, the video keeps its voice (still mastered) and effects, the run records a warning, and `music-fit` says what failed. Music is never left out silently.

#### Changing only the sound

After a full render, `video/frames.json` records a hash of the composition (`timeline.json`, the page, its assets, and the runtime bundle) and the layout reports QC sampled. `covi render` computes the hash again; when it matches and the video exists, Covi keeps the frames, muxes the new mix into the existing video stream, keeps the poster and the contact sheet, runs QC again, and says "Reused the rendered frames; only the audio changed." It takes seconds:

```bash
covi render --run <id> --music none      # or --music compose, --music-placement continuous, --no-sound-effects
```

A change to the narration or the storyboard changes the hash, so those render in full.

### Composition and rendering

**Composition.** `video/composition/` is self-contained:

- `index.html`, with the timeline inlined;
- `runtime.js`;
- `timeline.json`;
- the Inter and JetBrains Mono fonts, and for Korean, Japanese, or Chinese text, the slices of Noto Sans KR, JP, or SC that cover it;
- the images.

**Fonts for CJK text.** Inter and JetBrains Mono have no CJK glyphs, and system fallbacks differ between machines (a Linux runner may have none and draw boxes). Covi bundles the Noto Sans KR, JP, and SC variable fonts (SIL Open Font License, from `@fontsource-variable`). Each is split into about a hundred unicode-range slices; the composition embeds only the slices its text uses (the narration, captions, titles, labels, code, and terminal output), declares them with `@font-face`, and the runtime loads every declared face before it lays anything out, so frames never depend on lazy font loading. Han characters take the shapes of the video's language: Japanese kanji, Simplified Chinese hanzi, or Korean hanja (Chinese in an English video). `<html lang>` is set to the video's language (`zh-Hans` for Chinese), Korean text breaks only between words (`word-break: keep-all`), and Japanese and Chinese follow strict line-break rules.

Open `index.html` in Chromium to see the first frame. Run `covi.seek(<frame>)` in the developer console to draw any frame, and `covi.layout()` to get the layout report that QC uses.

**Determinism.** Every visual property is a pure function of the frame time. The runtime uses no clocks and no CSS transitions or animations, and its randomness, such as the fox's blinks, is seeded from the title. The same timeline renders the same frames, and a render test checks it.

**Rendering** (`packages/video/src/render/renderer.ts`):

- Workers each open the composition in headless Chromium (Playwright) at a device scale factor of 1, seek every frame in their range, and pipe JPEG screenshots (quality 94) into an ffmpeg segment encoder.
- The segments are concatenated, then muxed with the mix (AAC, 192 kb/s, 48 kHz stereo) and written with `+faststart` for streaming. A video with no sound at all (narration, music, and effects off) has no audio stream.
- The encoder is libx264 (preset `medium`, CRF 18, High profile, `yuv420p`, BT.709 color tags, broadcast range) when ffmpeg has it. Otherwise Covi uses `h264_videotoolbox` (8 Mb/s), and `mpeg4` as a last resort.
- By default Covi runs min(4, half the CPU cores) workers, never more than one per 45 frames. Override with `--workers <n>`.
- The poster (`video/poster.png`) is the frame at 1.6 s, or a third of the way in for very short videos.
- The contact sheet (`video/contact-sheet.jpg`) tiles, in time order, the frame at 0.3 s (the cold open), the middle of each scene, the middle of each transition (a cut has none), the hero's accent 0.1 s after its `hero` phase, and the middle of each morph: six 320 px columns for vertical videos; three 560 px columns otherwise, four past twelve tiles. Use it to review a whole video at a glance.

Requirements:

- Playwright's Chromium: `covi doctor --install-browser` downloads the build that matches Covi's own Playwright version (add `--with-deps` on Linux for the system libraries).
- `ffmpeg` and `ffprobe` on `PATH`, or set `COVI_FFMPEG` and `COVI_FFPROBE` to them. If ffmpeg is missing, Covi exits with code 3.

`covi doctor` checks both. Rendering is the slowest stage; its time grows with the number of frames and shrinks with workers.

### Quality checks

After rendering, Covi checks the video and writes `video/qc.json`. It contains the overall `status`, every check, and the `measured` values: duration, size, fps, integrated loudness, true peak, and mean volume.

| Check | Passes when | Otherwise |
|---|---|---|
| `format` | Size and fps match the spec, and the pixel format is `yuv420p` | fail |
| `duration` | The duration is at most the window's maximum + 0.5 s. The window is a ceiling: a shorter video passes, unless someone asked for a length (`--duration`, a length in the request, or `video.duration`) and the video is more than 0.5 s under its minimum | warn; fail when longer than 1.5× the maximum |
| `audio` | Whenever narration, music, or effects play: an audio stream exists and is not silent (its loudest sample above −60 dBFS). A narrated mix reads −16 ± 1 LUFS; music without narration −20 ± 1. The true peak is at or below −1 dBTP. Effects alone have no loudness target. With all sound off, no stream is expected | fail without a stream, when silent, beyond ±2 LU, or with a true peak above −0.5 dBTP; warn within ±2 LU, with a true peak between −1 and −0.5 dBTP, or when narration was requested but no speech engine was available |
| `music-under-speech` | Where someone speaks, a continuous bed sits 12–20 dB under the voice, and bookends at least 30 dB, as K-weighted RMS from `video/audio.json`. Passes when no music plays under narration | continuous: warn outside 12–20 dB, fail under 9; bookends: warn under 30 |
| `music-jump` | Outside the opening (until 1 s after the first line starts), the hero (1.5 s either side of its downbeat), and the ending (from 0.5 s before the last line ends), the music's momentary loudness (400 ms windows every 100 ms) changes by at most 6 dB between any two windows up to 1 s apart (`levels.musicJumps`). Passes when no music plays under narration | fail |
| `music-range` | The music's loudness range (EBU Tech 3342) from the first line's start to the last line's end is at most 8 LU (`levels.musicRangeLu`). Passes when not measured (no music under at least 3 s of narration) | warn |
| `music-fit` | The logo starts at least 0.1 s after the last line, lands at least 0.8 s before the end and within one frame of the outro settling, the hero downbeat is within one frame of the hero moment, the tempo is within ±6% of the score's, and the last 10 ms are below −60 dBFS | fail when the logo overlaps the last line or the end is not silent; warn on a late landing, a landing off the outro or a hero off its downbeat (naming the fallback), a tempo beyond ±6%, or a music render that failed |
| `music-audible` | Music that was asked for (`theme` or `compose`) is heard for at least 3 s outside the logo, or 5% of the video when that is more (`music.audible` in `video/audio.json`), and, under bookends, the hero downbeat is clear of speech. Passes when music is off or none could play (`music-fit` says why) | warn |
| `sound-effects` | Effects are at least 0.15 s apart (a riser excepted), at most 3 in any second, and their peaks sit at least 8 dB under the voice's | fail on crowding or under 3 dB; warn from 3 to 8 dB |
| `black-frames` | ffmpeg `blackdetect` (at least 0.4 s, pixel threshold 0.05) finds nothing | warn |
| `still` | ffmpeg `freezedetect` on the media region (noise 0.001, at least 1.5 s) finds no freeze that covers 1.5 s or more of narration. Names the scene | warn |
| `captions-clear-of-content` | The caption band never intersects demonstrated content | fail |
| `captions-in-frame` | The caption band stays inside the frame, and no caption line is wider than its box | fail |
| `text-fits` | No text element overflows its box | warn |
| `narrator-clear-of-content` | The narrator, measured as drawn with its tail, never covers demonstrated content, the media region, captions, or header text | warn |
| `text-size` | Code, terminal, and API text is at least 24 px and body text (headings, titles, notes, code captions, callout and summary text, node labels, area names) at least 28 px at 1080p wherever a story scene has settled, measured as drawn and relative to the frame's short side. Chips, mark glosses, step labels, file paths, counts, and edge labels are exempt | warn, naming the scene, the kind of text, and its size |
| `empty-frame` | Where each card scene (code, terminal, API, findings, change map, callout, diagram, or a directed shot that leads with one) has settled, its content covers at least 40% of the media region. Captures keep their own aspect ratio, and title and summary cards are not checked | warn, naming the scene and its share |
| `monotony` | No more than two story scenes in a row show the same kind of visual, compared by the visual's `kind`, so code and terminal differ (the outro is not counted). A directed shot counts as what it leads with: an `output` element as a terminal, a `capture` as a screenshot, a `morph` as code, a `node` as a diagram, a `label` as a callout | warn, naming up to three runs |
| `transition-variety` | With four or more story transitions (into each story scene after the first), no one kind covers more than 60% of them | warn, naming the kind and its share |
| `images` | Every image loaded in the composition | fail |
| `fonts` | Every bundled font face loaded, so no text fell back to the machine's fonts (boxes on a runner without CJK fonts) | fail |
| `caption-timing` | No cue overlaps the next, reads faster than the language's limit, or lasts less than 0.7 s. Limits, in characters per second: English 24 (counting spaces), Korean 17, Chinese 13, Japanese 8 (not counting spaces; a half-width character such as a Latin letter counts half) | fail on overlap; warn on fast or short cues |
| `narration-pace` | No scene's narration is faster than 4.2 words per second in English, 7.5 syllables per second in Korean, 7 characters per second in Japanese, or 5.5 in Chinese, counted with `Intl.Segmenter` on the text the voice was given | warn |
| `hook` | The first line starts by 0.5 s | warn |
| `speech-share` | Narration fills at least 70% of the video before the outro | warn |
| `speech-acronyms` | Non-English narration: the text sent to the voice has no all-caps Latin token left (outside URLs, e-mail addresses, and versions). Names the scene and the token | warn: write the spoken form in `say` or add a pronunciation |
| `voice-language` | The system voice's locale matches the narration language (hosted voices are not checked) | warn, with a voice to choose instead; also warn when the system voice list could not be read, so the voice's language is unknown |
| `grounding` | Every story scene with narration that is not framing (title, change map, summary) cites evidence, counting what its visual shows from the run, and every explanation statement (the intent, a behavior with a before or after, each change) cites evidence | warn, naming the scenes and statements |

Covi samples the layout checks at two frames per scene, 35% and 70% of the way through, and once more where each story scene has settled: its entrance and choreography are done and the next scene has not begun to enter. `text-size` and `empty-frame` read only settled frames. A directed scene settles after its beats (every element revealed, every camera beat done, every morph's added tokens in their syntax colors); one with a camera beat is also sampled just before its first, at its stop's own scale, when it has entered (and played the reveals before it) by then, and `text-size` keeps the smaller size. On the canvas a frame reports what the camera draws: each box where it is drawn, and only what lies inside the scene's clip while it has one.

Cards size their text to their content: code, terminal, and API body text is as large as its lines allow, from 24 px up to 44 px at 1080p (48 px in 9:16), and shrinks below 24 px (to 13 at least) only when its lines would not fit otherwise, which `text-size` reports. Code, terminal, API, findings, and callout cards cover at least 60% of the media region (a before and after terminal pair in 16:9 about 59%, for the gap between them), with short code, findings, and callouts in their middle and a terminal's text at the top; diagram nodes and change-map rows grow toward it.

The overall status is `fail` if any check fails, `warn` if any warns, and `pass` otherwise. QC never deletes the video and never changes the exit code. Failed and warning checks are added to the run's warnings. The result object carries `video.qc`, and a failed QC adds the warning "Video QC failed; see video/qc.json."

After a render, read `qc.json`, then open `contact-sheet.jpg` (each tile is labeled, in a band below the frame so the label never covers the captions, with its scene and the evidence it cites, `—` for none) and `poster.png`. If a scene is wrong, crowded, or not grounded in evidence, fix the storyboard and run `covi render` again.

## Videos in CI

`covi ci` never asks questions:

- **Decision.** It applies `video.when` (or `--video auto|always|never`).
- **Capture.** It demonstrates whenever the recommendation is screenshots or video and the project is runnable, at desktop and mobile by default, whether or not a video is rendered. Under `pull_request_target` it runs no project command, so only static sites (or an app already running at `app.url`) are captured.
- **Spec.** It builds the spec from configuration, which CI reads from the base revision, and from flags such as `--mode` (or `--short`), `--duration`, and `--music`.
- **Music.** The theme by default. With `video.music.use: compose`, the configured model provider writes the score; without one, the theme plays and the run says so.
- **Direction.** Covi's default director draws the video on the canvas, with the same motion an interactive run gets; `video.direction: off` renders without it.
- **Failures.** If rendering fails, the run records a warning and the review still completes.

The review comment links the video according to `publish.video`:

- `link` (default) links the video in the CI artifacts: the file inside the job's artifacts on GitLab, the uploaded workflow artifact on GitHub;
- `upload` uploads the file through the GitLab project uploads API and embeds it in the note; on GitHub it falls back to the link;
- `none` leaves the video out.

See [GitHub Action](github-action.md) and [GitLab CI](gitlab-ci.md) for the inputs that map to these settings.
