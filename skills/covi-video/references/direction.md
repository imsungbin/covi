# Direction

Evidence decides what a video shows; direction decides how. `video/direction.json` gives storyboard scenes a **shot**: the **elements** on screen, each drawn from an evidence id or a short label, and the **beats** that move them, each a verb that lands on a phrase of the scene's line. Covi draws it the same way every time. Its default director directs every scene you leave out, so direct the scenes where you can tell the change better than it does. It morphs a code scene that shows one small hunk's changed lines, and finds that hunk by the scene's line numbers: number a deleted line as before the change and an added line as after it, as the diff does.

## Show the change happening

Choose by what the change does. Each template beat's `verbs` (`covi templates show <id>`) are a starting point, not a rule.

| The change… | Stage it with |
|---|---|
| edits a few lines: a fix, a renamed call, a new branch | a `morph` of its hunk, with a `camera` `follow` on it |
| moves a number: bytes, steps, a score, a duration | a `metric`: a `counter` that `count`s from before to after for the key number, `compare` for a small change, `bars` for one size against another (a value that keeps its sign), `count-up` to build one side from zero |
| sends, batches, or splits work: requests, queues, workers | `node`s for the parts and a `flow` between them; a `packet` that `split`s into its measured pieces and `merge`s back |
| piles up work: retries, steps, rows, calls | a `pile` that `stack`s up to its measured count |
| fails, times out, or is refused | a `label` with `tone: "warning"` beside what failed, revealed as the line says it |
| fixes that | the same staging after the change: the pieces `merge`, the pile is shorter, the counter lands on the new value |
| shows a screen or prints output | the scene's `visual` (or a `capture`, an `output`) and a `camera` move to what changed |

The key number is the largest thing on screen when it lands: make its `metric` the first element of a `"layout": "split"`, or give it a shot of its own. A split gives its first element half the region and the rest the other half; in a square frame a number beside one other element takes the larger share, 7 parts of the width to its 6, and a `pile` goes in a row under them.

## Verbs

| Verb | Acts on | Use it for |
|---|---|---|
| `place` | any element | being there from the shot's start (the default; rarely written) |
| `reveal` | any element | arriving with its words: `rise` (the default), `pop` for a warning, `wipe`, `type` for output |
| `camera` | `to` an element | `zoom` to frame it, `pan` to it at the same scale, `follow` a morph's changing lines or a travelling packet; leave `zoom` out and Covi fits the element to the shot's region |
| `morph` | a `morph` | the hunk's old code turning into its new code |
| `count` | a `metric` with a value before and after | the number ticking from before to after |
| `count-up` | a `metric` drawn as a counter | a counter rising from zero to one side's value (`side`) |
| `flow` | `from` a node `to` a node | something travelling between parts (`packet`: what travels) |
| `split` | a packet or a node | one thing breaking into a measured count of pieces (`count`: a `metric:` id; `side`) |
| `merge` | a split, or a pile | a split's pieces coming back together (after the split), or a pile collapsing |
| `stack` | a `pile` | items piling up, one by one, to the measured count |

A `count` or a `count-up` lands on its phrase, so quote the words that say the number; every other verb starts on its phrase once what it acts on is in place (a morph may start earlier, so its new code can be read). Beats without `at` spread through the line in the order written. `flow`, `split`, `merge`, and `stack` are the flow verbs.

A `count` or `count-up` of a metric you also `reveal` waits for the reveal, shortened so that it still lands on its phrase: start the reveal at least 2.1 s before that phrase for a full count (1.1 s at the least, for a count of 0.6 s), or leave the reveal out. A beat that cannot play where you put it (a split with no room beside its node's name and clear of its packet's pill, or, for a packet no flow carries, none past its pill in its own slot; a trip while its packet is split) is left out with a warning that says why.

