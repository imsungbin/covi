# PR 1: Storytelling Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `covi-video` skill so that an agent reading it authors review videos with a cold open, 2–5 second scenes, one hero, the list of things to check as a map, and a self review after rendering, then start `CHANGELOG.md`.

**Architecture:** Prose only. `skills/covi-video/SKILL.md` is product logic: its methodology sections (`## Method`, `## Quality bar`) are loaded into the narration-refinement model prompt by `methodologyOf` (`packages/core/src/resources.ts:73`, used by `packages/video/src/storyboard/model.ts:94`). Its agent-only sections (`## Run it`, `## Output files`, `## Related skills`) are not. Storytelling rules go in the methodology. The self review names commands and files a model cannot open, so it goes in `## Run it`. The reference files hold the longer guidance; of these, only `references/music.md` is loaded into a prompt (music composition).

**Tech Stack:** Markdown skills; checked by `scripts/sync-agents.ts` (`npm run agents:check`), Biome (ignores Markdown), Vitest (`npm test`).

**Spec:** `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/SPEC.md`. The binding parts are "Global constraints", "Vocabulary", and "PR 1 — Storytelling rules (skills only)".

**Worktree:** `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video`, branch `storytelling-rules`, based on `main` at `6fe59ba`. All work and commits happen there. Every command block below starts by setting `WT` to that path, because agent shells reset their working directory between calls.

## Global Constraints

Copied verbatim from SPEC.md, "Global constraints (bind every PR)":

- Follow `/Users/a10637/projects/covi/AGENTS.md` exactly (architecture rules, dependency
  direction, security model, code style, i18n catalogs ×4, derived files, test expectations).
- TypeScript on Node 22, `.ts` imports, `import type`, no enums/namespaces. Biome format.
- Code comments, commit messages, PR text, CHANGELOG: English. Comments explain why.
- No spec/plan/design documents are added to the repository. Existing product docs under
  `docs/` are updated only where they describe behavior that changed.
- `CHANGELOG.md` at the repo root, Keep a Changelog format. PR 1 creates it with
  `## [Unreleased]`; every later PR adds one concise line under Added/Changed/Fixed. No PR
  except PR 8 touches any `version` field.
- Schemas: additive only (new optional fields). A breaking change to a `schemaVersion` file
  bumps the version and updates the skill that describes it.
- Every deterministic behavior has tests (positive and negative). Rules in
  `packages/core/src/review/rules/` need a firing and a quiet test.
- Runtime components: pure functions of frame time; no Date/Math.random/CSS animation.
- Sound engine: deterministic; bump `AUDIO_ENGINE_VERSION` whenever rendered audio changes.
- Text for people goes through `templates/i18n/*.yml` (en, ko, ja, zh), never literals.
- `npm run check` green before any PR is opened. Render tests (`npm run test:render`) are
  run locally for PRs touching `packages/video` or `packages/audio`.
- Commits authored by the default git identity; no Claude authorship. Commit messages end
  with `Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh`.

PR 1 scope, verbatim from SPEC.md:

> Scope: `skills/covi-video/SKILL.md`, `skills/covi-video/references/*.md`, `CHANGELOG.md`
> (created). Optionally `templates/i18n/*.yml` only if a user-facing string must change.
> No TypeScript changes. Remember skills are loaded into model prompts (`methodologyOf`), so
> wording is product logic; agent-only sections keep their reserved headings.

PR 1 must not mention the `[[…]]` caption markup, `hero: true`, `sync`, `transition`, or `camera`. Those arrive with PR 2's schema and renderer.

## Decisions (where the spec leaves a choice, or the code constrains it)

