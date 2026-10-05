# Narration

Covi narrates like a senior engineer walking a teammate through a change: calm, precise, and brief.

## Voice
- **Concise.** One idea per sentence. Most sentences under fifteen words.
- **Natural.** Spoken English, contractions welcome. Read it aloud; if you stumble, rewrite it.
- **Accurate.** Every statement matches the code, the capture, or the finding on screen at that moment.
- **Reviewer-oriented.** Explain why something matters to someone deciding whether to merge.
- **No hype.** No "amazing", "game-changing", "seamless", or marketing cadence.

## Patterns that work
- Context: "This change updates the comment flow to use optimistic updates."
- Behavior: "The comment now appears immediately while the request runs in the background."
- Evidence: "On the left is the old response, a plain array. On the right, the new paginated object."
- Review note: "One thing worth reviewing is the rollback behavior when the request fails."
- Clean result: "Covi didn't find anything blocking. Start with the cart reducer."
- Verdict: "Overall, it looks good to merge once the rollback is covered by a test."

## Patterns to avoid
- Reading code aloud: "item dot quantity equals Math dot max open paren zero…"
- Narrating the obvious: "Here we can see a screenshot."
- Overclaiming: "This fixes all cart bugs."
- Filler openers: "So, basically, in this video we're going to…"

## Spoken form
Captions show `narration`; speech uses `say` when present. Use `say` for identifiers ("use cart totals" for `useCartTotals`), file names ("the cart module" instead of `src/cart/index.ts`), and symbols. Keep the meaning identical.

## Narrating in Korean, Japanese, or Chinese
- Write the narration in that language and set the storyboard's `language` (`ko`, `ja`, or `zh`). Without it, Covi detects the language from the narration's script.
- Voices for these languages misread Latin acronyms: a Korean voice says "CLI" as 클리. Before synthesis Covi spells out all-caps acronyms of two to six letters (CLI → 씨엘아이, シーエルアイ, C L I) and the common ones said as words (JSON → 제이슨, ジェイソン). Write particles as you would for the spoken form: `CLI를`, `API는`, `JSON을`.
- Covi leaves code spans and paths alone, and it cannot guess lowercase names (`c2`, `kubectl`) or long all-caps words. Put their spoken form in `say`, or ask the user to add `video.narration.pronunciations` when the name recurs.
- Japanese voices guess each kanji's reading from context and sometimes guess wrong: Kyoko reads 空のとき ("when it is empty") as そらのとき ("when the sky"). When a short word's kanji has several readings, write it in kana in `say` (からのとき).
- After rendering, read `video/speech.json` (the text each scene's voice was given) and the `speech-acronyms` and `voice-language` checks in `video/qc.json`.

## Budget
About 2.5 spoken words per second. Leave breathing room: a 30-second video carries roughly 60–75 words of narration. In Korean, plan about 4.3 syllables per second (about 100–120 for 30 seconds); in Japanese about 4 characters per second; in Chinese about 3. QC warns when narration runs faster than 4.2 words, 7.5 Korean syllables, 7 Japanese characters, or 5.5 Chinese characters per second.
