# Video

This page explains how Covi decides whether a change deserves a review video and how a request becomes a concrete video spec, including which questions get asked and when. It then walks through each pipeline stage and what it writes: storyboard, capture, narration, captions, timeline, composition, render, and quality checks.

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
| Short-form (default) | `--short` (or `--mode short`) | 1080×1920, 9:16 | target 28 s, accepted 20–35 s | concise |
| Standard review | `--standard` (or `--mode standard`) | 1920×1080, 16:9 | target 80 s, accepted 60–120 s | explanatory |
| Custom | `--custom --width W --height H` (or `--mode custom`) | any size from 240 to 3840 px | the short-form window when vertical or square, the standard window when landscape | concise up to a 45 s target, explanatory above |

Durations:

- `--duration` accepts seconds (`90`), unit forms (`30s`, `1m30s`, `2 minutes`), or `auto`.
- A specific duration becomes a window: the target is clamped to 5–600 s, and the accepted range is the target ± max(2 s, 15%), never below 4 s. For example, `30s` becomes 25.5–34.5 s.
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
| `publish.video` | `link` | how CI comments reference the video: `link`, `upload`, `none` |

Environment variables can set the same values: `COVI_VIDEO_MODE`, `COVI_VIDEO_DURATION`, `COVI_NARRATION`, `COVI_TTS_PROVIDER`, `COVI_TTS_VOICE`, and `COVI_CAPTIONS`. See [Configuration](configuration.md) for how flags, environment, repository configuration, and defaults combine.

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
| no narration, without voiceover, silent, muted audio / narrated, voiceover | narration off / on |
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
| No narration / narration | 내레이션 없이, 음성 없이, 무음 / 내레이션 | ナレーションなし, 音声なし, 無音 / ナレーション | 无旁白, 无配音, 静音 / 旁白, 配音 |
| No captions | 자막 없이 | 字幕なし | 无字幕, 不要字幕 |
| Theme | 다크, 라이트 모드 | ダーク, ライトモード | 深色, 浅色 |

Explicit flags override anything inferred from the words. "Make a 30-second vertical review video" resolves completely: short-form, 1080×1920, 25.5–34.5 s.

### Which questions are asked

`planVideo` (`packages/video/src/spec.ts`) decides what is still open. A field counts as decided when it comes from the request, a flag, the environment, or the repository configuration. Built-in defaults do not count. Covi asks only about mode, length, and (for custom videos) size:

| Still undecided | Questions |
|---|---|
| Mode and length | Both, together: "What kind of video should Covi create?" (Short-form · Standard review · Custom) and "How long?" (~15 sec · ~30 sec · ~60 sec · Let Covi decide) |
| Only the length, for short-form or standard | None: the mode's `auto` window applies |
| Only the length, for a custom size (for example "a square video") | "How long?": a size implies no length |
| A custom mode without a size | "Which size should the custom video be?" (1080×1920 · 1920×1080 · 1080×1080) |
| Nothing | None |

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

  The agent asks with its own question tool, then passes the answers as flags (`--short`, `--standard`, `--custom`, or `--mode <mode>`, plus `--duration`, `--width`, and `--height`). `--dry-run --yes` returns no questions. The `covi-video` skill describes this protocol for agents ([Skills](skills.md)).

## The pipeline

`covi video` runs these stages in one run directory (`.covi/runs/<run-id>/`). Each stage writes files that the next reads.

| Stage | What happens | Writes |
|---|---|---|
| Decide | Applies the decision rules above | `video/decision.json` |
| Capture | Runs the software at base and head when a video will be made, the project is runnable, and the change has something to show (the same demonstration as `covi demo`, at desktop and mobile unless `demo.viewports` says otherwise) | `demo/captures.json`, `demo/screenshots/`, `demo/diffs/`, `demo/demo.md` |
| Review | Explains and reviews the change; the story's review note comes from here | `explanation.json`, `review.json`, `review.md`, `summary.md`, … |
| Storyboard | Drafts scenes from the evidence with a storytelling template, or validates the one you supply, then redacts it | `video/storyboard.json` |
| Narration | Picks the narration language and the voice, rewrites each scene's spoken text for that voice (acronyms spelled out, your pronunciations applied), then synthesizes and measures one take per scene and mixes them | `video/speech.json`, `video/narration.wav` |
| Timing | Lays scenes out from the measured speech and fits the duration window | (inside the timeline) |
| Captions | Splits the narration into cues timed to the speech | `video/captions.vtt`, `video/captions.srt` |
| Timeline | Freezes everything the renderer needs: scenes, timings, captions, mouth movement, theme, the language, and the labels the runtime draws (verdicts, stats, Before/After) in that language | `video/timeline.json`, `video/narration.md` |
| Composition | Writes a self-contained HTML page that can draw any frame | `video/composition/` |
| Render | Captures every frame in headless Chromium and encodes H.264 | `video/covi-review.mp4`, `video/poster.png`, `video/contact-sheet.jpg` |
| QC | Checks format, duration, audio, black frames, layout, caption timing, and the text the voice was given | `video/qc.json` |