1. **The first line's 0.5 s start is not promised in PR 1.** Narrated standard reviews still wait 2 s before the first line (`BREATHING.firstLead`, `packages/video/src/timeline/build.ts:96`), and a storyboard cannot change that. The skill says the hook is the first thing heard, with nothing silent before it. PR 2 adds the 0.5 s figure when it shortens the lead.
2. **Scene counts are 6–9 (short) and 10–14 (standard) until PR 2.** The schema caps a storyboard at 14 scenes (`packages/video/src/storyboard/schema.ts:212`). Standard reviews default to 80 s (`packages/video/src/spec.ts:67`), and 14 scenes of 5 s or less cannot fill that. The skill therefore says a long standard review lets its scenes run a little past five seconds. PR 2 changes this to 10–16.
3. **The wrap is the summary card with `minSeconds: 1.5`, and its line is eight words or fewer, or there is none.** Without `minSeconds`, a summary card holds at least 3.4 s (`minSecondsFor`, `build.ts:118`). An eight-word line takes about 3.5 s, so "about two seconds" holds only when the wrap is silent or very short. The skill says "about two seconds" and accepts that.
4. **The hero is named by beat, with one simple rule.** Covi walks the template's `hero` list in order and takes the first scene that plays any of those beats (`heroScene`, `packages/video/src/templates.ts:80`). The rule is: give the hero scene the list's first beat, give no earlier scene that beat, and never mark the hero `optional`. The drafter marks bug-fix's `proof` scene optional, and the fitter drops optional scenes first. Beats are free strings, and viewers read the `eyebrow`, so a scene may carry a beat name that does not describe it.
5. **Every scene sets `eyebrow`.** The timeline shows the beat id when `eyebrow` is missing (`build.ts:313`). Split scenes with invented beat ids would otherwise show those ids on screen.
6. **The self review uses the artifacts that exist in PR 1.** The contact sheet samples each scene's midpoint, and `poster.png` is taken about 1.6 s in (`packages/video/src/render/renderer.ts:139-153`). These stand in for "frame 0" until PR 2 adds a 0.3 s sample. Still pictures are judged from `video/timeline.json` scene lengths, and from screenshots that have no `focus` or `click`.
7. **The re-render command is `covi render --run <id> --json`.** It renders the run's `video/storyboard.json` as edited. `--storyboard <file>` is named only for a storyboard kept elsewhere (`packages/cli/src/main.ts:743-747`, `packages/cli/src/workflows.ts:707`).
8. **The one-step `covi video` stays documented, labelled as rendering Covi's draft as written.** Rule 6 makes the draft a scaffold that an agent rewrites.
9. **Not touched:** `skills/covi/SKILL.md` (its routing and its `covi render --run <id>` row stay accurate), `templates/stories/*.yml` (every first beat is still a `title`, and the cold open replaces that drafted scene), `templates/i18n/*.yml` (no user-facing string changes), `docs/` (no behavior changes; `docs/video.md` describes the drafter, which is unchanged), and every `.ts` file.
10. **`CHANGELOG.md`** follows the Keep a Changelog 1.1.0 header, with an `## [Unreleased]` section that has one `### Changed` line. It has no link references, because there is no released tag to compare against yet; PR 8 can add them.

## Review Focus

1. **Agent-only text leaking into the model prompt.** The self review names `covi render`, `contact-sheet.jpg`, and `timeline.json`. If it lands outside `## Run it`, the narration model is told to open files it cannot open. The check is Task 2 Step 3: the methodology output must contain none of those strings.
2. **Advice the current schema or CLI rejects.** More than 14 scenes, PR 2 fields, or a wrap or cold open shape that fails validation would make the agent's render exit 2. The checks are Task 1 Step 4 (a sample storyboard built the way the skill says validates, and 15 scenes do not) and Task 1 Step 5 (no PR 2 vocabulary).
3. **The skill's own examples breaking its rules:** lines over 15 words, a last line over 8, or an agenda opener shown as good. The checks are Task 1 Step 3 (blockquote word counts) and Task 3 Step 5 (quoted examples in the references).
4. **Stale guidance left in the references** that contradicts SKILL.md: a title card first, 4–6 scenes, "code at least 3–4 seconds", "over the title card", "This change updates…" as a pattern that works, or a 14-word verdict line. The check is Task 3 Step 4 (stale-phrase scan).
5. **A misidentified hero:** an earlier scene carries the hero beat, the hero is optional and gets dropped, or the storytelling reference names the wrong beat for a template. The checks are Task 1 Step 4 (`heroScene` on a sample, with and without `proof`) and Task 3 Step 6 (hero beats named in `storytelling.md` match `covi templates show <id>`).

---

### Task 1: Storytelling method and quality bar in SKILL.md

**Files:**
- Modify: `skills/covi-video/SKILL.md`. Replace lines 53–79, everything from the line `## Method` up to, but not including, the line `## Output files`.

