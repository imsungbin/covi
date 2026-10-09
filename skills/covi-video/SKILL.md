---
name: covi-video
description: Make a short narrated review video of a code change - only when seeing the change helps - by planning from the user's words, asking at most a couple of questions, authoring a storyboard grounded in captured evidence, and rendering it with captions and the Covi narrator. Use for any request for a video, short, reel, or walkthrough of a change.
---

# Make a review video

A Covi video explains a change; it is not a screen recording. It follows the review loop (understand → explain → show → what to check) and uses real captures of the software, real code, and real findings.

## Decide whether a video helps

Covi decides first (`video/decision.json`): a video is worth making when the change has behavior worth seeing (UI, interaction, visual, API, CLI) or is a large restructuring that needs a guided tour. For internal changes (refactors, tests, CI, dependency bumps) Covi declines and the explanation and review serve better. When Covi declines, tell the user why in one sentence and offer `--force` only if they still want one.

## Resolve what the user asked for

1. Pass the user's own words to Covi:

   ```bash
   covi video --dry-run --request "<the user's words>" --json
   ```

   The result contains the resolved `spec` (mode, size, duration, narration, captions), what was `inferred` from the words, what is `missing`, and `questions` worth asking.

2. If `questions` is empty, do not ask anything. "Make a 30-second vertical review video" already says short-form, 9:16, about 30 seconds.
3. If questions remain and you are in an interactive session, ask them together in one prompt with your client's question tool, using the options Covi returned (for example: video type: Short-form / Standard review / Custom; length: ~15 sec / ~30 sec / ~60 sec / Let Covi decide; music: Covi theme / Compose for this video / No music). Covi adds the music question only while it is asking anyway. Ask about width and height only when the user chose Custom (run the dry run again with `--custom`, passing the other answers as flags too, to get that question).
4. Pass the answers as flags: `--short`, `--standard`, or `--custom`, `--duration`, `--width` and `--height`, and `--music theme|compose|none`. "Compose" means you write the score: follow the compose steps below.
5. In CI or any non-interactive context, never ask: configuration and defaults decide (short-form, about 30 seconds, narration and captions on, the Covi theme, sound effects on).
6. The questions come back in the user's language when the request is written in Korean, Japanese, or Chinese, or when the run's language is one of them; ask them as given. A request that names a language ("한국어로", "in Japanese", "用中文") sets the video's language.

## Run it

```bash
# Draft the storyboard from Covi's evidence, then rewrite it
covi video --short --duration 30s --draft --json        # writes video/storyboard.json
# rewrite video/storyboard.json (see the method below)
covi render --run <id> --json                           # narrate, compose, render, check
```

`covi render` keeps the size, length, music, and outro chosen at draft time; pass flags only to change them. `covi video --short --duration 30s` does it all in one step, but it renders Covi's draft as written; the draft is a scaffold, so draft, rewrite, then render. Use `--standard` for 16:9 reviews of up to 120 seconds, `--custom --width W --height H` for anything else, `--no-narration` for captions only, `--music none` or `--no-sound-effects` for less sound, and `--no-outro` to end on the last scene instead of Covi's outro.

**Music.** By default the Covi theme plays, arranged to the story and the verdict, with subtle sound effects for clicks, reveals, findings, scenes that push, wipe, or zoom through, the hero, and the verdict. It is a continuous bed under the whole video: 12–20 dB under the voice while someone speaks, with the voice's band carved out, a little higher before the first line, in long pauses, and over the outro, where its sonic logo lands. It never jumps. `--music-placement bookends` plays it before the first line and after the last instead, effectively off under the narration. When the result carries `video.music.hint` (nobody chose the music), tell the user in one sentence, for example: "It has the Covi theme as music; say if you'd like none or a score composed for this change." To compose:

```bash
covi video --short --duration 30s --draft --music compose --json   # also writes video/score.json (the theme, "draft": true)
# write the score in video/score.json, following references/music.md, and set "draft": false
covi render --run <id> --json
```

Music never moves frames: changing only the music or the effects (`covi render --run <id> --music none`) keeps the rendered frames and re-mixes the sound in seconds.

