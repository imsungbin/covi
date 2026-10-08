## Summary

Covi's review videos read like slide decks: a title card, one static card per beat, a table-of-contents opener, a long summary. This PR rewrites the `covi-video` skill so an agent authors a video the way an editor would. Prose only; no TypeScript, templates, or docs change.

- **Cold open.** The first scene shows the subject (a captured screen, terminal, or the key lines) with the title as an eyebrow; the first spoken line is a hook, never "This change shows…" or a table of contents.
- **Scenes of 2–5 seconds.** A long beat is split rather than held; 6–9 scenes short-form, 10–14 standard (the schema cap until the next PR).
- **One hero.** The scene where the change clicks, named by the template's hero beat; no earlier scene may take that beat.
- **The list is the map.** Promise "three places to look", visit each, return to strike them off; a closing question only when the review raised it.
- **Templates are suggestions.** Beat order follows the evidence; the heuristic draft is a scaffold the agent rewrites.
- **Narration boundary made explicit.** Facts are never exaggerated; tone, metaphor, and structure are free. Punctuation shapes delivery; lines ≤ 15 words; the last line ≤ 8 words or absent.
- **Self review after rendering** (agent-only `## Run it`): is the opening legible with the sound off, is the hero visibly the biggest moment, does any scene hold a still picture while narration continues, would this look at home in a SaaS dashboard — then fix the storyboard, not the renderer, and `covi render --run <id>`.
- Starts `CHANGELOG.md` (Keep a Changelog, `[Unreleased]`).

Methodology sections (`## Method`, `## Quality bar`) are what `methodologyOf` loads into model prompts, so this changes what the narration model is told as well as what agents read.

## Acceptance

An agent following only the skill rendered `examples/ui-comment-composer` in short-form: 26 s, 7 scenes (2.7–4.3 s), a captured screen as the cold open, "three things to check" as the spine, QC 18/18. The baseline render of the same example on `main` was 60 s with 24 s of speech and a 7-second still. The "One question" card in that test render was the test agent's own question; it led to the rule above that a closing question must come from the review.

## Carried to the next PR (needs code)

First line by 0.5 s (`firstLead` is 2 s today), 10–16 scenes standard, frame 0 on the contact sheet, the drafter's title-card opening, the narration model's word budget vs 15-word lines, `optional` on the bug-fix template's hero beat, a note on code line width in 9:16.

## Test plan

- [x] `npm run check` green (lint, typecheck, agents:check, 798 tests)
- [x] Acceptance render passes QC and the skill's self review
- [x] Model prompt contains the new methodology and none of the agent-only self review

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