**Interfaces:**
- Consumes: nothing.
- Produces: the vocabulary that Tasks 2–4 reuse word for word: **Open cold** / "cold open" / "hook"; **Name the hero** / "the hero" (named by giving the scene the first beat of the template's `hero` list; no earlier scene with that beat; never `optional`); **Let the list be the map** ("three places to look", numbered eyebrows "1 of 3"); "wrap" (the summary card, about two seconds, a line of eight words or fewer or none, `minSeconds: 1.5`); "2–5 seconds" per scene; "6–9" short-form and "10–14" standard scenes; "15 words at most", "about ten keeps a scene within five seconds"; "a calm senior engineer"; "No hype means the facts are never exaggerated; tone, metaphor, and structure are yours."

- [ ] **Step 1: Confirm the starting point**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git status --short && git log --oneline -1 && sed -n '53p;79,81p' skills/covi-video/SKILL.md
```

Expected: a clean tree, `6fe59ba` (or a later commit of this plan), line 53 `## Method`, line 79 `- QC passes, or every warning is understood.`, a blank line, and line 81 `## Output files`.

- [ ] **Step 2: Replace the `## Method` and `## Quality bar` sections**

Replace everything from the line `## Method` through the line `- QC passes, or every warning is understood.` with exactly the following block. Keep the blank line that follows it and the `## Output files` section unchanged.

```markdown
## Method

**Pick the story** (`covi templates`): `bug-fix` (problem → before → fix → after → concern), `feature-demo` (what users can do now → the interaction → how it works → what to check), `before-after` (visual changes), `api-change`, `cli-change`, `architecture-explainer`, `quick-review`. Covi picks one from the change; override with `--template` when another tells the story better. A template is a suggestion, not a script: order the beats the way the evidence tells the story. Only two points are fixed: the cold open at the start and a short wrap at the end. Covi's draft is a scaffold, title card and all: rewrite every line of its narration and set `"draft": false`.

**Ground every scene in evidence.** Visuals come from captures (`demo/`), the diff, and findings. Do not show a screen that was not captured or code that is not in the change. If the software could not run, tell the story with code callouts and findings instead of inventing screens.

**Open cold.** The first scene is not a title card. Its first frame already shows the subject: the captured screen, the terminal, or the key lines of code. A short form of the title goes in its `eyebrow`; leave `heading` off, since the subject is the headline. Its line is the first thing the viewer hears, with nothing silent before it, and it is a hook: a question, a surprising fact, or the payoff. Never open with "This change shows…", and never with a table of contents ("We'll look at A, B, and C").

**Name the hero.** Every video has one moment where the change clicks: the bug reproducing, the key lines side by side with the thing they fix, the after state landing. That scene is the hero. Covi finds it by beat: it walks the template's `hero` list in order (`covi templates show <id>`) and takes the first scene playing one of those beats, and the music lifts there. So give the hero scene the first beat of that list as its `beat`, whatever it shows (viewers read the `eyebrow`, not the beat); give no earlier scene that beat; and never mark it `optional`. Then make it the biggest moment: the strongest capture, and the line that pays off the hook.

**Let the list be the map.** When there are two to four things to check, promise them up front ("three places to look"), visit each in turn (numbered eyebrows such as "1 of 3" help the viewer keep count), and come back to strike them off. A bonus question at the end is fine. Use it when the change hands you such a list; it is a narrative device, not a template.

**Storyboard rules** (`covi schema storyboard`):

- 6–9 scenes for short-form, 10–14 for standard. Each scene lasts 2–5 seconds; the hero may hold a moment longer. When a beat needs more time, split it across two scenes (an interaction's setup, then the click that matters) rather than holding one picture. A storyboard holds at most 14 scenes, so a long standard review lets its scenes run a little past five seconds. Never invent a scene to reach the count: fewer scenes grounded in evidence beat more that are not.
- End on a wrap of about two seconds: the summary card with its verdict, its headline, and at most two short points; a line of eight words or fewer, or none; and `minSeconds: 1.5` so the card does not outstay its line. Covi ends every video with its own outro (the fox, the logo, the verdict, and the sign-off); never write an outro scene or pad the narration with pauses.
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
```

- [ ] **Step 3: Check that the methodology reaches the model prompt and that the examples obey the rules**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npm run agents:check
cd "$WT" && node -e 'import("./packages/core/src/resources.ts").then(async (m) => console.log(m.methodologyOf(await m.loadSkill("covi-video"))))' \
  | grep -c -e '\*\*Open cold\.\*\*' -e '\*\*Name the hero\.\*\*' -e '\*\*Let the list be the map\.\*\*' -e '^## Quality bar' -e 'First a title scene'
cd "$WT" && grep '^> ' skills/covi-video/SKILL.md | awk '{ n = NF - 1; print n ": " $0; if (n > 15) bad = 1 } END { exit bad }'
cd "$WT" && grep '^> ' skills/covi-video/SKILL.md | tail -1 | awk '{ exit (NF - 1 > 8) }' && echo "last line ok"
```

Expected:
- `Agent packaging is in sync.`
- `4`: the three new paragraphs and `## Quality bar`; `First a title scene` is gone.
- Six example lines with word counts 8, 8, 7, 9, 6, 7, and exit 0.
- `last line ok`.

- [ ] **Step 4: Check that the shape the skill prescribes validates and that the hero rule matches `heroScene`**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && node --input-type=module -e '
import { StoryboardSchema } from "./packages/video/src/storyboard/schema.ts";
import { heroScene } from "./packages/video/src/templates.ts";
const img = { path: "demo/screenshots/a.png" };
const shot = (beat, eyebrow, narration, extra = {}) => ({ beat, eyebrow, narration, visual: { kind: "screenshot", image: img }, ...extra });
const scenes = [
  shot("problem", "Negative cart totals", "Remove one too many, and the cart says minus one."),
  { beat: "fix", eyebrow: "The fix", narration: "One clamp keeps every quantity at zero or above.", visual: { kind: "code", path: "src/cart.js", lines: [{ type: "add", text: "qty = Math.max(0, qty);" }] } },
  shot("fix-detail", "The fix", "Undo now restores the clamped value."),
  shot("proof", "After", "Same clicks, and the cart stops at zero!", { expression: "success" }),
  { beat: "review", eyebrow: "Worth a look", narration: "Worth a look: what undo restores.", visual: { kind: "callout", title: "Undo after a clamp" } },
  { beat: "summary", eyebrow: "Summary", narration: "", minSeconds: 1.5, visual: { kind: "summary", verdict: "looks-good", headline: "Clamp at zero" } },
];
const r = StoryboardSchema.safeParse({ title: "Cart totals", template: "bug-fix", draft: false, scenes });
console.log("valid:", r.success, r.success ? "" : JSON.stringify(r.error.issues));
console.log("hero:", heroScene(scenes, ["proof", "fix"]));
console.log("hero without proof:", heroScene(scenes.filter((s) => s.beat !== "proof"), ["proof", "fix"]));
const many = Array.from({ length: 15 }, (_, i) => shot("b" + i, "E", "Line."));
console.log("15 scenes valid:", StoryboardSchema.safeParse({ title: "x", template: "bug-fix", scenes: many }).success);
'
```

Expected:
```
valid: true 
hero: 3
hero without proof: 1
15 scenes valid: false
```

The cold-open screenshot carries an eyebrow and no heading, the silent wrap carries `minSeconds: 1.5`, and the storyboard validates. The `proof` scene is the hero even though an earlier scene plays `fix`. With no `proof` scene, the first `fix` scene is the hero. The 14-scene cap that the skill states is real. Commit nothing from this step; it is a check run with `node -e`, not a file.

- [ ] **Step 5: Check that no PR 2 vocabulary leaked in**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && grep -nE '\[\[|hero: true|`sync`|`transition`|`camera`|10–16' skills/covi-video/SKILL.md; echo "exit=$?"
```

Expected: no matches and `exit=1`.

- [ ] **Step 6: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add skills/covi-video/SKILL.md && git commit -F - <<'EOF'
Teach covi-video the storytelling rules for review videos

Videos open cold on the subject with a hook, run 2-5 second scenes,
name one hero scene by its template beat, use the list of things to
check as the story's map, and end on a short wrap. Templates become
suggestions and Covi's draft a scaffold to rewrite. The narration
persona keeps "no hype" and draws the line at exaggerated facts.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---

### Task 2: Self review after rendering, in `## Run it`

**Files:**
- Modify: `skills/covi-video/SKILL.md`, inside `## Run it` only (lines 30–51 before Task 1; the section itself is unchanged by Task 1).

**Interfaces:**
- Consumes: from Task 1, the terms "the hero", "cold open"/"title card", and "2–5 seconds" ("five seconds"), plus the rule that the draft is a scaffold.
- Produces: the self-review block that Task 4 follows verbatim: the four ordered questions and the re-render command `covi render --run <id> --json` (with `--storyboard <file>` for a storyboard kept elsewhere).

- [ ] **Step 1: Make the draft step say "rewrite"**

In the code block under `## Run it`, replace:

```
# edit video/storyboard.json (see the method below)
```

with:

```
# rewrite video/storyboard.json (see the method below)
```

- [ ] **Step 2: Label the one-step form as rendering the draft unrewritten, and add the self review**

Replace this exact sentence:

```
Or in one step, accepting Covi's draft: `covi video --short --duration 30s`.
```

with:

```
`covi video --short --duration 30s` does it all in one step, but it renders Covi's draft as written; the draft is a scaffold, so draft, rewrite, then render.
```

Then replace this exact text, which is the start of the last paragraph of `## Run it`:

```
After rendering, **check the result yourself**: read `video/qc.json`, open `video/contact-sheet.jpg` (one frame per scene, the outro last) and `video/poster.png`. Fix the storyboard and re-render if a scene is wrong, crowded, or not grounded in evidence. For narration in Korean
```

with:

```
**Review it yourself** after every render. Open `video/contact-sheet.jpg` (a frame from the middle of each scene, the outro last) and `video/poster.png` (a frame from the opening), read `video/qc.json`, and answer in order:

1. Is the opening frame legible and intriguing with the sound off? The poster and the first tile show the subject, readable at a glance, not a title card.
2. Is the hero visibly the biggest moment? Its tile is the one you would pick as the thumbnail.
3. Does any scene hold a still picture while the narration continues? In `video/timeline.json`, a scene running past five seconds (`end` minus `start`; the hero may run a little longer), or a screenshot with no `focus` or `click` under a long line, is one: split the scene or shorten its line.
4. Would this look at home in a SaaS dashboard? If most tiles are cards (titles, callouts, diagrams, summaries) rather than the product, its code, or its output, it would: trade cards for captured evidence.

If any answer is wrong, or a scene is wrong, crowded, or not grounded in evidence, fix the storyboard, not the renderer, and render again with `covi render --run <id> --json`: it renders `video/storyboard.json` as you left it (`--storyboard <file>` renders one kept elsewhere) and synthesizes only the lines that changed.

For narration in Korean
```

The rest of that paragraph, from `, Japanese, or Chinese, also read video/speech.json` through the `music-audible` sentence, stays as it is.

- [ ] **Step 3: Check that the self review stays out of the model prompt and that the commands are real**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npm run agents:check
cd "$WT" && node -e 'import("./packages/core/src/resources.ts").then(async (m) => console.log(m.methodologyOf(await m.loadSkill("covi-video"))))' \
  | grep -c -e 'Review it yourself' -e 'contact-sheet' -e 'covi render' -e 'timeline.json'
cd "$WT" && ./bin/covi.mjs render --help | grep -e '--run <id>' -e '--storyboard <file>'
cd "$WT" && grep -c -e '^\*\*Review it yourself\*\*' -e '^1\. Is the opening frame' -e '^4\. Would this look at home in a SaaS dashboard' -e 'For narration in Korean, Japanese, or Chinese, also read' skills/covi-video/SKILL.md
```

Expected:
- `Agent packaging is in sync.`
- `0`. grep exits 1 here; that is the expected result.
- Two help lines, one with `--run <id>` and one with `--storyboard <file>`.
- `4`.

- [ ] **Step 4: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add skills/covi-video/SKILL.md && git commit -F - <<'EOF'
Add a self review after every covi-video render

The agent answers four questions from the contact sheet, the poster,
qc.json, and timeline.json, fixes the storyboard rather than the
renderer, and renders again with covi render --run <id>. The one-step
covi video form is described as rendering Covi's draft as written.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---

### Task 3: Align the references with the rules

**Files:**
- Modify (full replacement): `skills/covi-video/references/storytelling.md`
- Modify (full replacement): `skills/covi-video/references/narration.md`. The `## Spoken form` section and the existing four bullets of `## Narrating in Korean, Japanese, or Chinese` are carried over word for word below.
- Modify: `skills/covi-video/references/music.md:9` (one phrase)

**Interfaces:**
- Consumes: from Task 1, "cold open", "hook", "hero" (named by the template's first hero beat), "the list is the map" with "1 of 3" eyebrows, "wrap", "2–5 seconds", "6–9" and "10–14" scenes, "15 words", "about ten", "eight words or fewer", and "No hype means the facts are never exaggerated".
- Produces: hero beat names per template, which must equal the first entry of each template's `hero` list: bug-fix `proof`, feature-demo `interaction`, before-after `compare`, api-change `exchange`, cli-change `run`, architecture-explainer `map`.

- [ ] **Step 1: Replace `skills/covi-video/references/storytelling.md` with exactly:**

````markdown
# Storytelling patterns

A review video is a walkthrough that starts in the middle: open on the thing itself, show it, say why it matters, say what to check, and stop. The templates in `covi templates` encode the patterns below as beats. They are suggestions: order the beats the way the evidence tells the story, keeping only the two fixed points, the cold open first and a short wrap last. This page explains the thinking behind them so you can adapt when no template fits.

## What every video shares

- **A cold open.** The first frame shows the subject: the captured screen, the terminal, or the key lines, with a short form of the title as the eyebrow. The first line is a hook: a question ("What happens to your comment when the request fails?"), a surprising fact from the evidence ("Remove one too many, and the cart says minus one."), or the payoff ("Your comment now appears before the server answers."). Never "This change shows…", and never a table of contents.
- **One hero.** The moment the change clicks: the bug reproducing, the key lines side by side with the thing they fix, the after state landing. Give it the template's first hero beat (named in each pattern below), the strongest capture, and the line that pays off the hook. The beat is only how Covi finds the hero; viewers read the eyebrow.
- **Short scenes.** Two to five seconds each. A beat that needs longer becomes two scenes: an interaction's setup, then the click; the fix in one file, then the other; before, then after.
- **A short wrap.** The summary card with `minSeconds: 1.5` and one line of eight words or fewer, or none: Covi's outro carries the verdict.

## The list is the map

When a change leaves two to four things to check, let them structure the video. Promise them up front, visit each, and come back to strike them off:

1. "There are three places this could break." (the hook, over the riskiest lines or the change map)
2. One scene per place, with the eyebrows "1 of 3", "2 of 3", and "3 of 3".
3. "All three hold up. One question left: what about offline?" (the return, then a bonus question if there is one)

Use it only when the change hands you the list. A video with one thing to check needs no map.

## Bug fix
1. **Cold open**: the bug on the base revision, as a screenshot, terminal output, or API response that shows the wrong behavior. Hook: "Remove one too many, and the cart says minus one."
2. **The fix**: the two or three lines that matter, highlighted. Say why they work, not what they say. Two files, two scenes.
3. **After**, the hero (beat `proof`): the same steps on head, now correct. Without an after capture, the fix lines are the hero: give that scene the beat `proof`.
4. **Worth a look**: the regression risk ("clamping at zero changes what undo restores").
5. **Wrap**: the verdict in a few words.

## New feature
1. **Cold open**: the new behavior on head, mid-interaction. Hook: the payoff, or the question it answers.
2. **Before** (optional): the old workflow, briefly, only if the contrast helps.
3. **See it**, the hero (beat `interaction`): the key interaction with the cursor and clicks, one or two steps per scene.
4. **How it works**: the one implementation detail reviewers need.
5. **Worth a look**: the edge case or finding to check.
6. **Wrap**.

## Visual change
1. **Cold open**: the after state, with the changed region in focus.
2. **Before / after**, the hero (beat `compare`): both versions with the changed region highlighted (the pixel diff provides the focus).
3. **Up close** (optional): zoom into the region, or show another viewport.
4. **The styles** (optional): the rules responsible.
5. **Worth a look**: accessibility, responsive, or consistency concerns.
6. **Wrap**.

## API change
1. **Cold open**: the new response, with the field that changed. Hook: what the captured bodies show ("The old response listed five entries; the new one pages them.").
2. **Request / response**, the hero (beat `exchange`): the real responses before and after; Covi highlights changed lines.
3. **Handler** (optional): the lines that produce the new behavior.
4. **Compatibility**: who could break and what to verify.
5. **Wrap**.

## CLI change
1. **Cold open**: the command's new output.
2. **Run it**, the hero (beat `run`): the same command before and after.
3. **The change**: the lines responsible.
4. **Worth a look**: input handling, output compatibility for scripts.
5. **Wrap**.

## Architecture explainer
Only for large restructurings with nothing to click.
1. **Cold open**: the key seam's lines, or the change map, with the question the restructuring answers.
2. **The shape**, the hero (beat `map`): modules and how they relate now (diagram or change map).
3. **Key seam**: the interface or boundary that matters most.
4. **Worth a look**: where behavior could have changed by accident.
5. **Wrap**: the verdict, and where to start reading.

## Pacing
- Short-form (9:16, 20–35 s): six to nine scenes, one idea each, the review note always included.
- Standard (16:9, 60–120 s): ten to fourteen scenes, with room for before states, implementation detail, and a second finding. A storyboard holds at most 14 scenes, so a long standard review lets its scenes run a little past five seconds.
- Covi holds each visual long enough to read it, whatever the line, so a long code excerpt or an interaction with more than two steps runs past five seconds. Show fewer lines, or split the steps across scenes.
````

- [ ] **Step 2: Replace `skills/covi-video/references/narration.md` with exactly:**

````markdown
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
- Clean result: "Covi didn't find anything blocking. Start with the cart reducer."
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
````

- [ ] **Step 3: Edit `skills/covi-video/references/music.md` line 9**

Replace the exact phrase:

```
(the intro, or the first loop, over the title card)
```

with:

```
(the intro, or the first loop, over the opening scene)
```

Nothing else in `music.md` changes. It is loaded into the composition prompt, and `packages/video/test/compose.test.ts` pins its section headings, which this edit leaves alone.

- [ ] **Step 4: Scan for stale guidance**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && grep -rnE 'First a title scene|4–6 scenes|6–9 for standard|code at least 3–4|over the title card|This change updates|Overall, it looks good to merge|\(title\):' skills/covi-video; echo "exit=$?"
cd "$WT" && grep -rn 'title card' skills/covi-video
```

Expected: the first command prints nothing and `exit=1`. The second prints only lines that present a title card as the thing to avoid or replace: in `SKILL.md`, "title card and all", "The first scene is not a title card", and self-review question 1 ("not a title card"). It prints none from the references.

- [ ] **Step 5: Check example lengths in the references**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && node -e 'const fs=require("fs");let bad=0;for(const f of process.argv.slice(1)){for(const m of fs.readFileSync(f,"utf8").matchAll(/"([^"]+)"/g)){const n=m[1].trim().split(/\s+/).length;if(n>15){bad=1;console.log(f,n,m[1])}}}process.exit(bad)' skills/covi-video/references/narration.md skills/covi-video/references/storytelling.md; echo "exit=$?"
```

Expected: nothing printed before `exit=0`. No quoted example exceeds 15 words.

- [ ] **Step 6: Check the hero beats named in `storytelling.md` against the templates**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && for t in bug-fix feature-demo before-after api-change cli-change architecture-explainer; do printf '%s ' "$t"; ./bin/covi.mjs templates show "$t" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hero[0]))'; done
cd "$WT" && grep -o 'the hero (beat `[a-z-]*`)' skills/covi-video/references/storytelling.md
```

Expected: the first command prints `bug-fix proof`, `feature-demo interaction`, `before-after compare`, `api-change exchange`, `cli-change run`, and `architecture-explainer map`. The second prints, in this order: `the hero (beat `proof`)`, `the hero (beat `interaction`)`, `the hero (beat `compare`)`, `the hero (beat `exchange`)`, `the hero (beat `run`)`, and `the hero (beat `map`)`.

- [ ] **Step 7: Run the music methodology test and the agent check**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npm run agents:check && npx vitest run packages/video/test/compose.test.ts
```