**Review it yourself** after every render. Open `video/contact-sheet.jpg` (in time order: the frame at 0.3 s, the middle of every scene, the middle of every transition, and the hero's accent; the outro last) and `video/poster.png`, read `video/qc.json`, and answer in order:

1. Is frame 0 legible and intriguing with the sound off? The first tile (0.3 s in) shows the subject, readable at a glance, not a title card, and the `hook` check passes: the first line starts by 0.5 s.
2. Is the hero visibly the biggest moment? Its accent tile (the flash and the ring) is the one you would pick as the thumbnail.
3. Does any scene hold a still picture while the narration continues? The `still` check names each scene whose picture froze for 1.5 s or more of narration, and `speech-share` warns when narration fills less than 70% of the video before the outro.
   - For a still: split the scene, pin its visual's moments to the line with `sync`, give a capture a `focus` or `click` to follow, or take `"camera": "static"` off so the camera moves.
   - Covi never pads a video to reach its target length, so a short video is fine. When `speech-share` warns, drop `minSeconds` holds or give a quiet scene a line.
4. Would this look at home in a SaaS dashboard? If most tiles are cards (titles, callouts, diagrams, summaries) rather than the product, its code, or its output, it would: trade cards for captured evidence. `monotony` warns when more than two scenes in a row show the same kind of visual, and `transition-variety` when one kind of transition covers more than 60% of the scene changes (with four or more).
5. Can a viewer read every line at a glance? `text-size` names each scene whose code is under 24 px or whose body text is under 28 px at 1080p, and `empty-frame` each card scene whose content fills less than 40% of the picture area (the media region, between the header and the captions). Show fewer and shorter lines, put more of the subject in the scene, or merge a thin scene into the next.
6. Does every claim rest on evidence? Each contact sheet tile is labeled, in a band below the frame, with its scene and the evidence it cites (`—` for none), and the `grounding` check lists scenes and explanation statements that cite nothing. Cite ids from `covi evidence --run <id> --json`; `covi render` rejects ids the run does not have, and `video/timeline.json` records each scene's evidence.

If any answer is wrong, or a scene is wrong, crowded, or not grounded in evidence, fix the storyboard, not the renderer, and render again with `covi render --run <id> --json`: it renders `video/storyboard.json` as you left it (`--storyboard <file>` renders one kept elsewhere) and reuses the voice of unchanged lines.

For narration in Korean, Japanese, or Chinese, also read `video/speech.json`: it shows the text each scene's voice was given after Covi spelled out acronyms. For the sound, read `video/audio.json` (the music's tempo, hero and logo times, how many seconds of music are heard, and the levels of the mix) with the `audio`, `music-under-speech`, `music-jump`, `music-range`, `music-fit`, `music-audible`, and `sound-effects` checks. When `music-jump` fails, the music itself jumps where `levels.musicJumps.at` says (only the opening, the hero, and the ending may move faster: `levels.musicJumps.exempt`, with the bounds in `references/music.md`): in a composed score, smooth that passage (no sudden drops or entries); with the theme, report it. When `music-audible` warns under bookends, the music is heard only around the narration: use the default placement.

## Method

**Pick the story** (`covi templates`): `bug-fix` (problem → before → fix → after → concern), `feature-demo` (what users can do now → the interaction → how it works → what to check), `before-after` (visual changes), `api-change`, `cli-change`, `architecture-explainer`, `quick-review`. Covi picks one from the change; override with `--template` when another tells the story better. A template is a suggestion, not a script: order the beats the way the evidence tells the story. Only two points are fixed: the cold open at the start and a short wrap at the end. Covi's draft is a scaffold: rewrite every line of its narration and set `"draft": false`.

**Ground every scene in evidence.** Visuals come from captures (`demo/`), the diff, and findings. Do not show a screen that was not captured or code that is not in the change. If the software could not run, tell the story with code callouts and findings instead of inventing screens. A scene that shows a capture, code from the diff, a request, a command, or a findings card cites it without listing it; give any other scene that makes a claim (a callout, a diagram) `evidenceIds` from the run's evidence. A capture's `focus` may name an element instead of a rect: `"focus": "subject:checkout#place-order"`. `covi subject --run <id>` lists the screens and elements, and which ones each head capture shows. Covi places the reference at that element's box in that capture, at the capture's viewport. It refuses (exit 2) a reference to an element the capture does not show, a base image, or a run with no `demo/subject.json`. Give a rect for those.

