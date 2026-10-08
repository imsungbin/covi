# Narration

Covi narrates like a calm senior engineer walking a teammate through a change: precise, brief, and never hyped.

## Voice
- **Concise.** One line per scene, one idea per line, 15 words at most. About ten words keeps a scene within five seconds.
- **One keyword.** Build each line around the one phrase the viewer should remember, and put it where the voice lands: in English, at the end of the sentence. "The comment rolls back when the request fails" lands on the failure; "When the request fails, the comment rolls back" lands on the rollback. Pick the one you mean.
- **Natural.** Spoken English, contractions welcome. Read it aloud; if you stumble, rewrite it.
- **Accurate.** Every statement matches the code, the capture, or the finding on screen at that moment. Never claim more than the evidence shows.
- **Reviewer-oriented.** Explain why something matters to someone deciding whether to merge.
- **No hype, with a clear line.** Facts are never exaggerated: no "always", "instantly", or "fixes every…" unless the evidence shows exactly that, and no "amazing", "game-changing", "seamless", or marketing cadence. Tone, metaphor, and structure are free: a question, a comparison, a dry aside, a callback.

## The first line
The first line is a hook, heard over the subject itself. Three kinds work:
- A question: "What happens to your comment when the request fails?"
- A surprising fact from the evidence: "Remove one too many, and the cart says minus one."
- The payoff: "Your comment now appears before the server answers."

Never "This change shows…", "In this video…", or a table of contents ("We'll look at the composer, the reducer, and the tests"). When there is a list of things to check, promise the count instead ("three places to look") and let the list be the map (`references/storytelling.md`).

## Delivery
- Punctuation shapes delivery: "." settles, "?" lifts, "!" lands. Save "!" for the hero, once at most.
- Call back to the hook. A video that opens on "before the server answers" can pay it off with "And if the server says no? It rolls back."
- The last line is eight words or fewer, or absent: the outro carries the verdict.

## Patterns that work
- Hook: "Your comment now appears before the server answers."
- Behavior: "Before this change, you waited for a spinner."
- Evidence: "On the left, a plain array. On the right, a paginated object."
- The map: "Three places to look." Later: "That's all three. One question left."
- Review note: "One thing worth reviewing is the rollback when the request fails."
- Clean result: "Nothing blocking. Start with the cart reducer."
- Wrap: "Cover the rollback with a test, then merge."

## Patterns to avoid
- Reading code aloud: "item dot quantity equals Math dot max open paren zero…"
- Narrating the obvious: "Here we can see a screenshot."
- Overclaiming: "This fixes all cart bugs."
- Filler openers: "So, basically, in this video we're going to…"
- Agenda openers: "We'll look at the composer, the reducer, and the tests."
- Long goodbyes: a last line that restates the review; the outro already shows the verdict.

## Spoken form
Captions show `narration`; speech uses `say` when present. Use `say` for identifiers ("use cart totals" for `useCartTotals`), file names ("the cart module" instead of `src/cart/index.ts`), and symbols. Keep the meaning identical.

## Narrating in Korean, Japanese, or Chinese
- Write the narration in that language and set the storyboard's `language` (`ko`, `ja`, or `zh`). Without it, Covi detects the language from the narration's script.
- Voices for these languages misread Latin acronyms: a Korean voice says "CLI" as 클리. Before synthesis Covi spells out all-caps acronyms of two to six letters (CLI → 씨엘아이, シーエルアイ, C L I) and the common ones said as words (JSON → 제이슨, ジェイソン). Write particles as you would for the spoken form: `CLI를`, `API는`, `JSON을`.
- Covi leaves code spans and paths alone, and it cannot guess lowercase names (`c2`, `kubectl`) or long all-caps words. Put their spoken form in `say`, or ask the user to add `video.narration.pronunciations` when the name recurs.
- Japanese voices guess each kanji's reading from context and sometimes guess wrong: Kyoko reads 空のとき ("when it is empty") as そらのとき ("when the sky"). When a short word's kanji has several readings, write it in kana in `say` (からのとき).
- One keyword per line holds in every language. Korean and Japanese sentences end on the verb, so put the key phrase just before it; in Chinese, as in English, put it at the end.
- After rendering, read `video/speech.json` (the text each scene's voice was given) and the `speech-acronyms` and `voice-language` checks in `video/qc.json`.

## Budget
About 2.5 spoken words per second. Leave breathing room: a 30-second video carries roughly 60–75 words of narration, and a five-second scene about ten. In Korean, plan about 4.3 syllables per second (about 100–120 for 30 seconds, 18 for a five-second scene); in Japanese about 4 characters per second (16 a scene); in Chinese about 3 (12 a scene). QC warns when narration runs faster than 4.2 words, 7.5 Korean syllables, 7 Japanese characters, or 5.5 Chinese characters per second.