Two failures do not stop the run:

- If the demonstration fails, or the project's commands are not trusted on this machine yet (see [Security](security.md)), the run records a warning, and the story is told with code excerpts, findings, and callouts instead.
- If speech synthesis fails, the video renders with captions only.

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
- **Missing evidence.** Optional beats without evidence are dropped. Required ones fall back to a callout with the explanation's summary.
- **Language.** Covi drafts in the run's language, or in a language the request names, and records it as the storyboard's `language`. Narration sentences, headings, eyebrows (each template beat carries them in Korean, Japanese, and Chinese), Before/After labels, and the "… more lines" marker come from the message catalogs; text taken from the change (titles, commit messages, area names, findings) stays as written.
- **Narration budget.** Narration runs at about 2.5 words per second in English, 4.3 syllables per second in Korean, 4 characters per second in Japanese, and 3 in Chinese, scaled from measured voice rates with the same margin English has. It gets 80% of the target duration in short-form and 85% in standard, split by beat weight. The same idea takes more syllables in Korean, Japanese, and Chinese, so a short video says less; when a short video's findings lead does not fit, Covi keeps the finding ("Worth checking: …") instead of the lead.
- **Depth for longer videos.** Standard-length videos say more, and only what the evidence supports:
  - the title scene adds a one-line map of the scenes that follow ("We'll look at the response before and after, the code behind it, and what to check before merging.") when it fits the budget;
  - an API scene adds what the captured bodies show, such as a status change or sizes ("The old response listed 5 entries; the new items array holds 2.");
  - a terminal scene adds a changed exit code;
  - a code scene uses the explanation's own description of the file's area;
  - the findings scene names up to three findings with why the first ones matter, and announces only a count it covers;
  - the summary adds "Suggested next step: …" from the top finding when the verdict is not "looks good", or where to start reading the diff when it is.
- **Spoken form.** The `say` field holds the spoken form when it differs from the caption text. Identifiers and file names are spelled out for speech, for example `app.js` becomes "the app script" (in Korean "app 스크립트"), and in Korean, Japanese, and Chinese routes are said segment by segment ("API 슬래시 users").

**Model refinement.** If a model provider is configured (`intelligence.provider: anthropic` or `command`, or `auto` with an Anthropic key or a trusted `intelligence.command`), it rewrites the drafted narration within each scene's word budget, following the `covi-video` methodology. The prompt is redacted before it is sent. Visuals stay as drafted, because they are grounded in captured evidence. If refinement fails, Covi keeps the draft and records a warning.

**Redaction.** Every storyboard, drafted or supplied, passes through the `Redactor` before narration, captions, the timeline, or the composition are made from it, so a secret in a code excerpt or command output does not reach the audio or the frames. Screenshots are images of the running software and are shown as captured.