**Open cold.** The first scene is not a title card. Its first frame already shows the subject: the captured screen, the terminal, or the key lines of code (Covi draws the video's first scene already in place at frame 0). A short form of the title goes in its `eyebrow`; leave `heading` off, since the subject is the headline. When the subject is a captured page, a `title` visual with `background` set to that capture works too: the capture fills the frame and the title sits in the header (its `subtitle` and `meta` are not shown). Give the first scene a line, and make that line a hook: a question, a surprising fact, or the payoff. The first line starts by 0.5 s, so never open on a silent scene. Never open with "This change shows…", and never with a table of contents ("We'll look at A, B, and C").

**Name the hero.** Every video has one moment where the change clicks: the bug reproducing, the key lines side by side with the thing they fix, the after state landing. Mark that scene `"hero": true` (one per video; a second is an error) and never mark it `optional`. Covi brings it in with `zoom-through` unless you set its `transition`, holds it 0.4 s after its line, plays the hero accent at its `hero` phase (a flash under 0.2 s, one expanding ring, and a 6% camera punch, on its `sync.hero` phrase, else at the start of its line), with a riser swelling into that moment and a soft hit on it, and lands the music's lift on it. Then make it the biggest moment: the strongest capture, and the line that pays off the hook. Without `"hero": true`, Covi falls back to the template's `hero` beats (`covi templates show <id>`): the first scene playing one of them gets the music's lift, but no hold, transition, or accent.

**Let the list be the map.** When there are two to four things to check, promise them up front ("three places to look"), visit each in turn (numbered eyebrows such as "1 of 3" help the viewer keep count), and come back to strike them off. A bonus question at the end is fine when the review raised it (a `question` finding); a findings card shows only the run's findings, so record a new question with `covi-review` first. Use it when the change hands you such a list; it is a narrative device, not a template.

**Storyboard rules** (`covi schema storyboard`):

- 6–9 scenes for short-form, 10–16 for standard (a storyboard holds at most 24). Each scene lasts 2–5 seconds; the hero holds a moment longer. When a beat needs more time, split it across two scenes (an interaction's setup, then the click that matters) rather than holding one picture. Never invent a scene to reach the count: fewer scenes grounded in evidence beat more that are not.
- End on a wrap: the summary card with its verdict, its headline, and at most two short points; one short line of eight words or fewer, or none; and `minSeconds: 1.5` so the card does not outstay its line. Covi ends every video with its own outro (the fox, the logo, the verdict, and the sign-off); never write an outro scene or pad the narration with pauses.
- One idea per scene; the visual must match what the narration says at that moment.
- Give every scene an `eyebrow`; without one, the video shows the beat's id as the label.
- `narration` is what Covi says and the captions show; `say` is only for the spoken form of identifiers and paths (`useCartTotals` → "use cart totals"). Set `language` (`en`, `ko`, `ja`, `zh`) when the narration is not in English; see `references/narration.md` for acronyms and particles.
- Budget about 2.5 spoken words per second: roughly 60–75 words for a 30-second video, 150–250 for 90 seconds. In Korean count about 4 syllables per second, in Japanese about 4 characters, in Chinese about 3; the same idea takes longer to say in them, so say less. Covi times every scene from its line and never pads: the target length is a ceiling, and a video with less to say is shorter.
- Set `optional: true` on scenes that can be dropped to fit the length (never the hero).
- Expressions for the narrator: `explaining` (default), `thinking` (problems, before states), `reviewing` (findings), `warning` (serious findings), `success` (fixes that work, summaries).
- **Pin moments to words** with `sync`: a phase of the visual → a phrase quoted from the scene's `narration`, verbatim and exactly once (Covi names the scene when it is missing or repeated). That moment of the visual then lands as the phrase is spoken. Phases: screenshot `zoom`, `click`, and `mark1`… (each of its `marks`); interaction `step2`…`stepN` (step 1 starts with the scene; quote them in order), `zoom` or `click` for the step showing then, and `mark1`… counting the marks of all its steps; code `highlight` (all highlighted lines), `highlight1`… (each entry of `highlight`), and `morph` (in morph mode); before-after `reveal`; findings `finding1`…; terminal `output`; API `after`; the hero `hero`. Without a phase, the moment keeps its default place in the scene. A highlight group or a mark can name its own phase with `sync`: lowercase letters, optionally followed by digits (`fix`, `total`), at most 32 characters, and a key of the scene's `sync` (or `hero` on the hero scene).
- **Transitions** (`transition`, how the scene enters): `fade` (the default), `cut` (instant: the same subject continues), `push` (slides left: the next step of a sequence), `wipe` (uncovers left to right: before, then after), and `zoom-through` (the hero's default). Covi starts each one just before the next line, so the picture changes with the words.
- **Vary the picture.** No more than two scenes of one kind in a row (two code cards, then the output or a capture), and no one transition for more than 60% of the scene changes: `cut` when the same subject continues, `push` for the next step, `wipe` from before to after. QC's `monotony` and `transition-variety` warn otherwise.
- **The camera** (`camera`): captures drift slowly through their scene, and any other visual pushes in once it has settled while its line continues (once it has entered, when `sync` pins one of its moments later in the line, and on a diagram), so no picture holds still under narration. Set `"camera": "static"` only when a still frame is the point, such as a pixel comparison.
- **Code that changes** (`"mode": "morph"`): the card shows the old code, then at the `morph` phase the deleted lines are struck through and fade to ghosts while the added lines type in where they were. Use it when the edit itself is the point (a one-line fix, a renamed call); keep the default diff for longer hunks. A `highlight` entry (at most 40) is a line index or a group, `{ "lines": [3, 4], "sync": "fix" }`, whose lines light together at its phase (`sync` names a key of the scene's `sync`, or `hero` on the hero scene). `caption` adds a short line under the code (160 characters at most).
- **Marks** (`marks`, 1–3, on a screenshot or an interaction step): `{ "focus": { … }, "label": "Total", "sync": "total" }`; a mark's `focus` may be a `subject:` reference too. The camera zooms to the first mark and pans to each next as its phrase is spoken (`mark1`… unless the mark names its own phase), the cursor glides from mark to mark, and a mark's `label` (40 characters at most) shows under the frame while the camera is on it. Use two or three when the viewer's eye must move across the screen ("the total, then the badge"). `focus` stays the one-mark shorthand: never set both. A `click` presses after the last mark.
- **Sound cues** (`cues`, at most 4 a scene): `{ "at": "fix", "kind": "click" }` plays an effect at a phase the scene pins, or at seconds into the scene. Kinds: `click`, `reveal`, `finding`, `transition`, and on the hero only `riser` (it swells for 0.8 s and ends at `at`) and `hero`. Covi already sounds clicks, reveals, findings, the verdict, a whoosh for `push`, `wipe`, and `zoom-through`, and the hero's riser and hit; add a cue only for a moment the viewer must hear; a cue within 0.15 s of a `push`, `wipe`, or `zoom-through` replaces its whoosh. A `riser` or `hero` cue away from the `hero` phase adds a second one beside Covi's. Effects at least 0.15 s apart (the riser's quiet onset excepted) and at most three a second play; the rest are dropped (`video/audio.json` says which).
- **Diagram edges** (at most 16) take a short `label` ("calls", "reads"; 40 characters at most), drawn on the line between the two nodes: a word or two, since a longer one is cut off.
- **Code lines must fit.** Code renders as large as its lines allow, up to 48 px at 1080p in 9:16 (44 in 16:9), and QC's `text-size` warns under 24 px. That means lines of about 54 characters at most in 9:16 (about 108 in 16:9), and about 24 lines in 9:16 (14 in 16:9): Covi sizes the code to fit most of its lines, so longer lines make all of them smaller, and a line longer than most is cut off with an ellipsis. Choose lines that fit.

**Narration** (see `references/narration.md`): a calm senior engineer walking a teammate through the change. No hype means the facts are never exaggerated; tone, metaphor, and structure are yours.

- One line per scene, 15 words at most; about ten keeps a scene within five seconds.
- Build each line around one key phrase the viewer should remember, put it where the voice lands (in English, at the end), and mark it `[[…]]`: the caption sweeps it as it is spoken, and the voice and reports never see the brackets. At most one per line.
- Punctuation shapes delivery: "." settles, "?" lifts, "!" lands. Save "!" for the hero.
- Call back to the hook's keyword when the story pays it off.
- The last line is eight words or fewer, or absent: the outro carries the verdict.
- Never claim more than the evidence shows.

> Your comment now appears [[before the server answers]].
> Before this change, you waited for [[a spinner]].
> The reducer now adds the comment [[optimistically]].
> And if the server says no? It [[rolls back]].
> But [[no test]] covers the rollback.
> Add one, and it's [[ready to merge]].

## Quality bar

- Watchable without sound (captions) and without the code open.
- The first frame shows the subject and makes a viewer want to keep watching; the first line is a hook, not an agenda, and it is heard by 0.5 s.
- One hero, and it is visibly the biggest moment.
- No scene holds a still picture while the narration keeps talking.
- It looks like the software under review, not a slide deck or a SaaS dashboard: most scenes show captures, code, or output rather than cards.
- The product being demonstrated is never covered: captions and the narrator have their own areas.
- No scene claims more than the evidence shows; the review note is the most important finding or an honest "nothing blocking".
- QC passes, or every warning is understood.

## Output files

`video/storyboard.json`, `video/speech.json`, `video/timeline.json`, `video/narration.wav` (the voice), `video/music.wav` (the music as placed in the mix), `video/audio.json` (music, effects, and levels), `video/score.json` (composed music only), `video/captions.vtt` and `.srt`, `video/composition/index.html` (open it in a browser to inspect any frame), `video/covi-review.mp4`, `video/poster.png`, `video/contact-sheet.jpg`, `video/frames.json` (lets a sound-only change keep the frames), `video/qc.json`.

## Related skills

`covi-understand`, `covi-demo` (captures make the best scenes), `covi-review` (the review note comes from it). Storytelling patterns: `references/storytelling.md`. Narration: `references/narration.md`. Writing a score: `references/music.md`.