Expected: `Agent packaging is in sync.`, and every test in `compose.test.ts` passes.

- [ ] **Step 8: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add skills/covi-video/references/storytelling.md skills/covi-video/references/narration.md skills/covi-video/references/music.md && git commit -F - <<'EOF'
Align covi-video references with the storytelling rules

storytelling.md opens every pattern cold, names each template's hero
beat, and adds the list-as-map device; narration.md adds hooks,
keyword placement, punctuation, and the last-line limit; music.md no
longer assumes a title card under the first two seconds.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---

### Task 4: Acceptance render from the skill alone

This task tests the spec's second acceptance criterion: a reader of SKILL.md can author a storyboard with a cold open, 2–5 s scenes, a hero, and a list map without reading the spec. **Do not read SPEC.md or this plan's Tasks 1–3 for guidance. Use only `skills/covi-video/SKILL.md` and its `references/`.** The task also produces the contact sheet that the controller shares with the user. It commits only if the walkthrough exposes wording that misled you.

**Files:**
- Read: `skills/covi-video/SKILL.md`, `skills/covi-video/references/storytelling.md`, `skills/covi-video/references/narration.md`
- Create, outside the repository: `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/pr1-accept/` (the example repository and its run)
- Modify only if needed: the three skill files above

**Interfaces:**
- Consumes: Task 1's method and Task 2's self review, followed literally.
- Produces: the run directory path, the `video/contact-sheet.jpg` path, and the answers to the four self-review questions, all reported to the controller.