**Format.** Run `covi schema storyboard` for the full JSON Schema. Top level: `title`, `template`, `draft` (true for Covi's draft), `language` (optional: `en`, `ko`, `ja`, or `zh`; see [Narration language](#narration-language)), and `scenes`, 2–14 of them. Each scene:

| Field | Meaning |
|---|---|
| `id` | Optional; defaults to `s1`, `s2`, … |
| `beat` | The template beat this scene plays |
| `eyebrow`, `heading` | Section label (up to 40 characters) and heading (up to 90) |
| `narration` | What Covi says, also used for captions (up to 600 characters) |
| `say` | Spoken form, when it differs from the caption text. Covi still normalizes it before synthesis (see [Spoken form](#spoken-form)) |
| `visual` | One of the kinds below |
| `expression` | Narrator expression: `neutral`, `explaining` (default), `thinking`, `reviewing`, `warning`, `success` |
| `minSeconds` | Overrides the visual's minimum time on screen (1–30) |
| `optional` | May be dropped to fit the duration |

| Visual `kind` | Shows |
|---|---|
| `title` | Title card with subtitle, eyebrow, and meta chips |
| `change-map` | Up to 8 areas with their surfaces and line counts |
| `code` | Up to 40 diff lines (`add`, `del`, `context`) with highlighted line indexes |
| `screenshot` | One capture, with an optional `focus` region to zoom toward, a `click` point, and a `device` frame |
| `before-after` | Two captures in a `split`, `stack`, or `wipe` layout, with an optional focus region |
| `interaction` | 1–8 flow steps, each with a capture, click point, focus, and label |
| `terminal` | A command with its output, and optionally the base revision's output |
| `api` | A request with the base and head status and body, highlighted in colors that stay readable on the light cards |
| `findings` | 1–3 findings with certainty, severity, and location |
| `callout` | An `info`, `warning`, or `success` card |
| `diagram` | 2–8 nodes (marked changed or not) and edges |
| `summary` | Verdict, headline, up to 4 points, and change stats |

Image paths are relative to the run directory (for example `demo/screenshots/home-desktop-after.png`) and must resolve inside it, so a storyboard cannot pull other files from the machine into a video. If an image is missing, rendering stops with an error that lists it.

The narrator, Covi's fox, appears in the header corner of content scenes. Title and summary cards draw it large instead. See [Visual system](visual-system.md).

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

- Top-level keys: `id`, `name`, `description`, `use_when`, `beats`, and `short` (beat ids, in order).
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

- `--draft` stops after writing `video/storyboard.json`. The result's `video.reason` says so.
- `covi render` reuses the spec saved in `video/decision.json` when the storyboard was drafted: mode, size, length, style, captions, narration on or off, theme, frame rate, and voice. Flags you pass now (and `COVI_*` variables) change only what they name; a different mode (`--short`, `--standard`, `--custom`, `--mode`) resets the size, length, and style that came with the old one.
- `covi render` reads `explanation.json`, `review.json`, and `demo/captures.json` from the run.
- `covi render --storyboard <file>` renders a storyboard stored elsewhere. Image paths inside it are still relative to the run directory.
- `covi video --storyboard <file>` skips drafting and renders the given storyboard.
- Re-rendering after an edit only synthesizes the lines that changed; the rest come from the narration cache.

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

Line breaking follows the [narration language](#narration-language):

- **English** splits sentences after `.`, `!`, or `?` and lines at spaces, as before.
- **Korean** finds sentences with `Intl.Segmenter` and breaks lines between words (at spaces), never inside one, so particles stay with their word (`CLI를`).
- **Japanese and Chinese** have no spaces. Sentences also end at `。`, `！`, and `？`, and lines break between the words `Intl.Segmenter` finds, following line-break rules: closing punctuation (`、。，」』）ー` and small kana) never starts a line, opening brackets (`「『（`) never end one, Latin runs such as `c2-delegate` stay whole, and Japanese particles and endings in hiragana stay with the word they follow (`CLIを`, `追加します`).

### Timing

Timing starts from the narration. Covi measures each scene's take (or, when there is no audio, estimates it from the text plus 0.25 s: 2.5 words per second in English, 4.3 syllables per second in Korean, 4 characters per second in Japanese, and 3 in Chinese) and lays the scenes out:

- A scene lasts `max(visual minimum, lead-in + speech + 0.5 s)`, plus any extra hold.
- The lead-in is 0.2 s for the first scene and 0.3 s for the others.
- Consecutive scenes overlap by a 0.45 s transition (the brand's `motion.transition`), and the video ends with a 0.4 s outro.

Minimum time on screen per visual (a scene's `minSeconds` overrides it):

| Visual | Minimum |
|---|---|
| `title` | 2.6 s |
| `summary` | 3.4 s |
| `code` | 3.4 s + 0.07 s per line (at most +1.4 s) |
| `before-after` | 4.2 s |
| `interaction` | 1.7 s per step, at least 3.6 s |
| `terminal` | 3.4 s, or 4.4 s with base output |
| `api` | 3.6 s, or 4.6 s with a base response |
| `findings` | 3.2 s + 0.6 s per finding |
| `diagram` | 3.8 s |
| others | 3.0 s |

`fitToDuration` (`packages/video/src/timeline/build.ts`) then fits the layout into the spec's window without touching required beats:

1. **Too long:** it drops optional scenes, last first, while more than three scenes remain.
2. **Still too long:** it speeds speech up by at most 15%. The takes are synthesized again with an ffmpeg tempo filter; this applies only when there is narration audio.
3. **Too short:** it extends the time on visual scenes (not the title or summary) rather than padding silence. Each scene gets at most 3 s extra for targets of 45 s or less, and at most 7 s for longer targets.

Each adjustment is logged. If the video still misses the window, QC reports it.

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
- The segments are concatenated, then muxed with the narration (AAC, 160 kb/s, 48 kHz) and written with `+faststart` for streaming.
- The encoder is libx264 (preset `medium`, CRF 18, High profile, `yuv420p`, BT.709 color tags, broadcast range) when ffmpeg has it. Otherwise Covi uses `h264_videotoolbox` (8 Mb/s), and `mpeg4` as a last resort.
- By default Covi runs min(4, half the CPU cores) workers, never more than one per 45 frames. Override with `--workers <n>`.
- The poster (`video/poster.png`) is the frame at 1.6 s, or a third of the way in for very short videos.
- The contact sheet (`video/contact-sheet.jpg`) tiles the middle frame of each scene: six 320 px columns for vertical videos, three 560 px columns otherwise. Use it to review a whole video at a glance.

Requirements:

- Playwright's Chromium: `covi doctor --install-browser` downloads the build that matches Covi's own Playwright version (add `--with-deps` on Linux for the system libraries).
- `ffmpeg` and `ffprobe` on `PATH`, or set `COVI_FFMPEG` and `COVI_FFPROBE` to them. If ffmpeg is missing, Covi exits with code 3.

`covi doctor` checks both. Rendering is the slowest stage; its time grows with the number of frames and shrinks with workers.

### Quality checks

After rendering, Covi checks the video and writes `video/qc.json`. It contains the overall `status`, every check, and the `measured` values: duration, size, fps, integrated loudness, and mean volume.

| Check | Passes when | Otherwise |
|---|---|---|
| `format` | Size and fps match the spec, and the pixel format is `yuv420p` | fail |
| `duration` | The duration is within the window, ±0.5 s | warn; fail when longer than 1.5× the maximum or shorter than half the minimum |
| `audio` | Narrated: an audio stream exists, mean volume is above −50 dB, and integrated loudness is within −26…−12 LUFS. Passes when narration was not requested | fail without an audio stream or when silent; warn when loudness is out of range, or when narration was requested but no speech engine was available |
| `black-frames` | ffmpeg `blackdetect` (at least 0.4 s, pixel threshold 0.05) finds nothing | warn |
| `captions-clear-of-content` | The caption band never intersects demonstrated content | fail |
| `captions-in-frame` | The caption band stays inside the frame, and no caption line is wider than its box | fail |
| `text-fits` | No text element overflows its box | warn |
| `narrator-clear-of-content` | The narrator never overlaps content | warn |
| `images` | Every image loaded in the composition | fail |
| `caption-timing` | No cue overlaps the next, reads faster than the language's limit, or lasts less than 0.7 s. Limits, in characters per second: English 24 (counting spaces), Korean 17, Chinese 13, Japanese 8 (not counting spaces) | fail on overlap; warn on fast or short cues |
| `narration-pace` | No scene's narration is faster than 4.2 words per second in English, 7.5 syllables per second in Korean, 7 characters per second in Japanese, or 5.5 in Chinese, counted with `Intl.Segmenter` on the text the voice was given | warn |
| `speech-acronyms` | Non-English narration: the text sent to the voice has no all-caps Latin token left (outside URLs, e-mail addresses, and versions). Names the scene and the token | warn: write the spoken form in `say` or add a pronunciation |
| `voice-language` | The system voice's locale matches the narration language (hosted voices are not checked) | warn, with a voice to choose instead |

Covi samples the layout checks at two frames per scene, 35% and 70% of the way through.

The overall status is `fail` if any check fails, `warn` if any warns, and `pass` otherwise. QC never deletes the video and never changes the exit code. Failed and warning checks are added to the run's warnings. The result object carries `video.qc`, and a failed QC adds the warning "Video QC failed; see video/qc.json."

After a render, read `qc.json`, then open `contact-sheet.jpg` and `poster.png`. If a scene is wrong, crowded, or not grounded in evidence, fix the storyboard and run `covi render` again.

## Videos in CI

`covi ci` never asks questions:

- **Decision.** It applies `video.when` (or `--video auto|always|never`).
- **Capture.** It demonstrates whenever the recommendation is screenshots or video and the project is runnable, at desktop and mobile by default, whether or not a video is rendered. Under `pull_request_target` it runs no project command, so only static sites (or an app already running at `app.url`) are captured.
- **Spec.** It builds the spec from configuration, which CI reads from the base revision, and from flags such as `--mode` (or `--short`) and `--duration`.
- **Failures.** If rendering fails, the run records a warning and the review still completes.

The review comment links the video according to `publish.video`:

- `link` (default) links the video in the CI artifacts: the file inside the job's artifacts on GitLab, the uploaded workflow artifact on GitHub;
- `upload` uploads the file through the GitLab project uploads API and embeds it in the note; on GitHub it falls back to the link;
- `none` leaves the video out.

See [GitHub Action](github-action.md) and [GitLab CI](gitlab-ci.md) for the inputs that map to these settings.
