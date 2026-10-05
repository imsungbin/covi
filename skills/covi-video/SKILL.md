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
# Draft the storyboard from Covi's evidence, then improve it
covi video --short --duration 30s --draft --json        # writes video/storyboard.json
# edit video/storyboard.json (see the method below)
covi render --run <id> --json                           # narrate, compose, render, check
```

`covi render` keeps the size, length, music, and outro chosen at draft time; pass flags only to change them. Or in one step, accepting Covi's draft: `covi video --short --duration 30s`. Use `--standard` for 16:9 reviews of 60–120 seconds, `--custom --width W --height H` for anything else, `--no-narration` for captions only, `--music none` or `--no-sound-effects` for less sound, and `--no-outro` to end on the last scene instead of Covi's outro.

**Music.** By default the Covi theme plays, arranged to the story and the verdict, with subtle sound effects for clicks, reveals, findings, and the verdict. Where it plays follows the kind of video: a quiet bed under short-form narration; in a narrated standard review, mainly in the opening, the breaths Covi leaves between lines (before the payoff's line, before the verdict, after long stretches of talk), and over the outro, where its sonic logo lands. `--music-placement continuous` keeps a quiet bed under a standard review too; `bookends` plays it only around the narration. When the result carries `video.music.hint` (nobody chose the music), tell the user in one sentence, for example: "It has the Covi theme as music; say if you'd like none or a score composed for this change." To compose:

```bash
covi video --short --duration 30s --draft --music compose --json   # also writes video/score.json (the theme, "draft": true)
# write the score in video/score.json, following references/music.md, and set "draft": false
covi render --run <id> --json
```

Music never moves frames: changing only the music or the effects (`covi render --run <id> --music none`) keeps the rendered frames and re-mixes the sound in seconds.

After rendering, **check the result yourself**: read `video/qc.json`, open `video/contact-sheet.jpg` (one frame per scene, the outro last) and `video/poster.png`. Fix the storyboard and re-render if a scene is wrong, crowded, or not grounded in evidence. For narration in Korean, Japanese, or Chinese, also read `video/speech.json`: it shows the text each scene's voice was given after Covi spelled out acronyms. For the sound, read `video/audio.json` (the music's tempo, hero and logo times, how many seconds of music are heard, and the levels of the mix) with the `audio`, `music-fit`, `music-under-speech`, `music-audible`, and `sound-effects` checks. When `music-audible` warns, the music asked for is barely heard: give the narration room (shorter lines, a scene that holds its visual), or choose `--music-placement continuous`.

## Method

**Pick the story** (`covi templates`): `bug-fix` (problem → before → fix → after → concern), `feature-demo` (what users can do now → the interaction → how it works → what to check), `before-after` (visual changes), `api-change`, `cli-change`, `architecture-explainer`, `quick-review`. Covi picks one from the change; override with `--template` when another tells the story better.

**Ground every scene in evidence.** Visuals come from captures (`demo/`), the diff, and findings. Do not show a screen that was not captured or code that is not in the change. If the software could not run, tell the story with code callouts and findings instead of inventing screens.

**Storyboard rules** (`covi schema storyboard`):

- 4–6 scenes for short-form, 6–9 for standard. First a title scene, last a summary scene. Covi ends every video with its own outro (the fox, the logo, the verdict, and the sign-off) and leaves room to breathe in standard reviews; never write an outro scene or pad the narration with pauses.
- One idea per scene; the visual must match what the narration says at that moment.
- `narration` is what Covi says and the captions show; `say` is only for the spoken form of identifiers and paths (`useCartTotals` → "use cart totals"). Set `language` (`en`, `ko`, `ja`, `zh`) when the narration is not in English; see `references/narration.md` for acronyms and particles.
- Budget about 2.5 spoken words per second: roughly 60–75 words for a 30-second video, 150–250 for 90 seconds. In Korean count about 4 syllables per second, in Japanese about 4 characters, in Chinese about 3; the same idea takes longer to say in them, so say less. Covi times scenes from the real narration audio and fits the total to the target.
- Set `optional: true` on scenes that can be dropped to fit the length.
- Expressions for the narrator: `explaining` (default), `thinking` (problems, before states), `reviewing` (findings), `warning` (serious findings), `success` (fixes that work, summaries).

**Narration voice** (see `references/narration.md`): concise, natural, technically accurate, conversational, focused on the reviewer, no hype. Speak to a teammate:

> This change updates the comment flow to use optimistic updates.
> The comment now appears immediately while the request runs in the background.
> One thing worth reviewing is the rollback behavior when the request fails.

## Quality bar

- Watchable without sound (captions) and without the code open.
- The product being demonstrated is never covered: captions and the narrator have their own areas.
- No scene claims more than the evidence shows; the review note is the most important finding or an honest "nothing blocking".
- QC passes, or every warning is understood.

## Output files

`video/storyboard.json`, `video/speech.json`, `video/timeline.json`, `video/narration.wav` (the voice), `video/music.wav` (the music as placed in the mix), `video/audio.json` (music, effects, and levels), `video/score.json` (composed music only), `video/captions.vtt` and `.srt`, `video/composition/index.html` (open it in a browser to inspect any frame), `video/covi-review.mp4`, `video/poster.png`, `video/contact-sheet.jpg`, `video/frames.json` (lets a sound-only change keep the frames), `video/qc.json`.

## Related skills

`covi-understand`, `covi-demo` (captures make the best scenes), `covi-review` (the review note comes from it). Storytelling patterns: `references/storytelling.md`. Narration: `references/narration.md`. Writing a score: `references/music.md`.