- [ ] **Step 1: Create the example and draft**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
EX=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/pr1-accept
test ! -e "$EX" || { echo "$EX exists; pick a new directory name"; exit 1; }
cd "$WT" && ./bin/covi.mjs examples create ui-comment-composer --into "$EX/repo"
cd "$WT" && ./bin/covi.mjs video --repo "$EX/repo" --short --duration 30s --draft --json > "$EX/draft.json"; echo "exit=$?"
node -e 'const r=require(process.argv[1]);console.log(r.runDir)' "$EX/draft.json"
```

Expected: `exit=0` and a run directory under `$EX/repo/.covi/runs/`. Call it `RUN` from here on. The example is static (`app.static: .`), so no trust prompt appears.

- [ ] **Step 2: Rewrite the storyboard by following the skill**

Read `$RUN/video/storyboard.json` (Covi's draft: five scenes, a title card first, opening on "This change shows…"), `$RUN/demo/captures.json` (desktop and mobile before/after shots and the "Write a comment" flow), `$RUN/explanation.json`, and `$RUN/diff.patch`. The change adds a character counter to the comment composer, blocks empty or overlong comments, and warns near the limit. Following only SKILL.md's `## Method`, rewrite `$RUN/video/storyboard.json` so that it has:
- a cold open on a captured screen of the composer with the counter, a short title as the `eyebrow`, no `heading`, and a hook line;
- 6–9 scenes in total, each with an `eyebrow`;
- the hero on the beat that `covi templates show feature-demo` lists first under `hero`, with no earlier scene carrying that beat and the hero not `optional`;
- a list map over the three behaviors to check (the counter, blocking empty or overlong comments, the near-limit warning): the promise, eyebrows "1 of 3" to "3 of 3", and the return;
- a wrap on the summary card with `minSeconds: 1.5` and a line of eight words or fewer, or none;
- `"draft": false`, every line 15 words or fewer, and nothing claimed beyond the captures and the diff.