**What the beats sound like.** Covi gives a shot's motion its own quiet effects: a soft whoosh mid-way through each `camera` move that changes what the camera frames, ticks while a `count` or `count-up` runs (spaced like the number on screen, the last as it lands), a thump as a `merge`'s pieces meet, and a soft accent as an element's first `reveal` begins. `place`, `morph`, `flow`, `split`, and `stack` are silent. Only one counter ticks at a time, so stagger two counts rather than landing them on one phrase. Do not add a storyboard `cues` entry for a moment a beat already sounds.

## Elements

- From evidence: `visual` (the scene's storyboard visual, drawn as without direction; a title or summary card only alone, without a reveal), `code` (a `diff-hunk:` id; `side`, `lines`), `morph` (a `diff-hunk:` id with code on both sides and at most 12 changed lines a side, close enough together to fit one card; show a hunk too long or too spread out to morph as `code` with `lines`), `output` (a `terminal:` id; `side`), `capture` (a `screenshot:` id), `metric` (a `metric:` id; `show`, `side`, and `label`, its name in the video's language), and `pile` (a `metric:` id that counts something; `side`, `label`). Without a `label`, a command's metric or pile is named as its output named it.
- Written by you: `node` (a `label`, and the evidence ids it stands for), `packet` (an optional `label`), and `label` (`text`, and `tone`: `neutral`, `warning`, or `success`).

A shot without a `visual` element replaces the scene's storyboard visual. Keep that visual true to the shot anyway: it is what `--direction off` draws.

Shots name scenes by id. Ids are optional (Covi numbers scenes `s1`, `s2`, …), but each is the scene's own: a storyboard that gives two scenes one id, such as `"id": "s2"` beside an unnamed second scene, is refused.

## Bind everything to evidence

- **Content only by id.** Code and morphs come from `diff-hunk:` ids, output from `terminal:`, images from `screenshot:`, and every number from a `metric:` id: counters, bars, comparisons, piles, and the pieces of a split. `covi evidence --run <id> --json` lists the ids, and each metric with its values.
- **Never write a number.** Labels cannot hold digits, and number words ("thirty", "삼십", "三十") are just as wrong, though Covi cannot catch them. Deltas and ratios are Covi's to compute. A count nobody measured is never drawn: `reveal` or `flow` the thing instead.
- **Labels name things.** A word or two, 32 characters at most, in the video's language: a part ("Reader"), what travels ("Every document"), a state ("Timed out"). A warning or success label says only what the evidence shows, and the scene cites that evidence in `evidenceIds` (a timeout: the command's `timeouts` metric).
- **Phrases come from the line.** `at` quotes the scene's `narration` as written, letter case included, and must occur in it exactly once (`[[…]]` aside); a few words are safer than one. Write the lines first, then direct them; after you edit a line, check the phrases its beats quote (`covi render` names any that no longer match).

## Variety

