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

`covi render` keeps the size, length, music, and outro chosen at draft time; pass flags only to change them. `covi video --short --duration 30s` does it all in one step, but it renders Covi's draft as written; the draft is a scaffold, so draft, rewrite, then render. Use `--standard` for 16:9 reviews of 60–120 seconds, `--custom --width W --height H` for anything else, `--no-narration` for captions only, `--music none` or `--no-sound-effects` for less sound, and `--no-outro` to end on the last scene instead of Covi's outro.

**Music.** By default the Covi theme plays, arranged to the story and the verdict, with subtle sound effects for clicks, reveals, findings, and the verdict. Where it plays follows the kind of video: a quiet bed under short-form narration; in a narrated standard review, mainly in the opening, the breaths Covi leaves between lines (before the payoff's line, before the verdict, after long stretches of talk), and over the outro, where its sonic logo lands. `--music-placement continuous` keeps a quiet bed under a standard review too; `bookends` plays it only around the narration. When the result carries `video.music.hint` (nobody chose the music), tell the user in one sentence, for example: "It has the Covi theme as music; say if you'd like none or a score composed for this change." To compose:

```bash
covi video --short --duration 30s --draft --music compose --json   # also writes video/score.json (the theme, "draft": true)
# write the score in video/score.json, following references/music.md, and set "draft": false
covi render --run <id> --json
```

Music never moves frames: changing only the music or the effects (`covi render --run <id> --music none`) keeps the rendered frames and re-mixes the sound in seconds.

**Review it yourself** after every render. Open `video/contact-sheet.jpg` (a frame from the middle of each scene, the outro last) and `video/poster.png` (a frame from the opening), read `video/qc.json`, and answer in order:

1. Is the opening frame legible and intriguing with the sound off? The poster and the first tile show the subject, readable at a glance, not a title card.
2. Is the hero visibly the biggest moment? Its tile is the one you would pick as the thumbnail.
3. Does any scene hold a still picture while the narration continues? In `video/timeline.json`, a scene running past five seconds (`end` minus `start`; the hero may run a little longer, and so may the scenes of a long standard review), or a screenshot, interaction step, or before-after with no `focus` or `click` under a long line (more than about ten words), is one: split the scene, give it a `focus` or `click` to follow, or, when Covi extended the holds to reach the minimum, give it more to say rather than less.
4. Would this look at home in a SaaS dashboard? If most tiles are cards (titles, callouts, diagrams, summaries) rather than the product, its code, or its output, it would: trade cards for captured evidence.

If any answer is wrong, or a scene is wrong, crowded, or not grounded in evidence, fix the storyboard, not the renderer, and render again with `covi render --run <id> --json`: it renders `video/storyboard.json` as you left it (`--storyboard <file>` renders one kept elsewhere) and reuses the voice of unchanged lines.

For narration in Korean, Japanese, or Chinese, also read `video/speech.json`: it shows the text each scene's voice was given after Covi spelled out acronyms. For the sound, read `video/audio.json` (the music's tempo, hero and logo times, how many seconds of music are heard, and the levels of the mix) with the `audio`, `music-fit`, `music-under-speech`, `music-audible`, and `sound-effects` checks. When `music-audible` warns, the music asked for is barely heard: give the narration room (shorter lines, a scene that holds its visual), or choose `--music-placement continuous`.

## Method

**Pick the story** (`covi templates`): `bug-fix` (problem → before → fix → after → concern), `feature-demo` (what users can do now → the interaction → how it works → what to check), `before-after` (visual changes), `api-change`, `cli-change`, `architecture-explainer`, `quick-review`. Covi picks one from the change; override with `--template` when another tells the story better. A template is a suggestion, not a script: order the beats the way the evidence tells the story. Only two points are fixed: the cold open at the start and a short wrap at the end. Covi's draft is a scaffold, title card and all: rewrite every line of its narration and set `"draft": false`.

**Ground every scene in evidence.** Visuals come from captures (`demo/`), the diff, and findings. Do not show a screen that was not captured or code that is not in the change. If the software could not run, tell the story with code callouts and findings instead of inventing screens.