Use only image paths listed in `captures.json`.

- [ ] **Step 3: Render**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
EX=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/pr1-accept
cd "$WT" && ./bin/covi.mjs render --repo "$EX/repo" --run latest --json > "$EX/render.json"; echo "exit=$?"
```

Expected: `exit=0`. An exit of 2 means the storyboard does not validate: read the message in `$EX/render.json` and the stderr output. If the skill's wording led you there (for example, it implied a field or a limit the schema rejects), that is a finding. Fix the skill wording in Step 6.

- [ ] **Step 4: Measure the result**

```bash
RUN="<the run directory from Step 1>"
node -e 'const t=require(process.argv[1]);for(const s of t.scenes)console.log(s.id.padEnd(12),s.beat.padEnd(14),s.visual.kind.padEnd(13),(s.end-s.start).toFixed(2))' "$RUN/video/timeline.json"
node -e 'const q=require(process.argv[1]);console.log("qc:",q.status);for(const c of q.checks)if(c.status!=="pass")console.log(c.status,c.id,c.message)' "$RUN/video/qc.json"
```

Expected:
- The first scene's visual kind is not `title`.
- Every scene except the hero and `covi:outro` lasts between 2.0 and 5.0 s. Short-form uses tight pacing, so this is reachable. If the fitter extended holds to reach the 20 s minimum, its note appears in the render result; record it.
- The summary scene lasts about 1.5–2 s.
- `qc:` is `pass` or `warn`, and no check is `fail`.

- [ ] **Step 5: Self review exactly as SKILL.md's `## Run it` says**