- **No more than two shots of one kind in a row.** A shot's kind is its first element's, counted as the picture it looks like (a `morph` counts as code, an `output` as a terminal, a `visual` as the storyboard visual's kind), and a shot with a flow verb counts as a flow.
- **Camera moves over fades.** `enter: "pan"` to the next step, `"zoom"` into the hero, `"wipe"` from before to after, `"cut"` when the same subject continues; `"push"` slides in the next step of a sequence. Leave the storyboard's `transition`s unset, so scenes you give no `enter` take Covi's camera rotation, not a fade. No one entrance for more than 60% of the scene changes.
- **One idea per shot.** About four elements and four beats at most. No more than three beats start within any second, and no more than two camera moves within any two seconds. In 9:16, give a `code` or `morph` element a shot alone or with one partner: a third slot draws its code too small to read.
- **Keep it moving.** No 1.5 s of narration without a beat, a camera move, or an element arriving: spread the beats over the line, each on its own phrase.
- **Give words time.** Anything with words on it (a label, a node, a packet's, a pile's, or a metric's name) needs 0.4 s plus a second for every 15 characters (8 in Korean, Japanese, or Chinese) before the next scene comes in, which happens about when the line ends; the code a morph adds needs as long once the morph has landed, up to 2 s. Bring them in on a phrase in the first half of the line, and keep the end of the line for beats without words: a `count`, a `merge`, a camera move.

## Staging a change with no UI

When there is nothing to capture, show what the change does to the work.

1. **Measure it.** A demo command that prints one `label: number` line per measure at both revisions (`covi-demo`) gives `metric:` evidence: a request's bytes, its chunks, the reader's steps, its timeouts.
2. **The problem**, the cold open: the parts as `node`s, on screen from the first frame and spread over it (`"layout": "split"`; a `row` of nodes is one short strip), the work `flow`ing between them, `split` into its measured pieces or `stack`ed into a pile, and the failure as a warning `label`.
3. **The fix**, usually the hero: a `morph` of the lines that change it, the camera following them.
4. **The result**: the same staging after the change (the pieces `merge` into one, the pile is shorter), and the key number's `count` landing as the line says it.
5. **The wrap**: one summary scene, its card alone, as Covi directs it when you leave the scene out. Say the review note on it ("Nothing blocking"), or give a finding its own scene before it. Covi's outro follows the wrap, so the video ends there.

## Example: a change with no UI

`covi examples create backend-slim-request` builds the benchmark: a review request that embedded every document, went out in chunks, and timed out now lists document references, and the reader fetches each document itself. Covi's draft (`covi video --standard --draft`) has four scenes: `s1` the measuring command's output before and after, `s2` the fix in `src/reader.js` (the hero), `s3` the review note, and `s4` the summary. The rewrite keeps their ids and the cold open's eyebrow, writes new lines, turns `s3` into the proof (the same command's output), and directs the first three scenes.

The rewritten scenes of `video/storyboard.json`. Every field not shown stays as drafted, except `say`, the spoken form of the old line, which is removed:

```json
{
  "scenes": [
    {
      "id": "s1",
      "narration": "The reader timed out: the review went out in four chunks, [[every document embedded]].",
      "evidenceIds": ["metric:terminal-1:timeouts"]
    },
    {
      "id": "s2",
      "narration": "Now the reader fetches each document itself, and the request just [[lists references]]!"
    },
    {
      "id": "s3",
      "beat": "proof",
      "eyebrow": "After",
      "expression": "success",
      "narration": "Those four chunks are now one request, and request bytes fall below [[ten thousand]].",
      "evidenceIds": ["metric:terminal-1:chunks", "metric:terminal-1:request-bytes"],
      "visual": {
        "kind": "terminal",
        "title": "Measure the review request",
        "command": "node scripts/measure.js",
        "output": "request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0",
        "before": "request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1"
      }
    },
    {
      "id": "s4",
      "narration": "Nothing blocking: [[ready to merge]]."
    }
  ]
}
```

`video/direction.json`:

```json
{
  "schemaVersion": 1,
  "draft": false,
  "shots": [
    {
      "scene": "s1",
      "layout": "split",
      "elements": [
        { "id": "review", "kind": "node", "label": "Review", "evidence": ["diff-hunk:src/request.js:25"] },
        { "id": "reader", "kind": "node", "label": "Reader", "evidence": ["diff-hunk:src/reader.js:19"] },
        { "id": "docs", "kind": "packet", "label": "Every document" },
        { "id": "late", "kind": "label", "text": "Timed out", "tone": "warning" }
      ],
      "beats": [
        { "verb": "reveal", "element": "late", "style": "pop", "at": "timed out" },
        { "verb": "flow", "from": "review", "to": "reader", "packet": "docs", "at": "the review went out" },
        { "verb": "split", "element": "docs", "count": "metric:terminal-1:chunks", "side": "base", "at": "four chunks" }
      ]
    },
    {
      "scene": "s2",
      "enter": "zoom",
      "elements": [{ "id": "fix", "kind": "morph", "evidence": "diff-hunk:src/reader.js:19" }],
      "beats": [
        { "verb": "camera", "move": "follow", "to": "fix", "at": "Now the reader" },
        { "verb": "morph", "element": "fix", "at": "fetches each document" }
      ]
    },
    {
      "scene": "s3",
      "enter": "pan",
      "layout": "split",
      "elements": [
        { "id": "bytes", "kind": "metric", "evidence": "metric:terminal-1:request-bytes", "show": "counter" },
        { "id": "request", "kind": "packet", "label": "Review request" }
      ],
      "beats": [
        { "verb": "split", "element": "request", "count": "metric:terminal-1:chunks", "side": "base", "at": "Those four chunks" },
        { "verb": "merge", "element": "request", "at": "one request" },
        { "verb": "count", "element": "bytes", "at": "ten thousand" }
      ]
    }
  ]
}
```

- `s1` opens on the two parts, split so that they fill the frame. "Timed out" pops in as the line says it, every document travels to the reader, and it splits into the four chunks the command measured before the change. The line runs on after "four chunks", so the split has room to end before the scene moves on.
- `s2` zooms into the hero. The camera follows the reader's loop while it morphs, early in the line, into the one that fetches each document, and the rest of the line leaves time to read the new code.
- `s3` pans to the proof. The four chunks merge into one request (the command measured one after the change), and the request's bytes count down to the new value as the line says it, the largest thing on screen.
- `s4` keeps Covi's shot: the summary card.

## Workflow with the CLI

1. `covi video --draft --json` writes `video/storyboard.json` and Covi's `video/direction.json` (`"draft": true`).
2. Rewrite the storyboard first: its lines hold the phrases beats land on. Then direct it: `covi evidence --run <id> --json` lists ids and values, `covi templates show <template>` each beat's `verbs`, and `covi schema direction` every field. Set `"draft": false`, or Covi derives its draft again.
3. `covi render --run <id> --draft --json` renders a fast draft into `video/draft/`; a direction that does not fit the run exits 2 and lists every problem. When a check does not pass, the result's `warnings` say `Draft QC <status>: <ids>`. Open `video/draft/contact-sheet.jpg` and `video/draft/poster.png` (the poster Covi will use: where the key number's count lands, else the hero after its accent), read `video/draft/qc.json`, and fix what the checks name:
   - `motion-gap`: nothing moves for 1.5 s or more of narration (a shot's slow push-in counts only once its beats are done); it names what ends the gap. Pin a beat to a phrase in that stretch with `at`, reveal an element sooner, or add a camera beat.
   - `motion-busy`: more than 3 beats start within a second, or more than 2 camera moves within 2 s. Give each beat its own phrase, or drop one.
   - `reading-time`: a label, a node's or packet's label, a pile's or metric's name, or the code a morph adds leaves before it can be read (0.4 s plus 15 characters a second, 8 for CJK; at most 2 s for a morph's code). Reveal or morph it earlier, or shorten it.
   - `empty-opening`: a scene shows less than 40% of the frame for 1.5 s or more of narration while it comes in (a before window waiting for its after one). Bring its parts in together, or stage it as a shot that is full from the start.
   - `overlap`: two elements of a shot collide. Choose another `layout`, or show fewer elements.
   - `out-of-frame` (fails): an element is cut off by the frame. Show fewer lines or elements, or split the shot.
   - `dropped-beats`: a beat was left out, and the message says why. Give it room (a longer line, a larger slot) or quote phrases in the order the beats should play; a beat left out of Covi's own shot changes only once you write that shot yourself.
   - `still`: the rendered picture froze under narration; "where only the camera's slow push-in moves" means the plan had nothing else there: give it a beat. It reads the pixels, so it and `motion-gap` can name different stretches.
   - `monotony` and `transition-variety`: see Variety.
4. Stop after three draft rounds even if a warning remains, then render the video with `covi render --run <id> --json` and review it as the skill says.