**Open cold.** The first scene is not a title card. Its first frame already shows the subject: the captured screen, the terminal, or the key lines of code. A short form of the title goes in its `eyebrow`; leave `heading` off, since the subject is the headline. Give it a line, and make that line a hook: a question, a surprising fact, or the payoff. Never open on a silent scene: the hook is the first line spoken. Never open with "This change shows…", and never with a table of contents ("We'll look at A, B, and C").

**Name the hero.** Every video has one moment where the change clicks: the bug reproducing, the key lines side by side with the thing they fix, the after state landing. That scene is the hero. Covi finds it by beat: it walks the template's `hero` list in order (`covi templates show <id>`) and takes the first scene playing one of those beats, and the music lifts there. So give the hero scene the first beat of that list as its `beat`, whatever it shows (viewers read the `eyebrow`, not the beat); give no earlier scene that beat; and never mark it `optional`. Then make it the biggest moment: the strongest capture, and the line that pays off the hook.

**Let the list be the map.** When there are two to four things to check, promise them up front ("three places to look"), visit each in turn (numbered eyebrows such as "1 of 3" help the viewer keep count), and come back to strike them off. A bonus question at the end is fine. Use it when the change hands you such a list; it is a narrative device, not a template.

**Storyboard rules** (`covi schema storyboard`):

- 6–9 scenes for short-form, 10–14 for standard. Each scene lasts 2–5 seconds; the hero may hold a moment longer. When a beat needs more time, split it across two scenes (an interaction's setup, then the click that matters) rather than holding one picture. A storyboard holds at most 14 scenes, so a long standard review lets its scenes run a little past five seconds. Never invent a scene to reach the count: fewer scenes grounded in evidence beat more that are not.
- End on a wrap: the summary card with its verdict, its headline, and at most two short points; one short line of eight words or fewer, or none; and `minSeconds: 1.5` so the card does not outstay its line. Covi ends every video with its own outro (the fox, the logo, the verdict, and the sign-off); never write an outro scene or pad the narration with pauses.
- One idea per scene; the visual must match what the narration says at that moment.
- Give every scene an `eyebrow`; without one, the video shows the beat's id as the label.
- `narration` is what Covi says and the captions show; `say` is only for the spoken form of identifiers and paths (`useCartTotals` → "use cart totals"). Set `language` (`en`, `ko`, `ja`, `zh`) when the narration is not in English; see `references/narration.md` for acronyms and particles.
- Budget about 2.5 spoken words per second: roughly 60–75 words for a 30-second video, 150–250 for 90 seconds. In Korean count about 4 syllables per second, in Japanese about 4 characters, in Chinese about 3; the same idea takes longer to say in them, so say less. Covi times scenes from the real narration audio and fits the total to the target.
- Set `optional: true` on scenes that can be dropped to fit the length.
- Expressions for the narrator: `explaining` (default), `thinking` (problems, before states), `reviewing` (findings), `warning` (serious findings), `success` (fixes that work, summaries).

**Narration** (see `references/narration.md`): a calm senior engineer walking a teammate through the change. No hype means the facts are never exaggerated; tone, metaphor, and structure are yours.

- One line per scene, 15 words at most; about ten keeps a scene within five seconds.
- Build each line around one key phrase the viewer should remember, and put it where the voice lands (in English, at the end).
- Punctuation shapes delivery: "." settles, "?" lifts, "!" lands. Save "!" for the hero.
- Call back to the hook's keyword when the story pays it off.
- The last line is eight words or fewer, or absent: the outro carries the verdict.
- Never claim more than the evidence shows.

> Your comment now appears before the server answers.
> Before this change, you waited for a spinner.
> The reducer now adds the comment optimistically.
> And if the server says no? It rolls back.
> But no test covers the rollback.
> Add one, and it's ready to merge.

## Quality bar

- Watchable without sound (captions) and without the code open.
- The first frame shows the subject and makes a viewer want to keep watching; the first line is a hook, not an agenda.
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