Open `$RUN/video/contact-sheet.jpg` and `$RUN/video/poster.png` with the Read tool. Answer the four questions in order, one sentence each, citing what you saw. If an answer is wrong, fix the storyboard (not the renderer), render again with the same command as in Step 3, and repeat Steps 4–5. Allow at most two re-renders. If it is still wrong after that, report it.

- [ ] **Step 6: Fix the skill only where it misled you**

If any rule was ambiguous, contradicted another, or produced an invalid storyboard, make the smallest wording fix in the skill file concerned. Then re-run Task 1 Step 3, Task 2 Step 3, and Task 3 Steps 4–5. Then commit:

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add skills/covi-video && git commit -F - <<'EOF'
Clarify covi-video storytelling rules after a test render

<one or two sentences naming each rule that misled and how it now reads>

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

If nothing misled you, commit nothing. Report these to the controller: the run directory, the contact sheet path, the timeline table from Step 4, the QC non-pass lines, and the four answers.

---

### Task 5: Start the changelog and run the full check

**Files:**
- Create: `CHANGELOG.md` (repository root)

**Interfaces:**
- Consumes: Tasks 1–4 committed.
- Produces: `CHANGELOG.md` with `## [Unreleased]` and a `### Changed` section, which PRs 2–8 append to.

- [ ] **Step 1: Create `CHANGELOG.md` with exactly:**

```markdown
# Changelog

All notable changes to Covi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The `covi-video` skill now tells review videos as stories: a cold open on the subject with a hook for a first line, 2–5 second scenes, one hero moment, the list of things to check as the map, and a self review of every render.
```

- [ ] **Step 2: Run the full check**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npm run check; echo "exit=$?"
```

Expected: `exit=0`. Lint (Biome ignores Markdown) and typecheck are unchanged. `agents:check` prints `Agent packaging is in sync.` All Vitest suites pass, including `tests/english-baseline.test.ts` (unaffected: no drafter, template, or catalog change), `tests/architecture.test.ts` (agent packaging), `tests/cli.test.ts` (skills install copies `references/`), and `packages/video/test/compose.test.ts`. Demo tests need Playwright Chromium, which is installed under `~/Library/Caches/ms-playwright`. If any test fails, report the failing test and its output to the controller. Do not skip or edit tests: PR 1 changes no TypeScript.

- [ ] **Step 3: Confirm the branch touches only the allowed files**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add CHANGELOG.md && git diff --cached --name-only main && git status --short
```

Expected, the list of changed files against `main`:
```
CHANGELOG.md
skills/covi-video/SKILL.md
skills/covi-video/references/music.md
skills/covi-video/references/narration.md
skills/covi-video/references/storytelling.md
```

`git status --short` shows only `A  CHANGELOG.md`. Nothing appears under `docs/`, `templates/`, `packages/`, `.claude`, or `.agents`, and there is no plan or spec file.

- [ ] **Step 4: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git commit -F - <<'EOF'
Start a changelog

Keep a Changelog format, with the covi-video storytelling rules as the
first entry under Unreleased.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
cd "$WT" && git log --format='%h %an <%ae> %s' main..HEAD
```

Expected: four commits (five if Task 4 committed a fix), all authored by the default git identity (`SeongBeen Im`), with no `Co-Authored-By` line. Each message ends with the `Claude-Session:` line.

---

## Self-review against the spec

| PR 1 rule | Where |
|---|---|
| 1 Cold open, hook, banned openers | Task 1 (`**Open cold.**`), Task 3 (storytelling "What every video shares", narration "The first line"); the 0.5 s start is deferred to PR 2 (Decision 1) |
| 2 Scenes 2–5 s, split long beats, 10–16 / 6–9 with ≤14 until PR 2 | Task 1 (Storyboard rules, first bullet), Task 3 (Pacing); Decision 2 |
| 3 One keyword per line, no `[[…]]` | Task 1 (Narration bullets), Task 3 (narration "One keyword"); Task 1 Step 5 checks for markup |
| 4 One hero, named by beat | Task 1 (`**Name the hero.**`), Task 3 (hero beats per pattern); Task 1 Step 4 and Task 3 Step 6 |
| 5 The list is the map | Task 1 (`**Let the list be the map.**`), Task 3 ("The list is the map"); Task 4 exercises it |
| 6 Templates are suggestions; cold open and ≤2 s wrap fixed; draft is a scaffold | Task 1 (Pick the story, wrap bullet), Task 2 Step 2 (one-step form); Decision 3 |
| 7 Persona and boundary, punctuation, ≤15 words, last line ≤8, callbacks | Task 1 (Narration), Task 3 (narration Voice, Delivery) |
| 8 Self review, four questions in order, fix the storyboard, real re-render command | Task 2; Task 4 runs it; Decisions 6–7 |
| 9 Never claim more than the evidence | Task 1 (Narration bullet, Quality bar), Task 3 (Accurate) |
| Acceptance: `npm run check`, the skill alone suffices, CHANGELOG | Task 5, Task 4, Task 5 |
