# PR B3 — Code morph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Code changes visibly morph: a `morph` element and a `morph` beat turn a diff hunk's code before the change into the code after it, token by token (removed lines fold away, new lines slide in, kept tokens travel), long hunks elide deterministically to 14 rows (18 in 9:16), `camera follow` keeps the changed lines framed at every frame, Covi's default director morphs code scenes whose hunk is small, and the contact sheet shows every morph mid-way.

**Architecture:** A pure Node module, `packages/video/src/direction/tokens.ts`, turns a hunk's lines into a morph model: tokens with syntax tones (via a DOM-free `runtime/syntax.ts` extracted from the highlighter), the rows each side shows after elision (with `… N lines` markers whose words come from the message catalogs), the rows that become each other, and the tokens that stay. B2's resolver puts that model on `TimelineScene.direction` as a `morph` element (each line redacted whole before it is split). The browser runtime's `runtime/direction/morph.ts` lays both sides out once at mount (fonts loaded, nothing transformed), then places every token, line number, mark, and row tint as a pure function of the frame; it also exposes where the changed lines are at any moment, which B2's canvas camera now follows per frame through a function-valued `CameraStep`.

**Tech Stack:** TypeScript on Node 22.18+ (no build step), Zod 4, Vitest, Playwright Chromium, ffmpeg; the browser runtime is bundled by esbuild.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` — §6 (code morph), §4.2–§4.8 (direction: the `morph` element and verb, `camera follow`, the default director), §5 (canvas), §8 (sizing floors), §14 (security), §15–§18. Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-007, R-008, R-009, R-016, R-017, and R-020 bind this PR). Code worktree: `~/projects/covi-direction`, branch `code-morph`, started from the latest `main` after B1 (density checks) and B2 (direction and canvas) merged.

## Global Constraints

Every task's requirements include these. Values are copied from the spec, the rulings, and `AGENTS.md`.

- TypeScript on Node 22.18+, run without a build step: import with `.ts` extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments explain why, in concise English.
- Dependency direction unchanged: `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. Browser runtime files (`packages/video/src/runtime/**`) import only DOM-free shared files (`timeline/types.ts`, `timeline/cues.ts`, `runtime/*`, `@covi/brand`). Node code imports a runtime file only when it is DOM-free (`runtime/layout.ts`, B1's `runtime/sizing.ts`, and this PR's `runtime/syntax.ts`). Files under `tests/` never import a runtime file that uses DOM types.
- Runtime: every visual property is a pure function of the frame time. No `Date`, no `Math.random`, no CSS transitions or animations. Text is set with `textContent` (`el(…, text)`), never `innerHTML` (the existing code card's `highlightLine` output, which escapes, is the only exception, and the morph does not use it).
- Schemas: Zod, every object `z.strictObject`, enums wherever a choice exists, every list, string, and number bounded; `DIRECTION_LIMITS` (in `packages/video/src/direction/schema.ts`) stays the single bounds source and tests import it. `video/direction.json` stays `schemaVersion: 1` and `video/timeline.json` stays `version: 1` (both changes are additive). The storyboard schema is unchanged: its line-level `mode: "morph"` keeps working exactly as before. Never change any `version` field.
- Spec §6, verbatim values: source is the hunk's base and head lines (redacted); tokens are identifiers, numbers, strings, comments, punctuation, and whitespace runs; lines align by the hunk itself (context/del/add) and tokens within a replaced line pair by LCS; each token is `kept` (base index → head index), `removed`, or `added`; removed lines fold away (height and opacity to 0), added lines slide in, kept tokens travel from their base box to their head box, both layouts measured in the runtime after fonts load, positions interpolated with an ease; changed tokens tint with the brand's add/del colors and settle; camera `follow` frames the changed lines; elision shows at most 14 lines (landscape) / 18 (vertical): all changed lines first, then context nearest them; elided runs collapse into one marker with N computed by Covi; the choice is deterministic; code ≥ 24 px at 1080p (B1's floor) and the card sizes to its content.
- Text drawn for people goes through `templates/i18n/{en,ko,ja,zh}.yml` with the same placeholders in all four (Korean particles as pairs); validation messages and CLI logs stay English.
- Security (§14): a direction is untrusted agent input. A morph element carries only an evidence id; its content comes from the run's diff; every hunk line is redacted whole before it is tokenized, and everything resolved is redacted again (`redactDeep`) before it reaches `timeline.json`.
- QC checks this program adds warn; only `out-of-frame` (B6) and `music-jump` (A1) fail (R-007). This PR adds no QC check.
- `video.direction: off` renders exactly as 0.2.0 did (R-016): no canvas, no direction, so never a token morph.
- CHANGELOG: one line under `## [Unreleased]`, in its `### Added` subsection (R-017).
- Commits: default git identity (never Claude as author or co-author); concise English message ending with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push. Each task leaves `npm run check` green.
- Long commands (`npm test`, `npm run check`, `npm run test:render`, `covi video`) run in the background; wait for them to finish before reporting.

## B1 and B2 names this plan builds on

B1 and B2 merge before this PR starts; their plans are `2026-10-09-b1-density-checks.md` and `2026-10-09-b2-direction-canvas.md` beside this one. Before Task 1, run a pre-flight scan of this plan against the merged `main` (as R-020 did for B2): where a merged name or signature differs from the list below, use the merged one and keep the behavior this plan describes, and record the difference in the task report.

- B1: `codeFont(fit, orientation, unit)` and `cardHeight(region, width, content)` in `packages/video/src/runtime/sizing.ts`; `drawnFont(node)` in `runtime/components/types.ts`; `LayoutItem.font` / `LayoutItem.text` (`'code' | 'body' | 'meta'`); `contactSheetFrames` unchanged by B1 in `render/renderer.ts`; the benchmark `examples/backend-slim-request/`, whose `src/request.js` and `src/reader.js` hunks are small replacements; B1's `covi video (full pipeline)` render loop in `tests/render/render.test.ts` includes `backend-slim-request`.
- B2 (`packages/video/src/direction/`): `DIRECTION_LIMITS`, `ShotElementSchema`, `ShotBeatSchema` (discriminated unions on `kind` / `verb`), `PhraseSchema`, `EvidenceRefSchema`, `ElementIdSchema` in `schema.ts`; `directionSources(…)` with `DirectionSources.hunk(id): HunkSource | undefined` (`{ path, language?, lines: DiffLine[] }`) in `sources.ts`; `directionProblems(…)` and its private `elementProblems` / `cites(…)` in `refs.ts`; `WEIGHT: Record<ShotElement['kind'], number>` in `layout.ts`; `resolveDirection(input)` with `BEAT_SECONDS`, `CODE_LINES = { landscape: 14, vertical: 18 }`, the private `Context`, `resolveShot`, `element(e, rect, ctx)`, and `timeBeats` in `resolve.ts`; `defaultDirection(input: DirectorInput)`, `CODE_ZOOM = 1.25`, and the private `cameraBeats` in `director.ts`; `planDirection` in `plan.ts` (it already receives `sources`).
- B2 (timeline and runtime): `DirectionElement`, `DirectionBeat`, `SceneDirection`, `SceneStaging`, `CameraMove` in `timeline/types.ts`; `shotSettledAt(scene)` in `timeline/cues.ts`; `leadKind` and its `LOOKS_LIKE` map in `packages/video/src/density.ts`; `CameraStep`, `viewAt`, `beatView`, `lerpRect`, `restView` in `runtime/canvas.ts`; the stage's private `cameraSteps(m)` and `targetAt(…)`, and `MountedScene.shot` in `runtime/stage.ts`; `mountShot(…)`, `ShotComponent` (with `frame(id)`), the private `Drawn` and `draw(element, ctx, drawVisual)` in `runtime/direction/elements.ts`; `tests/direction-security.test.ts` with its render test (staging built by hand, elements `a`–`d`); `tests/render/canvas.test.ts`.

## Review Focus

The five inputs or conditions the spec implies that a person will meet and that no task's main tests would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **Lines with tabs, a carriage return (CRLF files), identifiers in Korean, emoji, and an unclosed quote** — the morph must draw every character, in order, with nothing lost or doubled. Test: Task 1, `tokens.test.ts` "keeps every character, in any script, with an unclosed quote and a carriage return".
2. **A secret in a hunk line outside any string, which tokenizing would split (`hunter2`, `-`, `shh`, …)** — it must be masked whole before the line is split, so no piece reaches `timeline.json`. Test: Task 3, `direction-morph.test.ts` "redacts each line whole before splitting it".
3. **A morph element that the agent also reveals later** — the morph must play on the element's own clock (which starts at its reveal), not land early or late. Test: Task 2, `tests/render/morph.test.ts` "plays on its own clock when it is revealed later".
4. **A pure insertion inside a file (no deleted line)** — the context must part to open a row for the new line, and the code below must move down. Tests: Task 1 "opens room for a line added between context lines", Task 2 "opens room for lines added between others, and moves the code below down".
5. **A 9:16 video** — elision must keep up to 18 rows a side (14 on 16:9 and square). Test: Task 3, `direction-morph.test.ts` "keeps 14 rows a side on a wide frame and 18 on a tall one".

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/video/src/runtime/syntax.ts` (create) | 1 | Language families, keywords, comment patterns: shared by the highlighter and the tokenizer (DOM-free) |
| `packages/video/src/runtime/highlight.ts` | 1 | Reads its keyword table and comment patterns from `syntax.ts` (behavior unchanged) |
| `packages/video/src/timeline/types.ts` | 1, 2 | `TokenTone`, `MorphToken`, `MorphRow`, `MorphVisual` (1); the `morph` element and beat (2) |
| `packages/video/src/direction/schema.ts` | 1, 3 | `DIRECTION_LIMITS.morph` (1); the `morph` element and verb (3) |
| `packages/video/src/direction/tokens.ts` (create) | 1 | `tokenize`, `sharedTokens`, `pairLines`, `keptLines`, `morphProblem`, `morphHunk` |
| `packages/video/src/timeline/cues.ts` | 2 | `MORPH_PHASES`, `MORPH_SETTLE`; `shotSettledAt` waits for a morph |
| `packages/video/src/density.ts` | 2 | A morph leads as `code` |
| `packages/video/src/runtime/components/types.ts` | 2 | `Component.follow(t)` |
| `packages/video/src/runtime/direction/morph.ts` (create) | 2 | The morph component |
| `packages/video/src/runtime/direction/elements.ts` | 2, 4 | Draws morph elements on their own clock; the narrator points at a morph (2); `ShotComponent.track` (4) |
| `packages/video/src/runtime/styles.ts` | 2 | `.code.tokens` pieces, the elided marker |
| `packages/video/src/direction/refs.ts` | 3 | A morph cites a hunk that can morph; `morph` beats name a morph, once |
| `packages/video/src/direction/layout.ts` | 3 | A morph weighs like code |
| `packages/video/src/direction/resolve.ts` | 3 | Resolves morph elements (lines redacted whole, the marker from the catalog), implicit morph beats, `BEAT_SECONDS.morph` |
| `templates/i18n/{en,ko,ja,zh}.yml` | 3 | `video.elided` |
| `packages/video/src/runtime/canvas.ts` | 4 | A `CameraStep` may follow a moving target |
| `packages/video/src/runtime/stage.ts` | 4 | `camera follow` on a moving element follows it per frame |
| `packages/video/src/direction/director.ts`, `plan.ts` | 5 | The default director morphs small code hunks |
| `packages/video/src/render/renderer.ts` | 6 | A contact-sheet tile at every morph's midpoint |
| `packages/video/test/tokens.test.ts` (create) | 1 | Tokenizer, alignment, elision |
| `packages/video/test/morph-timeline.test.ts` (create) | 2 | Settle time, lead kind |
| `tests/render/morph.test.ts` (create) | 2, 4 | The morph drawn in Chromium; camera following |
| `tests/direction-security.test.ts` | 2 | Morph tokens reach the page only as text |
| `packages/video/test/direction-morph.test.ts` (create) | 3 | Schema, references, resolution |
| `packages/video/test/direction-schema.test.ts` | 3 | `morph` is no longer an unknown kind or verb |
| `packages/video/test/canvas.test.ts` | 4 | `viewAt` with a moving target |
| `packages/video/test/director.test.ts`, `tests/examples.test.ts` | 5 | The director's morphs; the benchmark morphs |
| `packages/video/test/frames.test.ts`, `tests/render/render.test.ts` | 6 | The morph tile; the benchmark renders with a morph |
| docs, skill, CHANGELOG | 7 | Documentation |

---
### Task 1: The morph model — tokens, alignment, and elision

**Files:**
- Create: `packages/video/src/runtime/syntax.ts`
- Modify: `packages/video/src/runtime/highlight.ts` (lines 1–151: the keyword table and `family` move out; `highlightLine` reads them back)
- Modify: `packages/video/src/timeline/types.ts` (after `export type CameraMove = …`, which B2 added)
- Modify: `packages/video/src/direction/schema.ts` (`DIRECTION_LIMITS`, after `evidencePerElement: 4,`)
- Create: `packages/video/src/direction/tokens.ts`
- Create: `packages/video/test/tokens.test.ts`

**Interfaces:**
- Consumes: `DiffLine` (`@covi/core`); `DIRECTION_LIMITS` (B2).
- Produces (later tasks rely on these exact names):
  ```ts
  // packages/video/src/runtime/syntax.ts (DOM-free)
  export type SyntaxFamily = 'c' | 'py' | 'sh' | 'css' | 'markup' | 'json' | 'sql';
  export function syntaxFamily(language?: string): SyntaxFamily;
  export function keywordsOf(family: SyntaxFamily): ReadonlySet<string>;
  export function commentPattern(family: SyntaxFamily): RegExp;

  // packages/video/src/timeline/types.ts
  export type TokenTone = 'keyword' | 'string' | 'number' | 'comment' | 'fn' | 'type' | 'prop';
  export interface MorphToken { text: string; tone?: TokenTone }
  export interface MorphRow { type: 'context' | 'del' | 'add' | 'elided'; number?: number; tokens: MorphToken[] }
  export interface MorphVisual {
    path: string; language?: string; base: MorphRow[]; head: MorphRow[];
    rows: Array<[number, number]>;                         // [baseRow, headRow]
    tokens: Array<[number, number, number, number]>;       // [baseRow, baseToken, headRow, headToken]
  }

  // packages/video/src/direction/schema.ts
  // DIRECTION_LIMITS gains: morph: { changedLines: 12, hunkLines: 400, lineChars: 96, tokensPerLine: 64 }

  // packages/video/src/direction/tokens.ts
  export const isSpace: (token: MorphToken) => boolean;
  export function tokenize(line: string, language?: string): MorphToken[];
  export function sharedTokens(a: readonly MorphToken[], b: readonly MorphToken[]): { pairs: Array<[number, number]>; weight: number };
  export function pairLines(dels: ReadonlyArray<readonly MorphToken[]>, adds: ReadonlyArray<readonly MorphToken[]>): Array<[number, number]>;
  export function keptLines(lines: readonly DiffLine[], max: number): boolean[];
  export function morphProblem(lines: readonly DiffLine[]): string | undefined;
  export interface MorphOptions { max: number; language?: string; elided: (count: number) => string }
  export function morphHunk(lines: readonly DiffLine[], options: MorphOptions): Omit<MorphVisual, 'path' | 'language'> | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/tokens.test.ts`:

```ts
import type { DiffLine } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { DIRECTION_LIMITS } from '../src/direction/schema.ts';
import {
  isSpace,
  keptLines,
  morphHunk,
  morphProblem,
  pairLines,
  sharedTokens,
  tokenize,
} from '../src/direction/tokens.ts';
import type { MorphVisual } from '../src/timeline/types.ts';

const texts = (line: string, language?: string) => tokenize(line, language).map((t) => t.text);
const context = (text: string, oldLine: number, newLine = oldLine): DiffLine => ({
  kind: 'context',
  text,
  oldLine,
  newLine,
});
const del = (text: string, n: number): DiffLine => ({ kind: 'del', text, oldLine: n });
const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, newLine: n });
const elided = (count: number) => `… ${count} lines`;
type Morph = Omit<MorphVisual, 'path' | 'language'>;
/** One side of a morph, a row a string. */
const side = (m: Morph, which: 'base' | 'head') =>
  m[which].map((r) => r.tokens.map((t) => t.text).join(''));
/** What stays of each linked row pair, as the kept tokens' text. */
const kept = (m: Morph) =>
  m.rows.map(([b, h]) =>
    m.tokens
      .filter(([tb, , th]) => tb === b && th === h)
      .map(([, i]) => m.base[b]!.tokens[i]!.text)
      .join(''),
  );

// The benchmark's change: the request lists document refs instead of embedding the documents.
const hunk: DiffLine[] = [
  context('  return messages.map((message) => ({ ...message, parts: messages.length }));', 39),
  context('}', 40),
  context('', 41),
  del(
    '/** The messages that ask the reader to review these documents, each document in full. */',
    42,
  ),
  add('/**', 42),
  add(
    ' * The messages that ask the reader to review these documents: which ones, by id, title, and',
    43,
  ),
  add(' * size. The reader fetches each document from the store itself.', 44),
  add(' */', 45),
  context('export function buildReviewRequest(store, ids) {', 43, 46),
  context('  return chunk(', 44, 47),
  context("    'review-1',", 45, 48),
  del("    'documents',", 46),
  del('    ids.map((id) => store.get(id)),', 47),
  add("    'refs',", 49),
  add('    ids.map((id) => {', 50),
  add('      const { title, body } = store.get(id);', 51),
  add('      return { id, title, bytes: Buffer.byteLength(body) };', 52),
  add('    }),', 53),
  context('  );', 48, 54),
  context('}', 49, 55),
];

describe('tokenizing a line', () => {
  it('splits words, numbers, strings, comments, whitespace, and single punctuation', () => {
    expect(texts('  ids.map((id) => store.get(id)), // fetch')).toEqual([
      '  ',
      'ids',
      '.',
      'map',
      '(',
      '(',
      'id',
      ')',
      ' ',
      '=',
      '>',
      ' ',
      'store',
      '.',
      'get',
      '(',
      'id',
      ')',
      ')',
      ',',
      ' ',
      '/',
      '/',
      ' ',
      'fetch',
    ]);
    // Strings and comments split into their words, so a changed word moves on its own.
    expect(texts("send('a b', 42);")).toEqual([
      'send',
      '(',
      "'",
      'a',
      ' ',
      'b',
      "'",
      ',',
      ' ',
      '42',
      ')',
      ';',
    ]);
    expect(texts('x = 1 # note', 'python')).toEqual([
      'x',
      ' ',
      '=',
      ' ',
      '1',
      ' ',
      '#',
      ' ',
      'note',
    ]);
  });

  it('keeps every character, in any script, with an unclosed quote and a carriage return', () => {
    for (const line of ['const 수량 = "🙂🎉";', 'say("unclosed', 'café = naïve\r', '\t\tx', ''])
      expect(texts(line).join('')).toBe(line);
    expect(texts('const 수량 = 1;')).toContain('수량');
  });

  it('colors tokens as the code panel does, and a line inside a block comment as a comment', () => {
    const tones = (line: string, language?: string) =>
      tokenize(line, language)
        .filter((t) => !isSpace(t))
        .map((t) => `${t.text}:${t.tone ?? '-'}`);
    expect(tones('return buildRequest(Store, "x", 2);')).toEqual([
      'return:keyword',
      'buildRequest:fn',
      '(:-',
      'Store:type',
      ',:-',
      '":string',
      'x:string',
      '":string',
      ',:-',
      '2:number',
      '):-',
      ';:-',
    ]);
    expect(tones('"refs": true', 'json')).toEqual([
      '":prop',
      'refs:prop',
      '":prop',
      '::-',
      'true:keyword',
    ]);
    expect(tones('def run(self):', 'python')[0]).toBe('def:keyword');
    expect(tones('SELECT id FROM docs', 'sql')).toEqual([
      'SELECT:keyword',
      'id:-',
      'FROM:keyword',
      'docs:-',
    ]);
    expect(tones(' * The reader fetches it.').every((t) => t.endsWith(':comment'))).toBe(true);
  });

  it('caps the tokens of a line, keeping the rest of it as one', () => {
    const line = Array.from({ length: 100 }, (_, i) => `a${i}`).join(',');
    const tokens = tokenize(line);
    expect(tokens).toHaveLength(DIRECTION_LIMITS.morph.tokensPerLine);
    expect(tokens.map((t) => t.text).join('')).toBe(line);
  });
});

describe('aligning lines', () => {
  it('keeps the tokens two lines share, longest first, in order', () => {
    const a = tokenize('    ids.map((id) => store.get(id)),');
    const b = tokenize('    ids.map((id) => {');
    const { pairs } = sharedTokens(a, b);
    for (const [i, j] of pairs) expect(a[i]!.text).toBe(b[j]!.text);
    expect(pairs.map(([i]) => a[i]!.text).join('')).toBe('ids.map((id)=>');
  });

  it('pairs a deleted line with the added line it shares the most with, in order', () => {
    const dels = ['/** The messages that ask the reader to review these documents. */'].map((l) =>
      tokenize(l),
    );
    const adds = [
      '/**',
      ' * The messages that ask the reader to review these documents.',
      ' */',
    ].map((l) => tokenize(l));
    expect(pairLines(dels, adds)).toEqual([[0, 1]]);
    // Lines that share nothing, or only a comma, stay unpaired.
    expect(pairLines([tokenize('alpha')], [tokenize('beta')])).toEqual([]);
    expect(pairLines([tokenize('// every document, in full')], [tokenize("'refs',")])).toEqual([]);
    // Order is kept: a later deleted line never pairs with an earlier added line.
    expect(
      pairLines([tokenize('one()'), tokenize('two()')], [tokenize('two()'), tokenize('one()')]),
    ).toHaveLength(1);
  });
});

describe('a hunk as a morph shows it', () => {
  it('shows every changed line and the context nearest them, at most 14 rows a side', () => {
    const m = morphHunk(hunk, { max: 14, language: 'javascript', elided })!;
    expect(side(m, 'base')).toEqual([
      '',
      '/** The messages that ask the reader to review these documents, each document in full. */',
      'export function buildReviewRequest(store, ids) {',
      '  return chunk(',
      "    'review-1',",
      "    'documents',",
      '    ids.map((id) => store.get(id)),',
      '  );',
    ]);
    // The rows at either end are cut, as a code card cuts a hunk; nothing between is left out.
    expect(side(m, 'head')).toEqual([
      '',
      '/**',
      ' * The messages that ask the reader to review these documents: which ones, by id, title, and',
      ' * size. The reader fetches each document from the store itself.',
      ' */',
      'export function buildReviewRequest(store, ids) {',
      '  return chunk(',
      "    'review-1',",
      "    'refs',",
      '    ids.map((id) => {',
      '      const { title, body } = store.get(id);',
      '      return { id, title, bytes: Buffer.byteLength(body) };',
      '    }),',
      '  );',
    ]);
    expect(m.base.map((r) => r.number)).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
    expect(m.head.map((r) => r.number)).toEqual([
      41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    ]);
  });

  it('links context lines and replaced lines, and keeps the tokens they share', () => {
    const m = morphHunk(hunk, { max: 14, language: 'javascript', elided })!;
    // The one-line comment becomes the comment's sentence (not its opening), `'documents'` the
    // `'refs'` (its quotes stay), and the call keeps everything up to the arrow.
    expect(m.rows).toEqual([
      [0, 0],
      [1, 2],
      [2, 5],
      [3, 6],
      [4, 7],
      [5, 8],
      [6, 9],
      [7, 13],
    ]);
    expect(kept(m)).toEqual([
      '',
      '*Themessagesthataskthereadertoreviewthesedocuments,',
      'exportfunctionbuildReviewRequest(store,ids){',
      'returnchunk(',
      "'review-1',",
      "'',",
      'ids.map((id)=>',
      ');',
    ]);
    for (const [b, i, h, j] of m.tokens)
      expect(m.base[b]!.tokens[i]!.text).toBe(m.head[h]!.tokens[j]!.text);
  });

  it('opens room for a line added between context lines, linking the context around it', () => {
    const m = morphHunk([context('a();', 1), add('b();', 2), context('c();', 2, 3)], {
      max: 14,
      elided,
    })!;
    expect(side(m, 'base')).toEqual(['a();', 'c();']);
    expect(side(m, 'head')).toEqual(['a();', 'b();', 'c();']);
    expect(m.rows).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it('is deterministic', () => {
    expect(morphHunk(hunk, { max: 14, elided })).toEqual(morphHunk(hunk, { max: 14, elided }));
  });

  it('marks a run it leaves out between kept lines with how many lines it hides', () => {
    const groups: DiffLine[] = [
      context('top', 1),
      ...Array.from({ length: 6 }, (_, i) => add(`a${i}();`, i + 2)),
      ...Array.from({ length: 6 }, (_, i) => context(`m${i}`, i + 2, i + 8)),
      ...Array.from({ length: 6 }, (_, i) => add(`b${i}();`, i + 14)),
    ];
    const m = morphHunk(groups, { max: 14, elided })!;
    expect(side(m, 'head')).toEqual([
      'top',
      'a0();',
      'a1();',
      'a2();',
      'a3();',
      'a4();',
      'a5();',
      '… 6 lines',
      'b0();',
      'b1();',
      'b2();',
      'b3();',
      'b4();',
      'b5();',
    ]);
    expect(side(m, 'base')).toEqual(['top', '… 6 lines']);
    // The marker reads the same on both sides, so it stays and travels.
    expect(m.rows).toContainEqual([1, 7]);
    expect(m.tokens).toContainEqual([1, 0, 7, 0]);
  });

  it('cuts a long hunk to its changes and the context nearest them', () => {
    const long: DiffLine[] = [
      ...Array.from({ length: 20 }, (_, i) => context(`c${i}`, i + 1)),
      del('old();', 21),
      add('fresh();', 21),
      ...Array.from({ length: 20 }, (_, i) => context(`d${i}`, 22 + i)),
    ];
    const m = morphHunk(long, { max: 14, elided })!;
    expect(side(m, 'head')).toEqual([
      'c13',
      'c14',
      'c15',
      'c16',
      'c17',
      'c18',
      'c19',
      'fresh();',
      'd0',
      'd1',
      'd2',
      'd3',
      'd4',
      'd5',
    ]);
    const many: DiffLine[] = [
      del('old();', 1),
      add('fresh();', 1),
      ...Array.from({ length: DIRECTION_LIMITS.morph.hunkLines + 50 }, (_, i) =>
        context(`c${i}`, i + 2),
      ),
    ];
    expect(morphHunk(many, { max: 14, elided })!.head).toHaveLength(14);
  });

  it('keeps every side within its rows even when the changes alone overflow it', () => {
    const big: DiffLine[] = [
      context('start', 1),
      ...Array.from({ length: 30 }, (_, i) => add(`line${i}();`, i + 2)),
      context('end', 32),
    ];
    expect(morphHunk(big, { max: 14, elided })!.head.length).toBeLessThanOrEqual(14);
    expect(keptLines(big, 14).filter(Boolean).length).toBeLessThanOrEqual(14);
  });

  it('says why a hunk cannot morph: no code on a side, or more changes than a card shows', () => {
    expect(morphProblem(hunk)).toBeUndefined();
    expect(morphHunk([add('a', 1), add('b', 2)], { max: 14, elided })).toBeUndefined();
    expect(morphProblem([add('a', 1)])).toMatch(/no lines before the change/);
    expect(morphProblem([del('a', 1)])).toMatch(/no lines after the change/);
    const adds = Array.from({ length: 13 }, (_, i) => add(`x${i}`, i + 2));
    expect(morphProblem([context('a', 1), ...adds])).toMatch(
      /changes 13 lines on its head side, and a morph shows at most 12/,
    );
    expect(morphProblem([context('a', 1), ...adds.slice(1)])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/tokens.test.ts`
Expected: FAIL — `Failed to load url ../src/direction/tokens.ts` (the module does not exist).

- [ ] **Step 3: Extract `runtime/syntax.ts` from the highlighter**

Create `packages/video/src/runtime/syntax.ts`. Its `KEYWORDS` table (the `c`, `py`, and `sh` arrays) and `syntaxFamily` (0.2.0's `family`) are moved from `highlight.ts` unchanged; only the table's type annotation and the function's name are new:

```ts
/*
 * What Covi's code highlighting knows about languages, without the DOM: the runtime highlights
 * code lines with it, and Node tokenizes the lines a morph moves with it, so both color code alike.
 */

/** Languages grouped by how their code is highlighted. */
export type SyntaxFamily = 'c' | 'py' | 'sh' | 'css' | 'markup' | 'json' | 'sql';

const KEYWORDS: Record<'c' | 'py' | 'sh', readonly string[]> = {
  c: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'class',
    'extends',
    'import',
    'export',
    'from',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'interface',
    'type',
    'enum',
    'implements',
    'public',
    'private',
    'protected',
    'static',
    'readonly',
    'func',
    'package',
    'struct',
    'go',
    'defer',
    'fn',
    'pub',
    'impl',
    'mut',
    'match',
    'use',
    'mod',
    'in',
    'of',
    'as',
    'void',
    'null',
    'undefined',
    'true',
    'false',
    'nil',
    'this',
    'self',
    'super',
    'yield',
  ],
  py: [
    'def',
    'class',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'in',
    'not',
    'and',
    'or',
    'import',
    'from',
    'as',
    'with',
    'try',
    'except',
    'finally',
    'raise',
    'lambda',
    'yield',
    'pass',
    'None',
    'True',
    'False',
    'self',
    'async',
    'await',
    'end',
    'do',
    'module',
    'require',
    'nil',
  ],
  sh: [
    'if',
    'then',
    'fi',
    'for',
    'do',
    'done',
    'case',
    'esac',
    'echo',
    'export',
    'function',
    'return',
    'in',
  ],
};

export function syntaxFamily(language?: string): SyntaxFamily {
  switch (language) {
    case 'python':
    case 'ruby':
    case 'yaml':
    case 'toml':
      return 'py';
    case 'shell':
      return 'sh';
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 'css';
    case 'html':
    case 'vue':
    case 'svelte':
    case 'astro':
      return 'markup';
    case 'json':
      return 'json';
    case 'sql':
      return 'sql';
    default:
      return 'c';
  }
}

/** Words a family colors as keywords. */
export function keywordsOf(family: SyntaxFamily): ReadonlySet<string> {
  if (family === 'json') return new Set(['true', 'false', 'null']);
  if (family === 'sql') return new Set();
  return new Set(family === 'py' || family === 'sh' ? KEYWORDS[family] : KEYWORDS.c);
}

/** A family's comments: to the end of the line, or a block comment that closes on it. */
export function commentPattern(family: SyntaxFamily): RegExp {
  if (family === 'py' || family === 'sh') return /#.*$/;
  if (family === 'sql') return /--.*$/;
  return /\/\/.*$|\/\*.*?\*\//;
}
```

In `packages/video/src/runtime/highlight.ts`:

1. Delete the `KEYWORDS` declaration and the `family` function (both now live in `syntax.ts`).
2. Under `import { escapeHtml } from './dom.ts';` add `import { commentPattern, keywordsOf, syntaxFamily } from './syntax.ts';`. Keep the file's doc comment ("A deliberately small syntax highlighter …") above `const span = …`.
3. In `highlightLine`, replace `const fam = family(language);` with `const fam = syntaxFamily(language);`, and replace

```ts
  const kw = new Set(
    fam === 'json'
      ? ['true', 'false', 'null']
      : fam === 'sql'
        ? []
        : (KEYWORDS[fam] ?? KEYWORDS.c!),
  );
  const comment =
    fam === 'py' || fam === 'sh' ? /#.*$/ : fam === 'sql' ? /--.*$/ : /\/\/.*$|\/\*.*?\*\//;
```

with

```ts
  const kw = keywordsOf(fam);
  const comment = commentPattern(fam);
```

The highlighter's output is unchanged: the `markup` and `css` families return before these lines, and every other family reads the same keyword set and pattern as before.

- [ ] **Step 4: Add the morph's data types to the timeline**

In `packages/video/src/timeline/types.ts`, insert after `export type CameraMove = 'zoom' | 'pan' | 'follow';`:

```ts
/** A code token's syntax color: a `tk-` class of the code panel. */
export type TokenTone = 'keyword' | 'string' | 'number' | 'comment' | 'fn' | 'type' | 'prop';

/** A token of a line a morph moves: its text (a whitespace run is layout only) and its color. */
export interface MorphToken {
  text: string;
  tone?: TokenTone;
}

/** A row of a morph's base or head layout: a line of the hunk, or a run of lines it leaves out. */
export interface MorphRow {
  type: 'context' | 'del' | 'add' | 'elided';
  /** The line's number on its side; none for an elided run. */
  number?: number;
  /** The line's tokens; an elided run has one, its marker ("… 4 lines"). */
  tokens: MorphToken[];
}

/**
 * A hunk as a morph draws it: its lines before the change (`base`) and after it (`head`), at most
 * 14 rows a side (18 on tall frames), and what moves between them. `rows` links a base row to the
 * head row it becomes (context lines, replaced lines, and elided runs on both sides); `tokens`
 * links a token that stays, as `[baseRow, baseToken, headRow, headToken]`. A token in no link is
 * removed (base) or added (head).
 */
export interface MorphVisual {
  path: string;
  language?: string;
  base: MorphRow[];
  head: MorphRow[];
  rows: Array<[number, number]>;
  tokens: Array<[number, number, number, number]>;
}
```

- [ ] **Step 5: Bound the morph in `DIRECTION_LIMITS`**

In `packages/video/src/direction/schema.ts`, inside `DIRECTION_LIMITS`, after `evidencePerElement: 4,`:

```ts
  /**
   * A morph: at most `changedLines` deleted and as many added lines (a landscape card's 14 rows,
   * less two for context), read from the first `hunkLines` lines of its hunk, each cut at
   * `lineChars` characters and split into at most `tokensPerLine` tokens (the rest of a longer
   * line stays one token).
   */
  morph: { changedLines: 12, hunkLines: 400, lineChars: 96, tokensPerLine: 64 },
```

- [ ] **Step 6: Create `packages/video/src/direction/tokens.ts`**

```ts
import type { DiffLine } from '@covi/core';
import { commentPattern, keywordsOf, type SyntaxFamily, syntaxFamily } from '../runtime/syntax.ts';
import type { MorphRow, MorphToken, MorphVisual, TokenTone } from '../timeline/types.ts';
import { DIRECTION_LIMITS } from './schema.ts';

/*
 * A morph's model, built from a diff hunk: every line split into tokens, the lines a card keeps
 * when the hunk is longer than it shows, and what stays between the code before the change and
 * the code after it. Pure and deterministic: the same hunk gives the same morph.
 */

const LIMITS = DIRECTION_LIMITS.morph;

type Lexeme = 'comment' | 'string' | 'number' | 'word' | 'space' | 'other';

/**
 * The lexer: a comment, a string, a number, a word (letters of any script), a whitespace run, or
 * any one other character, so every character of a line lands in exactly one token.
 */
function lexer(family: SyntaxFamily): RegExp {
  return new RegExp(
    `(${commentPattern(family).source})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\d[\\d_.]*)|([\\p{L}\\p{M}_$][\\p{L}\\p{M}\\p{N}_$]*)|(\\s+)|(.)`,
    'gu',
  );
}

const LEXEMES: readonly Lexeme[] = ['comment', 'string', 'number', 'word', 'space', 'other'];

/** The words, numbers, spaces, and single characters inside a comment or a string. */
const PARTS = /[\p{L}\p{M}_$][\p{L}\p{M}\p{N}_$]*|\d[\d_.]*|\s+|./gu;

/** Whitespace is layout only: it is never kept, removed, or added. */
export const isSpace = (token: MorphToken) => /^\s+$/u.test(token.text);

/**
 * A line's lexemes. A line that opens or continues a block comment (it starts with a slash and a
 * star, or a star) reads as a comment, as it does in its file, though the line is read alone.
 */
function lex(line: string, family: SyntaxFamily): Array<{ text: string; kind: Lexeme }> {
  const inside = (family === 'c' || family === 'css') && /^(\s*)((?:\/\*|\*).*)$/u.exec(line);
  if (inside)
    return [
      ...(inside[1] ? [{ text: inside[1], kind: 'space' as const }] : []),
      { text: inside[2]!, kind: 'comment' as const },
    ];
  return [...line.matchAll(lexer(family))].map((m) => ({
    text: m[0],
    kind: LEXEMES[m.slice(1).findIndex((group) => group !== undefined)] ?? 'other',
  }));
}

/**
 * A line's tokens with their syntax colors, as the code panel colors them: keywords, strings
 * (JSON keys as props), numbers, comments, calls, and capitalized names. Comments and strings are
 * split into their words, so a changed word moves on its own. At most `tokensPerLine`; the rest
 * of a longer line stays one token.
 */
export function tokenize(line: string, language?: string): MorphToken[] {
  const family = syntaxFamily(language);
  const keywords = keywordsOf(family);
  const lexemes = lex(line, family);
  const tokens = lexemes.flatMap((l, i): MorphToken[] => {
    const next = lexemes.slice(i + 1).find((n) => n.kind !== 'space')?.text ?? '';
    const tone = toneOf(l, next, family, keywords);
    const parts =
      l.kind === 'comment' || l.kind === 'string'
        ? [...l.text.matchAll(PARTS)].map((m) => m[0])
        : [l.text];
    return parts.map((text) => (tone ? { text, tone } : { text }));
  });
  if (tokens.length <= LIMITS.tokensPerLine) return tokens;
  const rest = tokens.slice(LIMITS.tokensPerLine - 1);
  return [...tokens.slice(0, LIMITS.tokensPerLine - 1), { text: rest.map((t) => t.text).join('') }];
}

function toneOf(
  l: { text: string; kind: Lexeme },
  next: string,
  family: SyntaxFamily,
  keywords: ReadonlySet<string>,
): TokenTone | undefined {
  switch (l.kind) {
    case 'comment':
      return 'comment';
    case 'string':
      return family === 'json' && next.startsWith(':') ? 'prop' : 'string';
    case 'number':
      return 'number';
    case 'word':
      if (keywords.has(l.text) || (family === 'sql' && /^[A-Z]{2,}$/.test(l.text)))
        return 'keyword';
      if (next.startsWith('(')) return 'fn';
      return /^[A-Z]/.test(l.text) ? 'type' : undefined;
    default:
      return undefined;
  }
}

/**
 * The tokens two lines share, in order (a longest common subsequence of their non-space tokens,
 * weighed by length), as pairs of token indexes, and how many characters they hold.
 */
export function sharedTokens(
  a: readonly MorphToken[],
  b: readonly MorphToken[],
): { pairs: Array<[number, number]>; weight: number } {
  const ia = a.flatMap((t, i) => (isSpace(t) ? [] : [i]));
  const ib = b.flatMap((t, i) => (isSpace(t) ? [] : [i]));
  const text = (list: readonly MorphToken[], at: readonly number[], k: number) =>
    list[at[k]!]!.text;
  const best = Array.from({ length: ia.length + 1 }, () =>
    new Array<number>(ib.length + 1).fill(0),
  );
  for (let i = ia.length - 1; i >= 0; i--)
    for (let j = ib.length - 1; j >= 0; j--) {
      const same = text(a, ia, i) === text(b, ib, j);
      best[i]![j] = Math.max(
        same ? text(a, ia, i).length + best[i + 1]![j + 1]! : 0,
        best[i + 1]![j]!,
        best[i]![j + 1]!,
      );
    }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < ia.length && j < ib.length; ) {
    const t = text(a, ia, i);
    if (t === text(b, ib, j) && best[i]![j] === t.length + best[i + 1]![j + 1]!) {
      pairs.push([ia[i]!, ib[j]!]);
      i++;
      j++;
    } else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++;
    else j++;
  }
  return { pairs, weight: best[0]![0]! };
}

/** Two lines pair when they share at least this share of the shorter one's characters (and two). */
const PAIR_SHARE = 0.25;

/** A line's characters outside whitespace. */
const weightOf = (tokens: readonly MorphToken[]) =>
  tokens.reduce((n, t) => n + (isSpace(t) ? 0 : t.text.length), 0);

/**
 * Which added line replaces which deleted line in a block of changes: pairs in order, chosen to
 * keep the most characters in place. Lines that share little (a comma) are not paired: each folds
 * away, or slides in, on its own.
 */
export function pairLines(
  dels: ReadonlyArray<readonly MorphToken[]>,
  adds: ReadonlyArray<readonly MorphToken[]>,
): Array<[number, number]> {
  const w = dels.map((d) =>
    adds.map((a) => {
      const { weight } = sharedTokens(d, a);
      return weight >= Math.max(2, PAIR_SHARE * Math.min(weightOf(d), weightOf(a))) ? weight : 0;
    }),
  );
  const best = Array.from({ length: dels.length + 1 }, () =>
    new Array<number>(adds.length + 1).fill(0),
  );
  for (let i = dels.length - 1; i >= 0; i--)
    for (let j = adds.length - 1; j >= 0; j--)
      best[i]![j] = Math.max(
        w[i]![j]! > 0 ? w[i]![j]! + best[i + 1]![j + 1]! : -1,
        best[i + 1]![j]!,
        best[i]![j + 1]!,
      );
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < dels.length && j < adds.length; ) {
    if (w[i]![j]! > 0 && best[i]![j] === w[i]![j]! + best[i + 1]![j + 1]!) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const onBase = (l: Pick<DiffLine, 'kind'>) => l.kind !== 'add';
const onHead = (l: Pick<DiffLine, 'kind'>) => l.kind !== 'del';

interface Sides {
  base: number;
  head: number;
}

/**
 * The rows each side shows for the lines kept: the kept lines on that side, and one marker for
 * each run left out between kept lines that hides lines of that side. Runs at either end are cut,
 * as a code card cuts a hunk to its window.
 */
function rowsShown(lines: readonly DiffLine[], keep: readonly boolean[]): Sides {
  const rows = { base: 0, head: 0 };
  const hidden = { base: 0, head: 0 };
  let started = false;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      if (onBase(l)) hidden.base++;
      if (onHead(l)) hidden.head++;
      return;
    }
    if (started) {
      if (hidden.base) rows.base++;
      if (hidden.head) rows.head++;
    }
    hidden.base = 0;
    hidden.head = 0;
    started = true;
    if (onBase(l)) rows.base++;
    if (onHead(l)) rows.head++;
  });
  return rows;
}

/**
 * Which lines of a hunk a morph keeps when a side has more than `max` rows: the changed lines
 * first (in order, while they fit), then the context nearest them (closest first, the earlier on
 * a tie). A run left out between kept lines takes a row on each side it hides lines of, its
 * marker, so no side shows more than `max` rows, markers included.
 */
export function keptLines(lines: readonly DiffLine[], max: number): boolean[] {
  const keep = lines.map(() => false);
  const changed = lines.flatMap((l, i) => (l.kind === 'context' ? [] : [i]));
  const distance = (i: number) => Math.min(...changed.map((c) => Math.abs(c - i)));
  const context = lines
    .flatMap((l, i) => (l.kind === 'context' ? [i] : []))
    .sort((a, b) => distance(a) - distance(b) || a - b);
  const fits = () => {
    const rows = rowsShown(lines, keep);
    return rows.base <= max && rows.head <= max;
  };
  // A line refused while a run was left out beside it can fit once a neighbor closes the run, so
  // try again until nothing more fits.
  for (let grew = true; grew; ) {
    grew = false;
    for (const i of [...changed, ...context]) {
      if (keep[i]) continue;
      keep[i] = true;
      if (fits()) grew = true;
      else keep[i] = false;
    }
  }
  return keep;
}

/**
 * Why a hunk cannot morph, or nothing when it can: it needs code on both sides (a new or a
 * deleted file has nothing to turn into), and few enough changed lines on each side that every
 * one shows, with room for context.
 */
export function morphProblem(lines: readonly DiffLine[]): string | undefined {
  if (!lines.some(onBase))
    return 'the hunk has no lines before the change (a new file); show it as code';
  if (!lines.some(onHead))
    return 'the hunk has no lines after the change (a deleted file); show it as code';
  const most = LIMITS.changedLines;
  for (const [kind, side] of [
    ['del', 'base'],
    ['add', 'head'],
  ] as const) {
    const count = lines.filter((l) => l.kind === kind).length;
    if (count > most)
      return `the hunk changes ${count} lines on its ${side} side, and a morph shows at most ${most}; show it as code, with \`lines\``;
  }
  return undefined;
}

export interface MorphOptions {
  /** The rows a side shows at most: 14, or 18 on tall frames. */
  max: number;
  language?: string;
  /** The marker for a run of `count` lines left out, in the video's language. */
  elided: (count: number) => string;
}

/**
 * A hunk as a morph shows it: the rows of each side (elided to `max`), the rows that become each
 * other (context lines, replaced lines, and elided runs on both sides), and the tokens that stay.
 * Nothing when a side has no lines (a new or a deleted file has nothing to turn into).
 */
export function morphHunk(
  lines: readonly DiffLine[],
  options: MorphOptions,
): Omit<MorphVisual, 'path' | 'language'> | undefined {
  if (!lines.some(onBase) || !lines.some(onHead)) return undefined;
  // Lines past the read limit are cut like a run at the end: a hunk that long fills a card first.
  const read = lines.slice(0, LIMITS.hunkLines);
  const keep = keptLines(read, options.max);
  const base: MorphRow[] = [];
  const head: MorphRow[] = [];
  const rows: MorphVisual['rows'] = [];
  const tokens: MorphVisual['tokens'] = [];
  const link = (b: number, h: number, pairs: ReadonlyArray<readonly [number, number]>) => {
    rows.push([b, h]);
    for (const [i, j] of pairs) tokens.push([b, i, h, j]);
  };
  const tokensOf = (text: string) =>
    tokenize(text.replace(/\t/g, '  ').slice(0, LIMITS.lineChars), options.language);
  const numbered = (n: number | undefined) => (n === undefined ? {} : { number: n });
  // The changed rows since the last context line or marker: a block whose lines may pair.
  let dels: number[] = [];
  let adds: number[] = [];
  const closeBlock = () => {
    const pairs = pairLines(
      dels.map((r) => base[r]!.tokens),
      adds.map((r) => head[r]!.tokens),
    );
    for (const [i, j] of pairs) {
      const [b, h] = [dels[i]!, adds[j]!];
      link(b, h, sharedTokens(base[b]!.tokens, head[h]!.tokens).pairs);
    }
    dels = [];
    adds = [];
  };
  const hidden = { base: 0, head: 0 };
  // A run left out between kept lines becomes a marker on each side it hides lines of.
  const closeHidden = () => {
    if (!hidden.base && !hidden.head) return;
    closeBlock();
    const marker = (count: number): MorphRow => ({
      type: 'elided',
      tokens: [{ text: options.elided(count) }],
    });
    const b = hidden.base ? base.push(marker(hidden.base)) - 1 : -1;
    const h = hidden.head ? head.push(marker(hidden.head)) - 1 : -1;
    if (b >= 0 && h >= 0)
      link(b, h, base[b]!.tokens[0]!.text === head[h]!.tokens[0]!.text ? [[0, 0]] : []);
    hidden.base = 0;
    hidden.head = 0;
  };
  read.forEach((l, i) => {
    if (!keep[i]) {
      if (onBase(l)) hidden.base++;
      if (onHead(l)) hidden.head++;
      return;
    }
    if (base.length || head.length) closeHidden();
    hidden.base = 0;
    hidden.head = 0;
    const t = tokensOf(l.text);
    if (l.kind === 'context') {
      closeBlock();
      const b = base.push({ type: 'context', ...numbered(l.oldLine), tokens: t }) - 1;
      const h = head.push({ type: 'context', ...numbered(l.newLine), tokens: [...t] }) - 1;
      link(
        b,
        h,
        t.flatMap((token, k): Array<[number, number]> => (isSpace(token) ? [] : [[k, k]])),
      );
    } else if (l.kind === 'del')
      dels.push(base.push({ type: 'del', ...numbered(l.oldLine), tokens: t }) - 1);
    else adds.push(head.push({ type: 'add', ...numbered(l.newLine), tokens: t }) - 1);
  });
  closeBlock();
  return { base, head, rows, tokens };
}
```

Notes for the reviewer: `lexer` builds its pattern from the same comment pattern the highlighter uses, so a comment ends where the code card's does; the final `(.)` alternative makes every character land in a token (an unclosed quote included). `keptLines` retries until nothing more fits because a line refused while a long run surrounded it can fit once a neighbor closes the run (a marker costs a row, the line costs one too). `rowsShown` and `morphHunk` agree on one rule: a run left out *between* kept lines is a marker on each side it hides lines of; runs at either end are cut.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/tokens.test.ts`
Expected: PASS (14 tests).

Then `npm run typecheck && npx biome check --write packages/video/src packages/video/test && npm run lint`, and in the background `npx vitest run tests/render/render.test.ts` (its code-card renders exercise the highlighter after the move): expected PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/video/src/runtime/syntax.ts packages/video/src/runtime/highlight.ts packages/video/src/timeline/types.ts packages/video/src/direction/schema.ts packages/video/src/direction/tokens.ts packages/video/test/tokens.test.ts
git commit -m "$(cat <<'EOF'
Build a token morph's model from a diff hunk: tokens, pairs, and elision

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 2: Drawing a morph — the timeline element, its settle time, and the runtime component

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (`DirectionElement`, `DirectionBeat`)
- Modify: `packages/video/src/timeline/cues.ts` (before `shotSettledAt`; inside it)
- Modify: `packages/video/src/density.ts` (`LOOKS_LIKE`)
- Modify: `packages/video/src/runtime/components/types.ts` (`Component`)
- Create: `packages/video/src/runtime/direction/morph.ts`
- Modify: `packages/video/src/runtime/direction/elements.ts` (import, `mountShot`, `draw`)
- Modify: `packages/video/src/runtime/styles.ts` (after the `.code .caret` rule)
- Create: `packages/video/test/morph-timeline.test.ts`
- Create: `tests/render/morph.test.ts`
- Modify: `tests/direction-security.test.ts` (the render test's staging and expectations)

**Interfaces:**
- Consumes: `MorphVisual`, `MorphRow`, `MorphToken`, `TokenTone` (Task 1); `morphHunk` (Task 1, in the render test); B1's `codeFont`, `cardHeight`, `drawnFont`; B2's `lerpRect`, `mountShot`, `shotSettledAt`, `LOOKS_LIKE`.
- Produces:
  ```ts
  // packages/video/src/timeline/types.ts
  // DirectionElement gains: | { id: string; kind: 'morph'; rect: Rect; morph: MorphVisual }
  // DirectionBeat gains:    | { verb: 'morph'; element: string; t: number; seconds: number }

  // packages/video/src/timeline/cues.ts
  export const MORPH_PHASES: { readonly remove: readonly [0, 0.7]; readonly travel: readonly [0.1, 0.9]; readonly add: readonly [0.35, 1] };
  export const MORPH_SETTLE = 0.5;

  // packages/video/src/runtime/components/types.ts — Component gains
  follow?(t: number): Rect | undefined;   // a moving target's box, laid out (before transforms), pure in t

  // packages/video/src/runtime/direction/morph.ts
  export function morph(v: MorphVisual, ctx: ComponentContext, span: Span): Component;
  // DOM: `.code.mono.tokens` panel > `.code-head` + `.mlive` holding absolutely placed spans:
  // `.tok[data-token="kept|removed|added"]` (with `tk-<tone>`, and `elided` for a marker),
  // `.mnum` (line numbers), `.mmark.add|.del`, `.mbar.add|.del` (row tints).
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/morph-timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { leadKind } from '../src/density.ts';
import { MORPH_SETTLE, shotSettledAt } from '../src/timeline/cues.ts';
import type { TimelineScene } from '../src/timeline/types.ts';

describe('a morph on the timeline', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const directed = {
    id: 's',
    beat: 's',
    eyebrow: 's',
    start: 0,
    end: 8,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    direction: {
      whole: false,
      elements: [
        {
          id: 'm',
          kind: 'morph',
          rect,
          morph: { path: 'a.js', base: [], head: [], rows: [], tokens: [] },
        },
      ],
      beats: [{ verb: 'morph', element: 'm', t: 2, seconds: 1.6 }],
    },
  } as TimelineScene;

  it('settles once the added tokens have taken their colors', () => {
    expect(shotSettledAt(directed)).toBeCloseTo(2 + 1.6 + MORPH_SETTLE, 9);
  });

  it('reads as code for the monotony check', () => {
    expect(leadKind(directed)).toBe('code');
  });
});
```

Create `tests/render/morph.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiffLine, resolveConfig } from '@covi/core';
import {
  buildTimeline,
  type DirectionBeat,
  type LayoutReport,
  layoutScenes,
  pacingFor,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { morphHunk } from '../../packages/video/src/direction/tokens.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * The token morph, drawn in Chromium from a timeline built by hand (a morph element and its
 * beats, as the resolver writes them): kept tokens travel, removed lines fold away, new lines
 * slide in, the camera follows the changed lines, and the same timeline draws the same bytes.
 * Files under tests/ are typechecked without DOM types, so the page reads its own elements.
 */

const available = await canUseBrowser();
const dirs: string[] = [];
let browser: Browser | undefined;
beforeAll(async () => {
  if (available) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const W = 640;
const H = 360;
const { media } = computeRegions({ width: W, height: H, orientation: 'landscape' });
const context = (text: string, oldLine: number, newLine = oldLine): DiffLine => ({
  kind: 'context',
  text,
  oldLine,
  newLine,
});
const del = (text: string, n: number): DiffLine => ({ kind: 'del', text, oldLine: n });
const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, newLine: n });

// The benchmark's change, cut to its second block, with a blank line and a comment it drops.
const refs: DiffLine[] = [
  context('export function buildReviewRequest(store, ids) {', 43, 46),
  context('  return chunk(', 44, 47),
  context('', 45, 48),
  del('    // every document, in full', 46),
  del("    'documents',", 47),
  del('    ids.map((id) => store.get(id)),', 48),
  add("    'refs',", 49),
  add('    ids.map((id) => {', 50),
  add('      const { title, body } = store.get(id);', 51),
  add('      return { id, title, bytes: Buffer.byteLength(body) };', 52),
  add('    }),', 53),
  context('  );', 49, 54),
  context('}', 50, 55),
];
const MORPH: DirectionBeat = { verb: 'morph', element: 'm', t: 2, seconds: 1.6 };

/**
 * A two-scene 640×360 composition whose second scene morphs `lines` on `beats` (seconds since that
 * scene started), opened in Chromium.
 */
async function morphed(lines: DiffLine[], beats: DirectionBeat[] = [MORPH]) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-morph-'));
  dirs.push(dir);
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width: W, height: H });
  const scenes = StoryboardSchema.parse({
    title: 'Send only the ids',
    template: 'bug-fix',
    scenes: [
      {
        id: 's1',
        beat: 'problem',
        narration: 'The request carried every document.',
        visual: { kind: 'callout', title: 'Before' },
      },
      {
        id: 's2',
        beat: 'fix',
        narration: 'Now it sends only the ids, and the reader fetches each document itself.',
        minSeconds: 7,
        visual: { kind: 'callout', title: 'After' },
      },
    ],
  }).scenes;
  const model = morphHunk(lines, {
    max: 14,
    language: 'javascript',
    elided: (count) => `… ${count} lines`,
  })!;
  const staging: SceneStaging[] = [
    {
      stop: { x: 0, y: 0 },
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect: media }],
        beats: [],
      },
    },
    {
      stop: { x: 800, y: 0 },
      direction: {
        whole: false,
        elements: [
          {
            id: 'm',
            kind: 'morph',
            rect: media,
            morph: { path: 'src/request.js', language: 'javascript', ...model },
          },
        ],
        beats,
      },
    },
  ];
  const timeline = buildTimeline({
    title: 'Send only the ids',
    scenes,
    layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
    spec,
    image: () => ({ src: '', width: 1, height: 1 }),
    staging,
  });
  const composition = join(dir, 'composition');
  await writeComposition(composition, timeline, new Map());
  const page = await browser!.newPage({ viewport: { width: W, height: H } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(composition, 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const s2 = timeline.scenes.find((s) => s.id === 's2')!;
  /** The frame `seconds` into the morphing scene. */
  const at = (seconds: number) => Math.round((s2.start + seconds) * timeline.fps);
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  /** The morph's tokens at a frame: what each is, its place in the card, its fold, its opacity. */
  const pieces = (frame: number) =>
    seek(
      frame,
      `return [...document.querySelectorAll('[data-element="m"] .mlive [data-token]')].map((n) => {
         const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)(?: scaleY\\(([\\d.]+)\\))?/.exec(n.style.transform);
         return { token: n.dataset.token, text: n.textContent, x: Number(m[1]), y: Number(m[2]),
           fold: m[3] === undefined ? 1 : Number(m[3]), opacity: Number(n.style.opacity || '1') };
       });`,
    ) as Promise<
      Array<{ token: string; text: string; x: number; y: number; fold: number; opacity: number }>
    >;
  /** The canvas camera on the morphing scene: its layer's offset and scale. */
  const camera = async (frame: number) => {
    const transform = (await seek(
      frame,
      `return document.querySelector('[data-scene="s2"] > .stop-view > .layer').style.transform;`,
    )) as string;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(transform)!;
    return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) };
  };
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, at, seek, pieces, camera, report, shot, errors };
}

type Pieces = Awaited<ReturnType<Awaited<ReturnType<typeof morphed>>['pieces']>>;
const find = (all: Pieces, token: string, text: string) =>
  all.find((p) => p.token === token && p.text === text)!;

describe.skipIf(!available)('the token morph', () => {
  it('turns the code before into the code after: kept tokens travel, removed lines fold, new ones arrive', async () => {
    const v = await morphed(refs);
    const k = (share: number) => v.pieces(v.at(MORPH.t + MORPH.seconds * share));
    const [before, mid, after] = [await k(-0.2), await k(0.5), await k(1.1)];
    // `map` stays, moving up a row as the dropped comment folds away above it.
    const map = [before, mid, after].map((all) => find(all, 'kept', 'map'));
    expect(map[0]!.y).toBeGreaterThan(map[2]!.y + 1);
    expect(map[1]!.y).toBeLessThan(map[0]!.y - 0.5);
    expect(map[1]!.y).toBeGreaterThan(map[2]!.y + 0.5);
    // The comment shares nothing with what replaced it: it fades and folds where it was.
    const every = [before, mid, after].map((all) => find(all, 'removed', 'every'));
    expect(every[0]).toMatchObject({ opacity: 1, fold: 1 });
    expect(every[1]!.opacity).toBeGreaterThan(0.05);
    expect(every[1]!.opacity).toBeLessThan(0.95);
    expect(every[1]!.fold).toBeLessThan(0.9);
    expect(every[2]!.opacity).toBe(0);
    // A new line slides in, partly there at the middle of the morph.
    const added = [before, mid, after].map((all) => find(all, 'added', 'byteLength'));
    expect(added[0]!.opacity).toBe(0);
    expect(added[1]!.opacity).toBeGreaterThan(0.05);
    expect(added[1]!.opacity).toBeLessThan(0.95);
    expect(added[1]!.x).toBeLessThan(added[2]!.x);
    expect(added[2]!.opacity).toBe(1);
    expect(v.errors).toEqual([]);
  });

  it('settles on the code after the change, reported as code for QC', async () => {
    const v = await morphed(refs);
    const frame = v.at(MORPH.t + MORPH.seconds + 0.6);
    const card = (await v.report(frame)).items.find((i) => i.text === 'code')!;
    expect(card.font).toBeGreaterThan(0);
    const shown = (await v.pieces(frame)).filter((p) => p.opacity > 0).map((p) => p.text);
    expect(shown).toEqual(expect.arrayContaining(['refs', 'byteLength', 'buildReviewRequest']));
    expect(shown).not.toContain('documents');
  });

  it('is deterministic: the same timeline renders the same mid-morph bytes', async () => {
    const [a, b] = [await morphed(refs), await morphed(refs)];
    const frame = a.at(MORPH.t + MORPH.seconds / 2);
    expect((await a.shot(frame)).equals(await b.shot(frame))).toBe(true);
  });

  it('marks the lines it leaves out of a long hunk', async () => {
    const long: DiffLine[] = [
      ...Array.from({ length: 6 }, (_, i) => add(`first${i}();`, i + 1)),
      ...Array.from({ length: 6 }, (_, i) => context(`keep${i}();`, i + 1, i + 7)),
      ...Array.from({ length: 6 }, (_, i) => add(`then${i}();`, i + 13)),
    ];
    const v = await morphed(long);
    const shown = await v.pieces(v.at(MORPH.t + MORPH.seconds + 0.6));
    expect(shown.filter((p) => p.text.startsWith('…') && p.opacity > 0).map((p) => p.text)).toEqual(
      ['… 5 lines'],
    );
  });

  it('opens room for lines added between others, and moves the code below down', async () => {
    const insertion: DiffLine[] = [
      context('function take(qty) {', 10),
      add('  if (qty <= 0) return 0;', 11),
      context('  return qty - 1;', 11, 12),
      context('}', 12, 13),
    ];
    const v = await morphed(insertion);
    const [before, after] = [
      await v.pieces(v.at(1)),
      await v.pieces(v.at(MORPH.t + MORPH.seconds + 0.1)),
    ];
    expect(find(after, 'kept', 'qty').y).toBeGreaterThanOrEqual(find(before, 'kept', 'qty').y);
    const below = (all: Pieces) => all.filter((p) => p.token === 'kept' && p.text === '1').at(-1)!;
    expect(below(after).y).toBeGreaterThan(below(before).y + 1);
    expect(find(after, 'added', 'if').opacity).toBe(1);
    expect(v.errors).toEqual([]);
  });

  it('plays on its own clock when it is revealed later', async () => {
    const v = await morphed(refs, [
      { verb: 'reveal', element: 'm', style: 'rise', t: 1, seconds: 0.5 },
      MORPH,
    ]);
    const mid = await v.pieces(v.at(MORPH.t + MORPH.seconds / 2));
    const added = find(mid, 'added', 'byteLength');
    expect(added.opacity).toBeGreaterThan(0.05);
    expect(added.opacity).toBeLessThan(0.95);
  });
});
```

In `tests/direction-security.test.ts`, inside the render test `is drawn as text: no element, no script, exactly the characters it holds`, append this element to the second scene's `elements`, after element `d` (a morph whose tokens carry markup, as if they had slipped past everything before the page):

```ts
            {
              id: 'e',
              kind: 'morph',
              rect: slot(470),
              morph: {
                path: 'x.js',
                base: [{ type: 'del', tokens: [{ text: smuggled }] }],
                head: [{ type: 'add', tokens: [{ text: line }] }],
                rows: [],
                tokens: [],
              },
            },
```

and replace that scene's `beats: [],` with `beats: [{ verb: 'morph', element: 'e', t: 0.5, seconds: 1 }],`.

In the same test's page script, after the `code: …` line, add

```ts
             morph: [...document.querySelectorAll('[data-element="e"] .mlive [data-token]')].map((n) => n.textContent),
```

add `morph: string[];` to the result's type after `code: string;`, and add `morph: [smuggled, line],` to the expected object after `code: line,`. (The existing `injected` query already counts any `img`, `script`, or `b` under `[data-element]`, so it now covers the morph's tokens too.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/morph-timeline.test.ts tests/render/morph.test.ts tests/direction-security.test.ts`
Expected: FAIL — `MORPH_SETTLE` is not exported from `cues.ts`; the render tests find no `[data-element="m"] .mlive` (nothing draws a morph yet), and `find(…)` returns undefined.

- [ ] **Step 3: Add the morph element and beat to the timeline**

In `packages/video/src/timeline/types.ts`, in `DirectionElement`, insert before `| { id: string; kind: 'node'; rect: Rect; label: string }`:

```ts
  | { id: string; kind: 'morph'; rect: Rect; morph: MorphVisual }
```

and in `DirectionBeat`, replace the `camera` member's trailing `;` so the union reads:

```ts
export type DirectionBeat =
  | { verb: 'reveal'; element: string; style: RevealStyle; t: number; seconds: number }
  | { verb: 'camera'; move: CameraMove; to: string; zoom?: number; t: number; seconds: number }
  | { verb: 'morph'; element: string; t: number; seconds: number };
```

- [ ] **Step 4: Time a morph in `cues.ts`, and count it as code in `density.ts`**

In `packages/video/src/timeline/cues.ts`, insert before the doc comment of `shotSettledAt`:

```ts
/**
 * A token morph's phases, as shares of its beat: removed tokens tint and fade over `remove`, the
 * rows close up and kept tokens travel over `travel`, and added tokens arrive over `add`. They
 * overlap, so the middle of a morph shows all three at once.
 */
export const MORPH_PHASES = {
  remove: [0, 0.7],
  travel: [0.1, 0.9],
  add: [0.35, 1],
} as const satisfies Record<string, Span>;
/** Added tokens keep the added color this long after a morph, then take their syntax colors. */
export const MORPH_SETTLE = 0.5;
```

In `shotSettledAt`'s doc comment, replace "(the storyboard visual on the scene's phases, the others from their reveal), and every beat has ended." with "(the storyboard visual on the scene's phases, the others from their reveal; a morph once its added tokens have settled), and every beat has ended." In its body, right after `const at = revealedAt(e.id);`, insert:

```ts
    if (e.kind === 'morph') {
      const beat = d.beats.find((b) => b.verb === 'morph' && b.element === e.id);
      return Math.max(at + 0.5, beat ? beat.t + beat.seconds + MORPH_SETTLE : 0);
    }
```

(Without it the next line would read `e.visual`, which a morph does not have, and TypeScript says so.)

In `packages/video/src/density.ts`, add `morph: 'code',` to `LOOKS_LIKE` after `capture: 'screenshot',`: a morph is a dark code card, for monotony and the empty-frame check alike.

- [ ] **Step 5: Let a component report a moving target**

In `packages/video/src/runtime/components/types.ts`, in `interface Component`, after the `target?(clock: SceneClock): Rect | undefined;` member:

```ts
  /**
   * Where a moving target is laid out `t` seconds into the component's clock (a morph's changed
   * lines), in stage pixels before any transform; pure, so the camera can follow it at any frame.
   */
  follow?(t: number): Rect | undefined;
```

- [ ] **Step 6: Create `packages/video/src/runtime/direction/morph.ts`**

```ts
import { MORPH_PHASES, MORPH_SETTLE, type Span } from '../../timeline/cues.ts';
import type { MorphRow, MorphVisual, Rect, TokenTone } from '../../timeline/types.ts';
import { easeInCubic, easeInOutCubic, easeOutCubic, lerp, rise, seg } from '../anim.ts';
import { lerpRect } from '../canvas.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  entered,
  rectOf,
} from '../components/types.ts';
import { el } from '../dom.ts';
import { union } from '../narrator.ts';
import { cardHeight, codeFont } from '../sizing.ts';

/*
 * A token morph: the hunk's code before the change turns into the code after it. Both layouts are
 * laid out once, at mount (fonts loaded, nothing transformed yet), and every frame places each
 * token between its two boxes: kept tokens travel, removed ones tint and fade with their row as it
 * folds away, added ones slide in as their row opens. Every value is a function of the frame time.
 */

/** A row as laid out, relative to the card: its box, and where its number, mark, and tokens sit. */
interface Laid {
  box: Rect;
  number?: Rect;
  mark: Rect;
  text: Rect;
  tokens: Rect[];
}

/** How far an added token slides in from, in ems. */
const SLIDE = 0.6;
/** Removed tokens and marks tint over this share of the morph, from its start. */
const TINT = 0.12;

/** The card's rows laid out in the panel's flow, with `top` above the first. */
function layOut(
  rows: readonly MorphRow[],
  body: HTMLElement,
  panel: HTMLElement,
  top: number,
): Laid[] {
  body.replaceChildren();
  body.style.paddingTop = `${top}px`;
  const nodes = rows.map((row) => {
    const line = el('div', `ln ${row.type}`, body);
    const gutter = el('span', 'gutter', line);
    const number =
      row.number === undefined ? undefined : el('span', '', gutter, String(row.number));
    const mark = el(
      'span',
      'mark',
      line,
      row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ',
    );
    const txt = el('span', 'txt', line);
    const tokens = row.tokens.map((t) => el('span', '', txt, t.text));
    if (!tokens.length) txt.textContent = ' ';
    return { line, number, mark, txt, tokens };
  });
  const origin = panel.getBoundingClientRect();
  const rel = (node: Element): Rect => {
    const r = node.getBoundingClientRect();
    return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
  };
  return nodes.map((n) => ({
    box: rel(n.line),
    ...(n.number ? { number: rel(n.number) } : {}),
    mark: rel(n.mark),
    text: rel(n.txt),
    tokens: n.tokens.map(rel),
  }));
}

/** `a` mixed toward `b` by `k`, for two `#rrggbb` colors; otherwise whichever `k` is nearer. */
function mix(a: string, b: string, k: number): string {
  const hex = /^#([0-9a-f]{6})$/i;
  const [ha, hb] = [hex.exec(a), hex.exec(b)];
  if (!ha || !hb) return k < 0.5 ? a : b;
  const channel = (h: string, i: number) => Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const rgb = [0, 1, 2].map((i) => Math.round(lerp(channel(ha[1]!, i), channel(hb[1]!, i), k)));
  return `rgb(${rgb.join(', ')})`;
}

/** Where a row of one layout sits before and after the morph, and whether it folds or opens. */
interface Path {
  from: number;
  to: number;
  /** The row exists on one side only: it folds away (base) or opens (head). */
  alone: boolean;
}

/**
 * Each row's vertical path. A linked row travels from its box on one side to its box on the
 * other; a row on one side only moves with the nearest linked row above it (else below it), so it
 * folds away, or opens, between the rows that stay.
 */
function paths(
  own: readonly Laid[],
  other: readonly Laid[],
  links: ReadonlyMap<number, number>,
  base: boolean,
): Path[] {
  const shift = (i: number) => {
    const j = links.get(i)!;
    return (other[j]!.box.y - own[i]!.box.y) * (base ? 1 : -1);
  };
  const linked = [...links.keys()].sort((a, b) => a - b);
  return own.map((row, i) => {
    const j = links.get(i);
    if (j !== undefined)
      return base
        ? { from: row.box.y, to: other[j]!.box.y, alone: false }
        : { from: other[j]!.box.y, to: row.box.y, alone: false };
    const anchor = linked.filter((l) => l < i).at(-1) ?? linked.find((l) => l > i);
    const dy = anchor === undefined ? 0 : shift(anchor);
    return base
      ? { from: row.box.y, to: row.box.y + dy, alone: true }
      : { from: row.box.y - dy, to: row.box.y, alone: true };
  });
}

/** An absolutely placed piece of the live card: a token, a line number, a mark, or a row's tint. */
function piece(parent: HTMLElement, className: string, text: string, height: number): HTMLElement {
  const node = el('span', className, parent, text);
  Object.assign(node.style, { height: `${height}px`, lineHeight: `${height}px` });
  return node;
}

const place = (node: HTMLElement, x: number, y: number, scaleY = 1) => {
  node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)${scaleY < 1 ? ` scaleY(${scaleY.toFixed(4)})` : ''}`;
};

export function morph(v: MorphVisual, ctx: ComponentContext, span: Span): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const panel = el('div', 'code mono tokens', ctx.root);
  const head = el('div', 'code-head', panel);
  el('span', 'dot', head);
  el('span', 'file', head, v.path);
  if (v.language) el('span', '', head, v.language);
  const body = el('div', 'lines', panel);
  // Sized like a code card for the longer of its two sides.
  const rows = Math.max(v.base.length, v.head.length);
  const text = (r: MorphRow) => r.tokens.map((t) => t.text).join('');
  const lengths = [...v.base, ...v.head].map((r) => text(r).length + 7).sort((a, b) => a - b);
  const typical = Math.max(28, lengths[Math.floor((lengths.length - 1) * 0.9)] ?? 28);
  const font = codeFont(
    Math.min(
      (box.width - ctx.u(40)) / (typical * 0.61),
      (box.height - ctx.u(90)) / (rows * 1.55 + 1.2),
    ),
    ctx.timeline.orientation,
    ctx.regions.unit,
  );
  body.style.fontSize = `${font}px`;
  const natural = Math.min(box.height, rows * font * 1.55 + font * 1.2 + ctx.u(66));
  const height = cardHeight(box, box.width, natural);
  const top = box.y + (box.height - height) / 2;
  Object.assign(panel.style, {
    left: `${box.x}px`,
    top: `${top}px`,
    width: `${box.width}px`,
    height: `${height}px`,
  });
  // Both sides start at the same line, so the code above the first change stays where it is.
  const pad = ctx.u(14) + (height - natural) / 2;
  const before = layOut(v.base, body, panel, pad);
  const after = layOut(v.head, body, panel, pad);
  body.remove();

  const forward = new Map(v.rows);
  const backward = new Map(v.rows.map(([b, h]) => [h, b]));
  const basePaths = paths(before, after, forward, true);
  const headPaths = paths(after, before, backward, false);
  const live = el('div', 'mlive', panel);
  live.style.fontSize = `${font}px`;
  const color = (tone: TokenTone | undefined) => (tone ? theme.syntax[tone] : theme.codeText);
  const keptBase = new Set(v.tokens.map(([b, i]) => `${b}:${i}`));
  const keptHead = new Set(v.tokens.map(([, , h, j]) => `${h}:${j}`));
  const blank = (s: string) => /^\s*$/u.test(s);
  const tone = (t: { tone?: TokenTone }) => (t.tone ? ` tk-${t.tone}` : '');

  // Each piece draws itself `k` (0–1) of the way through the morph; `settle` follows it.
  const draws: Array<(k: number, settle: number) => void> = [];
  const phase = (k: number) => ({
    travel: easeInOutCubic(seg(k, ...MORPH_PHASES.travel)),
    gone: easeInCubic(seg(k, ...MORPH_PHASES.remove)),
    arrive: easeOutCubic(seg(k, ...MORPH_PHASES.add)),
    tint: seg(k, 0, TINT),
  });

  const rowItems = (
    laid: readonly Laid[],
    rowsOf: readonly MorphRow[],
    path: readonly Path[],
    side: 'base' | 'head',
  ) =>
    laid.forEach((row, r) => {
      const p = path[r]!;
      const y = (travel: number) => lerp(p.from, p.to, travel);
      const fold = (travel: number) => (p.alone ? (side === 'base' ? 1 - travel : travel) : 1);
      const type = rowsOf[r]!.type;
      // A changed row's tint shows from the morph's start (removed) or as it arrives (added).
      if (type === 'del' || type === 'add') {
        const bar = piece(live, `mbar ${type}`, '', row.box.height);
        Object.assign(bar.style, { width: `${row.box.width}px` });
        const mark = piece(live, `mmark ${type}`, type === 'add' ? '+' : '−', row.box.height);
        draws.push((k) => {
          const f = phase(k);
          const shown = type === 'del' ? Math.min(f.tint, 1 - f.gone) : f.arrive;
          for (const node of [bar, mark]) node.style.opacity = shown.toFixed(3);
          place(bar, row.box.x, y(f.travel), fold(f.travel));
          place(mark, row.mark.x, y(f.travel), fold(f.travel));
        });
      }
      const number = rowsOf[r]!.number;
      const other = side === 'base' ? forward.get(r) : backward.get(r);
      const twin =
        other === undefined ? undefined : (side === 'base' ? v.head : v.base)[other]!.number;
      if (row.number && number !== undefined && !(side === 'head' && twin === number)) {
        const n = piece(live, 'mnum', String(number), row.box.height);
        // A number both sides share travels once (drawn from the base); others cross-fade.
        const shared = side === 'base' && twin === number;
        const to = shared ? (after[other!]!.number ?? row.number) : row.number;
        draws.push((k) => {
          const f = phase(k);
          n.style.opacity = (shared ? 1 : side === 'base' ? 1 - f.travel : f.travel).toFixed(3);
          place(n, lerp(row.number!.x, to.x, shared ? f.travel : 0), y(f.travel), fold(f.travel));
        });
      }
      rowsOf[r]!.tokens.forEach((t, i) => {
        if (blank(t.text) || (side === 'base' ? keptBase : keptHead).has(`${r}:${i}`)) return;
        const at = row.tokens[i]!;
        const node = piece(
          live,
          `tok${tone(t)}${type === 'elided' ? ' elided' : ''}`,
          t.text,
          row.box.height,
        );
        node.dataset.token = side === 'base' ? 'removed' : 'added';
        draws.push((k, settle) => {
          const f = phase(k);
          if (side === 'base') {
            node.style.opacity = (1 - f.gone).toFixed(3);
            node.style.color = f.tint > 0 ? mix(color(t.tone), theme.delText, f.tint) : '';
            place(node, at.x, y(f.travel), fold(f.travel));
          } else {
            node.style.opacity = f.arrive.toFixed(3);
            node.style.color = settle < 1 ? mix(theme.addText, color(t.tone), settle) : '';
            place(node, at.x - (1 - f.arrive) * SLIDE * font, y(f.travel), fold(f.travel));
          }
        });
      });
    });
  rowItems(before, v.base, basePaths, 'base');
  rowItems(after, v.head, headPaths, 'head');
  for (const [b, i, h, j] of v.tokens) {
    const t = v.base[b]!.tokens[i]!;
    const [from, to] = [before[b]!.tokens[i]!, after[h]!.tokens[j]!];
    const node = piece(
      live,
      `tok${tone(t)}${v.base[b]!.type === 'elided' ? ' elided' : ''}`,
      t.text,
      before[b]!.box.height,
    );
    node.dataset.token = 'kept';
    draws.push((k) => {
      const { travel } = phase(k);
      place(node, lerp(from.x, to.x, travel), lerp(before[b]!.box.y, after[h]!.box.y, travel));
    });
  }

  /**
   * The changed lines on one side, relative to the card: from the row's start (its number) to the
   * end of its longest text, so a zoomed camera keeps the start of the lines in view.
   */
  const changed = (laid: readonly Laid[], rowsOf: readonly MorphRow[], type: 'del' | 'add') => {
    const boxes = laid.flatMap((row, r) =>
      rowsOf[r]!.type === type
        ? [
            {
              x: row.box.x,
              y: row.box.y,
              width:
                Math.max(row.text.x + font, ...row.tokens.map((t) => t.x + t.width)) - row.box.x,
              height: row.box.height,
            },
          ]
        : [],
    );
    return boxes.length ? union(boxes) : undefined;
  };
  const removed = changed(before, v.base, 'del');
  const added = changed(after, v.head, 'add');
  const start = removed ?? added ?? before[0]!.box;
  const end = added ?? removed ?? after[0]!.box;
  /** Where the changed lines are `t` seconds in, relative to the card. */
  const focus = (t: number) => lerpRect(start, end, phase(seg(t, ...span)).travel);

  return {
    update(clock) {
      rise(panel, entered(clock, 0, 0.5), ctx.u(30));
      const k = seg(clock.t, ...span);
      const settle = seg(clock.t, span[1], span[1] + MORPH_SETTLE);
      for (const draw of draws) draw(k, settle);
    },
    report: () => [{ role: 'media', rect: rectOf(panel), font: drawnFont(live), text: 'code' }],
    // The narrator points at the changed lines as drawn, wherever the camera has them.
    target: (clock) => {
      const at = focus(clock.t);
      const p = panel.getBoundingClientRect();
      const s = p.width / (panel.offsetWidth || p.width || 1);
      return { x: p.x + at.x * s, y: p.y + at.y * s, width: at.width * s, height: at.height * s };
    },
    // The camera follows the changed lines as laid out, so it can aim at any frame.
    follow: (t) => {
      const at = focus(t);
      return { ...at, x: box.x + at.x, y: top + at.y };
    },
  };
}
```

How it stays a pure function of the frame: `layOut` reads the boxes once, at mount, while the stage has displayed every scene untransformed and fonts have loaded (B2's stage mounts components after `document.fonts.ready`); everything `update` sets derives from those numbers, `clock.t`, and the beat's `span`. Kept tokens are drawn once (from their base token) and travel; removed and added tokens ride their row's vertical path, folding (`scaleY` 1 → 0) or opening (0 → 1) when the row exists on one side only. A line number both sides share travels with its row; others cross-fade. `follow` returns layout coordinates (for the camera), `target` screen coordinates (for the narrator, which aims at what is drawn).

- [ ] **Step 7: Draw morph elements in a shot**

In `packages/video/src/runtime/direction/elements.ts`:

1. Add `import { morph } from './morph.ts';` after the `../narrator.ts` import.
2. In `mountShot`, replace the `return { element, layer, ...(reveal ? { reveal } : {}), ...draw(element, sub, drawVisual) };` line with:

```ts
    // A morph's beat, on the element's own clock (which starts at its reveal).
    const beat = direction.beats.find((b) => b.verb === 'morph' && b.element === element.id);
    const shift = reveal ? reveal.t : 0;
    const span = beat
      ? ([beat.t - shift, beat.t + beat.seconds - shift] as const)
      : ([0, 0] as const);
    return {
      element,
      layer,
      ...(reveal ? { reveal } : {}),
      ...draw(element, sub, drawVisual, span),
    };
```

3. After `const visual = drawn.find((d) => d.element.kind === 'visual')?.component;` add:

```ts
  /** Scene time on an element's own clock: an element revealed later plays from its reveal. */
  const own = (d: Drawn, t: number) =>
    d.reveal && d.element.kind !== 'visual' ? t - d.reveal.t : t;
```

and in `update`, change the clock passed to a revealed element from `{ ...clock, t: clock.t - d.reveal.t, open: true }` to `{ ...clock, t: own(d, clock.t), open: true }`.

4. Replace `target: (clock) => visual?.target?.(clock),` with:

```ts
    // The narrator points at what the visual highlights, else at what an element does (a morph).
    target: (clock) =>
      visual
        ? visual.target?.(clock)
        : drawn
            .map((d) => d.component.target?.({ ...clock, t: own(d, clock.t) }))
            .find((rect) => rect !== undefined),
```

5. Give `draw` a fourth parameter and a `morph` case:

```ts
function draw(
  element: DirectionElement,
  ctx: ComponentContext,
  drawVisual: (ctx: ComponentContext) => Component,
  span: readonly [number, number],
): Part {
```

and after the `capture` case:

```ts
    case 'morph':
      return { component: morph(element.morph, ctx, span) };
```

A morph always has a beat once Task 3 resolves it (an implicit one when no beat names it); `[0, 0]` only covers a hand-built timeline without one, which then shows the code after the change from the start.

- [ ] **Step 8: Style the morph's pieces**

In `packages/video/src/runtime/styles.ts`, after the `.code .caret { … }` rule:

```ts
.code.tokens .mlive { position: absolute; inset: 0; }
.code.tokens .mlive > span { position: absolute; left: 0; top: 0; white-space: pre; transform-origin: 0 0; }
.code.tokens .mbar { background: ${c.addBackground}; } .code.tokens .mbar.del { background: ${c.delBackground}; }
.code.tokens .mmark.add { color: ${c.addText}; } .code.tokens .mmark.del { color: ${c.delText}; }
.code.tokens .mnum { color: ${c.codeMuted}; }
.code .ln.elided .txt, .code.tokens .elided { color: ${c.codeMuted}; font-style: italic; }
```

The panel class is `tokens`, not `morph`: `.code.morph` already styles the storyboard's line-level morph, which this PR leaves exactly as it is.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/morph-timeline.test.ts tests/render/morph.test.ts tests/direction-security.test.ts`
Expected: PASS (2 + 6 + 6 tests).

Then `npm run typecheck && npx biome check --write packages/video tests && npm run lint`, and in the background `npx vitest run tests/render/canvas.test.ts tests/render/render.test.ts` and `npm test` (wait for both): expected PASS — B2's shots and every existing render draw as before.

- [ ] **Step 10: Commit**

```bash
git add packages/video/src/timeline packages/video/src/density.ts packages/video/src/runtime packages/video/test/morph-timeline.test.ts tests/render/morph.test.ts tests/direction-security.test.ts
git commit -m "$(cat <<'EOF'
Draw a token morph: kept tokens travel, removed lines fold, new lines slide in

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 3: The direction file directs morphs — schema, checks, resolution, and the elided marker's words

**Files:**
- Modify: `packages/video/src/direction/schema.ts` (`ShotElementSchema`, `ShotBeatSchema`)
- Modify: `packages/video/src/direction/refs.ts` (imports, doc comment, the beat loop, `elementProblems`)
- Modify: `packages/video/src/direction/layout.ts` (`WEIGHT`)
- Modify: `packages/video/src/direction/resolve.ts` (imports, `BEAT_SECONDS`, `Context`, `resolveDirection`'s context, `resolveShot`, `element`, `timeBeats`)
- Modify: `templates/i18n/en.yml`, `ko.yml`, `ja.yml`, `zh.yml` (`video.elided`, after `video.moreLines`)
- Create: `packages/video/test/direction-morph.test.ts`
- Modify: `packages/video/test/direction-schema.test.ts` (`rejects kinds and verbs this PR does not draw`)

**Interfaces:**
- Consumes: `morphHunk`, `morphProblem` (Task 1); the timeline's `morph` element and beat (Task 2); `t` (`@covi/core`).
- Produces:
  ```ts
  // packages/video/src/direction/schema.ts
  // ShotElementSchema gains: { id, kind: 'morph', evidence }            (strict)
  // ShotBeatSchema gains:    { verb: 'morph', element, at? }             (strict)
  // packages/video/src/direction/resolve.ts
  export const BEAT_SECONDS: { reveal: 0.5; camera: 0.8; morph: 1.6 };
  // catalogs: video.elided — en { one: '… {count} line', other: '… {count} lines' }
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/direction-morph.test.ts`:

```ts
import { buildEvidence, DEFAULT_CONFIG, type Hunk, indexEvidence, Redactor } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { directionProblems } from '../src/direction/refs.ts';
import { BEAT_SECONDS, resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor } from '../src/timeline/build.ts';
import type { SceneStaging } from '../src/timeline/types.ts';

// A run with three hunks: a replaced line holding a secret (outside any string, so its tokens
// would split it), a new file, and more added lines than a morph shows.
const SECRET = 'hunter2-shh-secret';
const replaced: Hunk = {
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 3,
  lines: [
    { kind: 'context', text: 'function build(docs) {', oldLine: 10, newLine: 10 },
    { kind: 'del', text: `  return send(docs, ${SECRET});`, oldLine: 11 },
    { kind: 'add', text: '  return send(docs.map((d) => d.id));', newLine: 11 },
    { kind: 'context', text: '}', oldLine: 12, newLine: 12 },
  ],
};
const created: Hunk = {
  oldStart: 0,
  oldLines: 0,
  newStart: 1,
  newLines: 2,
  lines: [
    { kind: 'add', text: 'export const a = 1;', newLine: 1 },
    { kind: 'add', text: 'export const b = 2;', newLine: 2 },
  ],
};
const sprawling: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 14,
  lines: [
    { kind: 'context', text: 'start();', oldLine: 1, newLine: 1 },
    ...Array.from({ length: 13 }, (_, i) => ({
      kind: 'add' as const,
      text: `step${i}();`,
      newLine: i + 2,
    })),
  ],
};
const files = [
  { path: 'src/request.js', language: 'javascript', hunks: [replaced] },
  { path: 'src/new.js', language: 'javascript', hunks: [created] },
  { path: 'src/big.js', language: 'javascript', hunks: [sprawling] },
];
const evidence = indexEvidence(buildEvidence({ diff: files }));
const sources = directionSources({ files, evidence });
const scene = (id: string, narration: string): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual: { kind: 'callout', title: id } });
const scenes = [
  scene('s1', 'The request carried every document.'),
  scene('s2', 'Now it sends only the ids, and the reader fetches each one.'),
];
const morph = (extra: Record<string, unknown> = {}) => ({
  id: 'req',
  kind: 'morph',
  evidence: 'diff-hunk:src/request.js:10',
  ...extra,
});
const problems = (shot: Record<string, unknown>) =>
  directionProblems(
    DirectionSchema.parse({ shots: [{ scene: 's2', ...shot }] }),
    scenes,
    evidence,
    sources,
  );

describe('a morph in the direction file', () => {
  it('takes a diff-hunk and a morph beat, and nothing else', () => {
    const parsed = DirectionSchema.safeParse({
      shots: [
        {
          scene: 's2',
          elements: [morph()],
          beats: [
            { verb: 'camera', move: 'follow', to: 'req' },
            { verb: 'morph', element: 'req', at: 'only the ids' },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    for (const extra of [{ side: 'head' }, { lines: [1, 2] }, { text: 'x' }, { style: 'pop' }])
      expect(
        DirectionSchema.safeParse({ shots: [{ scene: 's2', elements: [morph(extra)] }] }).success,
      ).toBe(false);
    expect(
      DirectionSchema.safeParse({
        shots: [
          {
            scene: 's2',
            elements: [morph()],
            beats: [{ verb: 'morph', element: 'req', style: 'pop' }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('is checked against the run: a hunk that can morph, and a beat on a morph', () => {
    expect(
      problems({
        elements: [morph()],
        beats: [{ verb: 'morph', element: 'req', at: 'only the ids' }],
      }),
    ).toEqual([]);
    expect(
      problems({
        elements: [
          { id: 'new', kind: 'morph', evidence: 'diff-hunk:src/new.js:1' },
          { id: 'big', kind: 'morph', evidence: 'diff-hunk:src/big.js:1' },
          { id: 'run', kind: 'morph', evidence: 'terminal:1' },
          { id: 'note', kind: 'label', text: 'Ids only' },
        ],
        beats: [
          { verb: 'morph', element: 'note' },
          { verb: 'morph', element: 'big' },
          { verb: 'morph', element: 'big' },
        ],
      }),
    ).toEqual([
      'shot 1 (scene s2), element new: the hunk has no lines before the change (a new file); show it as code',
      'shot 1 (scene s2), element big: the hunk changes 13 lines on its head side, and a morph shows at most 12; show it as code, with `lines`',
      'shot 1 (scene s2), element run: cites "terminal:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 1 (scene s2), beat 1 (morph): morph turns a morph element, and "note" is a label',
      'shot 1 (scene s2), beat 3 (morph): "big" already morphs at an earlier beat; it morphs once',
    ]);
  });
});

describe('resolving a morph', () => {
  const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  const redactor = new Redactor({ literals: [SECRET] });
  const resolve = (shot: DirectionInput['shots'][number], language: 'en' | 'ko' = 'en') =>
    resolveDirection({
      plan: DirectionSchema.parse({ shots: [shot] }),
      scenes,
      layout,
      spec,
      language,
      sources,
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (value) => redactor.redactDeep(value),
    });
  const element = (staging: SceneStaging[]) => {
    const e = staging[1]!.direction.elements[0]!;
    if (e.kind !== 'morph') throw new Error(`expected a morph, got ${e.kind}`);
    return e;
  };

  it('draws the hunk before and after, with what stays between them', () => {
    const staging = resolve({ scene: 's2', elements: [morph()], beats: [] });
    const { morph: m } = element(staging);
    expect(m).toMatchObject({ path: 'src/request.js', language: 'javascript' });
    expect(m.base.map((r) => r.type)).toEqual(['context', 'del', 'context']);
    expect(m.head.map((r) => r.type)).toEqual(['context', 'add', 'context']);
    expect(m.rows).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    // `return send(docs` and the closing `);` stay and travel; the rest of the line is replaced.
    const stays = m.tokens.filter(([b]) => b === 1).map(([, i]) => m.base[1]!.tokens[i]!.text);
    expect(stays.join('')).toBe('returnsend(docs);');
  });

  it('redacts each line whole before splitting it, so a secret never survives in pieces', () => {
    const staging = resolve({ scene: 's2', elements: [morph()], beats: [] });
    const text = JSON.stringify(staging);
    for (const piece of ['hunter2', 'shh-secret', SECRET]) expect(text).not.toContain(piece);
    expect(
      element(staging)
        .morph.base[1]!.tokens.map((t) => t.text)
        .join(''),
    ).toBe('  return send(docs, [REDACTED]);');
  });

  it('morphs on its phrase, or where an implicit beat spreads it when no beat names it', () => {
    const pinned = resolve({
      scene: 's2',
      elements: [morph()],
      beats: [
        { verb: 'camera', move: 'follow', to: 'req' },
        { verb: 'morph', element: 'req', at: 'only the ids' },
      ],
    })[1]!.direction.beats;
    expect(pinned.map((b) => b.verb).sort()).toEqual(['camera', 'morph']);
    const beat = pinned.find((b) => b.verb === 'morph')!;
    expect(beat).toMatchObject({ element: 'req', seconds: BEAT_SECONDS.morph });
    const implicit = resolve({ scene: 's2', elements: [morph()], beats: [] })[1]!.direction.beats;
    expect(implicit).toEqual([
      expect.objectContaining({ verb: 'morph', element: 'req', seconds: BEAT_SECONDS.morph }),
    ]);
  });

  it('keeps 14 rows a side on a wide frame and 18 on a tall one', () => {
    const tall: Hunk = {
      oldStart: 1,
      oldLines: 20,
      newStart: 1,
      newLines: 20,
      lines: [
        ...Array.from({ length: 10 }, (_, i) => ({
          kind: 'context' as const,
          text: `before${i}();`,
          oldLine: i + 1,
          newLine: i + 1,
        })),
        { kind: 'del' as const, text: 'old();', oldLine: 11 },
        { kind: 'add' as const, text: 'fresh();', newLine: 11 },
        ...Array.from({ length: 10 }, (_, i) => ({
          kind: 'context' as const,
          text: `after${i}();`,
          oldLine: i + 12,
          newLine: i + 12,
        })),
      ],
    };
    const tallFiles = [{ path: 'a.js', hunks: [tall] }];
    const tallEvidence = indexEvidence(buildEvidence({ diff: tallFiles }));
    const rows = (width: number, height: number) => {
      const frame = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'custom', width, height });
      const [, staged] = resolveDirection({
        plan: DirectionSchema.parse({
          shots: [
            { scene: 's2', elements: [{ id: 'm', kind: 'morph', evidence: 'diff-hunk:a.js:1' }] },
          ],
        }),
        scenes,
        layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(frame)),
        spec: frame,
        language: 'en',
        sources: directionSources({ files: tallFiles, evidence: tallEvidence }),
        image: () => ({ src: '', width: 1, height: 1 }),
        seed: 5,
        redact: (value) => value,
      });
      const e = staged!.direction.elements[0]!;
      if (e.kind !== 'morph') throw new Error(`expected a morph, got ${e.kind}`);
      return e.morph.head.length;
    };
    expect(rows(1920, 1080)).toBe(14);
    expect(rows(1080, 1920)).toBe(18);
  });

  it('says what an elided run hides in the video’s language', () => {
    const long: Hunk = {
      oldStart: 1,
      oldLines: 6,
      newStart: 1,
      newLines: 18,
      lines: [
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'add' as const,
          text: `a${i}();`,
          newLine: i + 1,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'context' as const,
          text: `m${i}`,
          oldLine: i + 1,
          newLine: i + 7,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'add' as const,
          text: `b${i}();`,
          newLine: i + 13,
        })),
      ],
    };
    const longFiles = [{ path: 'a.js', hunks: [long] }];
    const longEvidence = indexEvidence(buildEvidence({ diff: longFiles }));
    const at = (language: 'en' | 'ko') =>
      resolveDirection({
        plan: DirectionSchema.parse({
          shots: [
            { scene: 's2', elements: [{ id: 'm', kind: 'morph', evidence: 'diff-hunk:a.js:1' }] },
          ],
        }),
        scenes,
        layout,
        spec,
        language,
        sources: directionSources({ files: longFiles, evidence: longEvidence }),
        image: () => ({ src: '', width: 1, height: 1 }),
        seed: 5,
        redact: (value) => value,
      });
    const markers = (language: 'en' | 'ko') =>
      element(at(language)).morph.head.flatMap((r) =>
        r.type === 'elided' ? [r.tokens[0]!.text] : [],
      );
    expect(markers('en')).toEqual(['… 5 lines']);
    expect(markers('ko')).toEqual(['… 5줄']);
  });
});
```

In `packages/video/test/direction-schema.test.ts`, in `it('rejects kinds and verbs this PR does not draw', …)`, remove `'morph'` from both lists, so they read `['metric', 'packet', 'pile', 'html', 'iframe']` and `['count', 'flow', 'eval']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/direction-morph.test.ts packages/video/test/direction-schema.test.ts`
Expected: FAIL — the schema rejects `kind: 'morph'` and `verb: 'morph'` (`DirectionSchema.parse` throws in every `resolving a morph` test), so `parsed.success` is false.

- [ ] **Step 3: Add the element and the verb to the schema**

In `packages/video/src/direction/schema.ts`, in `ShotElementSchema`, after the `capture` object:

```ts
  z
    .strictObject({
      id: ElementIdSchema,
      kind: z.literal('morph'),
      evidence: EvidenceRefSchema.describe('A diff-hunk: id from `covi evidence --run <id>`.'),
    })
    .describe(
      "The hunk's code before the change, turning token by token into the code after it on its `morph` beat.",
    ),
```

and in `ShotBeatSchema`, after the `camera` object:

```ts
  z
    .strictObject({
      verb: z.literal('morph'),
      element: ElementIdSchema,
      at: PhraseSchema.optional(),
    })
    .describe(
      'A morph element turns from the code before the change into the code after it: removed lines fold away, new ones slide in, and the tokens that stay travel to their new places.',
    ),
```

In `packages/video/src/direction/layout.ts`, add `morph: 3,` to `WEIGHT` after `capture: 3,` (a morph takes the room a code element does).

- [ ] **Step 4: Check morphs against the run**

In `packages/video/src/direction/refs.ts`:

1. Add `import { morphProblem } from './tokens.ts';` after the `./sources.ts` import.
2. In `directionProblems`' doc comment, replace "lines lie within the side\n * shown, and every `at` is quoted" so the sentence reads "… a requested side exists, lines lie within the side shown, a morph's hunk can morph and its beat names a morph (once), and every `at` is quoted from the scene's narration exactly once (as `sync` phrases are)."
3. Right before `shot.beats.forEach((beat, k) => {` add `const morphed = new Set<string>();`, and inside that callback, after the "the shot has no element" check:

```ts
      if (beat.verb === 'morph') {
        const kind = shot.elements.find((e) => e.id === target)?.kind;
        if (kind && kind !== 'morph')
          problems.push(`${name}: morph turns a morph element, and "${target}" is a ${kind}`);
        else if (morphed.has(target))
          problems.push(`${name}: "${target}" already morphs at an earlier beat; it morphs once`);
        morphed.add(target);
      }
```

4. In `elementProblems`, before `case 'capture':`:

```ts
    case 'morph': {
      if (!cites(element.evidence, 'diff-hunk', 'a morph element')) break;
      const hunk = sources.hunk(element.evidence);
      const problem = hunk
        ? morphProblem(hunk.lines)
        : `Covi cannot find hunk "${element.evidence}" in the run's diff`;
      if (problem) out.push(problem);
      break;
    }
```

- [ ] **Step 5: Resolve morphs**

In `packages/video/src/direction/resolve.ts`:

1. Replace `import type { DiffLine, Language } from '@covi/core';` with `import { type DiffLine, type Language, t } from '@covi/core';`, and add `import { morphHunk } from './tokens.ts';` after the `./stops.ts` import. (`timeBeats` has a local `const t`; it shadows the import only inside that function, which never translates.)
2. `export const BEAT_SECONDS = { reveal: 0.5, camera: 0.8, morph: 1.6 } as const;`
3. Add `redact: <T>(value: T) => T;` as the last member of `interface Context`, and `redact: input.redact,` as the last property of the `ctx` object in `resolveDirection`.
4. Before `/** A scene without a shot shows its storyboard visual, as without direction. */` add:

```ts
/** A morph element no `morph` beat names morphs anyway, as if the shot ended with one. */
function withMorphs(shot: Shot): Shot {
  const named = new Set(shot.beats.flatMap((b) => (b.verb === 'morph' ? [b.element] : [])));
  const implicit = shot.elements.flatMap((e) =>
    e.kind === 'morph' && !named.has(e.id) ? [{ verb: 'morph' as const, element: e.id }] : [],
  );
  return implicit.length ? { ...shot, beats: [...shot.beats, ...implicit] } : shot;
}
```

and make `resolveShot` start with it: its first parameter becomes `given: Shot` and its first line `const shot = withMorphs(given);` (the rest of the function is unchanged).

5. In `element`, before `case 'output': {`:

```ts
    case 'morph': {
      const hunk = ctx.sources.hunk(e.evidence);
      if (!hunk) return undefined;
      // Each line is redacted whole before it is split, so no secret survives split into tokens.
      const morph = morphHunk(
        hunk.lines.map((l) => ({ ...l, text: ctx.redact(l.text) })),
        {
          max: tall ? CODE_LINES.vertical : CODE_LINES.landscape,
          ...(hunk.language ? { language: hunk.language } : {}),
          elided: (count) => t(ctx.language, 'video.elided', { count }),
        },
      );
      if (!morph) return undefined;
      return {
        id: e.id,
        kind: 'morph',
        rect,
        morph: {
          path: hunk.path,
          ...(hunk.language ? { language: hunk.language } : {}),
          ...morph,
        },
      };
    }
```

6. In `timeBeats`, replace the final `return beat.verb === 'reveal' ? […] : […];` with:

```ts
    if (beat.verb === 'reveal')
      return [{ verb: 'reveal', element: beat.element, style: beat.style ?? 'rise', t, seconds }];
    if (beat.verb === 'morph') return [{ verb: 'morph', element: beat.element, t, seconds }];
    return [
      {
        verb: 'camera',
        move: beat.move,
        to: beat.to,
        ...(beat.zoom === undefined ? {} : { zoom: beat.zoom }),
        t,
        seconds,
      },
    ];
```

A morph's beat starts on its phrase, or in its spaced slot, like any beat (`timeBeats` clamps a beat to what is left of the scene, so a morph in a short scene ends with the scene).

- [ ] **Step 6: Say what an elided run hides, in four languages**

After the `moreLines` line of the `video:` section of each catalog:

- `templates/i18n/en.yml`: `  elided: { one: '… {count} line', other: '… {count} lines' }`
- `templates/i18n/ko.yml`: `  elided: { other: '… {count}줄' }`
- `templates/i18n/ja.yml`: `  elided: { other: '… {count} 行' }`
- `templates/i18n/zh.yml`: `  elided: { other: '… {count} 行' }`

The marker draws `…` (U+2026), which the composition's latin font slices carry (see the rulings). A Korean, Japanese, or Chinese marker's characters reach B2's CJK font detection through the staging, which `buildTimeline` serializes.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/direction-morph.test.ts packages/video/test/direction-schema.test.ts packages/core/test/catalog.test.ts packages/video/test/direction-refs.test.ts packages/video/test/direction-resolve.test.ts`
Expected: PASS (the catalog test checks the placeholders match across languages).

Then `npm run typecheck && npx biome check --write packages/video templates && npm run lint`, and in the background `npm test` (wait for it): expected PASS. `covi schema direction` now lists the morph element and verb (the CLI test reads only the top-level keys, which are unchanged).

- [ ] **Step 8: Commit**

```bash
git add packages/video/src/direction templates/i18n packages/video/test/direction-morph.test.ts packages/video/test/direction-schema.test.ts
git commit -m "$(cat <<'EOF'
Direct morphs: the morph element and verb, their checks, and their resolution

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 4: The camera follows the changed lines

**Files:**
- Modify: `packages/video/src/runtime/canvas.ts` (`CameraStep`, `viewAt`)
- Modify: `packages/video/src/runtime/direction/elements.ts` (`ShotComponent`, `mountShot`'s returned object)
- Modify: `packages/video/src/runtime/stage.ts` (`cameraSteps`)
- Modify: `packages/video/test/canvas.test.ts` (one test in `describe('the canvas camera', …)`)
- Modify: `tests/render/morph.test.ts` (one test appended to `describe('the token morph', …)`)

**Interfaces:**
- Consumes: `Component.follow` and the morph's `follow` (Task 2); B2's `beatView`, `viewAt`, `cameraSteps`.
- Produces:
  ```ts
  // packages/video/src/runtime/canvas.ts
  export interface CameraStep { t: number; seconds: number; to: View | ((t: number) => View) }
  // packages/video/src/runtime/direction/elements.ts — ShotComponent gains
  track(id: string, t: number): Rect | undefined;   // the element's follow box `t` s into the scene
  ```

B2 ruled that `follow` framed its target like `zoom` (measured once, when the beat ends) and that B3 must add per-frame following for moving targets; this task does.

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/canvas.test.ts`, inside `describe('the canvas camera', …)`, before `it('pans and zooms between stops, continuous at both ends', …)`:

```ts
  it('keeps up with a moving target once a follow beat has eased in, until the next beat', () => {
    const rest = restView(pivot);
    // A target drifting down 100 px a second, framed at 2×.
    const moving = (t: number) => ({ x: 900, y: 500 + 100 * t, scale: 2 });
    const later = { x: 700, y: 520, scale: 1.25 };
    const steps: CameraStep[] = [
      { t: 1, seconds: 1, to: moving },
      { t: 4, seconds: 1, to: later },
    ];
    expect(viewAt(steps, 0.5, rest)).toEqual(rest);
    // Halfway through its ease, the camera is halfway to where the target is by then.
    const easing = viewAt(steps, 1.5, rest);
    expect(easing.y).toBeCloseTo(rest.y + easeInOutCubic(0.5) * (moving(1.5).y - rest.y), 9);
    // Eased in, it sits on the target at every moment.
    for (const t of [2, 2.7, 3.9]) expect(viewAt(steps, t, rest)).toEqual(moving(t));
    // The next beat starts from where the target had got to.
    const next = viewAt(steps, 4.5, rest);
    expect(next.y).toBeCloseTo(moving(4).y + easeInOutCubic(0.5) * (later.y - moving(4).y), 9);
  });
```

In `tests/render/morph.test.ts`, append inside `describe.skipIf(!available)('the token morph', …)`, after the last test:

```ts
  it('follows the changed lines with the camera as they move, keeping them in the region', async () => {
    const follow: DirectionBeat = {
      verb: 'camera',
      move: 'follow',
      to: 'm',
      zoom: 1.25,
      t: 1,
      seconds: 0.8,
    };
    const v = await morphed(refs, [follow, MORPH]);
    expect((await v.camera(v.at(0.9))).scale).toBeLessThan(1.05);
    const cameras: Array<{ tx: number; ty: number; scale: number }> = [];
    for (const share of [0.3, 0.6, 0.9]) {
      const frame = v.at(MORPH.t + MORPH.seconds * share);
      cameras.push(await v.camera(frame));
      const bars = (await v.seek(
        frame,
        `return [...document.querySelectorAll('[data-element="m"] .mbar')]
           .filter((b) => Number(b.style.opacity) > 0.5)
           .map((b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });`,
      )) as Array<{ top: number; bottom: number }>;
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) {
        expect(bar.top).toBeGreaterThanOrEqual(media.y - 1);
        expect(bar.bottom).toBeLessThanOrEqual(media.y + media.height + 1);
      }
    }
    // Zoomed in, and moving with the lines: no two of these frames share a camera.
    for (const c of cameras) expect(c.scale).toBeCloseTo(1.25, 2);
    expect(new Set(cameras.map((c) => c.ty.toFixed(1))).size).toBe(3);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/canvas.test.ts tests/render/morph.test.ts -t "moving target|follows the changed"`
Expected: FAIL — `npm run typecheck` rejects a function `to` (and at runtime `lerpView` reads `NaN` from it); the render test sees one camera for all three frames (B2 aims a follow beat once, at its end), so the set of offsets has size 1.

- [ ] **Step 3: Let a camera step follow a moving target**

In `packages/video/src/runtime/canvas.ts`, replace `CameraStep` and its comment with:

```ts
/**
 * A camera beat inside a stop: from `t` (seconds since the scene started) for `seconds`, toward
 * `to`, or, following a moving target, toward where it is at each moment.
 */
export interface CameraStep {
  t: number;
  seconds: number;
  to: View | ((t: number) => View);
}
```

In `viewAt`'s doc comment, append the sentence "A beat that follows a moving target keeps up with it once it has eased in, until the next beat starts." In its loop, replace the `view = lerpView(view, step.to, …)` statement with:

```ts
    const to = typeof step.to === 'function' ? step.to(until) : step.to;
    view = lerpView(
      view,
      to,
      easeInOutCubic(clamp((until - step.t) / Math.max(step.seconds, 1e-6))),
    );
```

A static `to` behaves exactly as before (B2's camera tests pin it).

- [ ] **Step 4: Expose an element's follow box from the shot**

In `packages/video/src/runtime/direction/elements.ts`, in `interface ShotComponent`, after `frame(id: string): Rect | undefined;`:

```ts
  /** Where an element that moves is laid out `t` seconds into the scene: what `follow` frames. */
  track(id: string, t: number): Rect | undefined;
```

and in the object `mountShot` returns, after the `frame(id) { … }` method:

```ts
    track(id, t) {
      const d = drawn.find((x) => x.element.id === id);
      return d?.component.follow?.(own(d, t));
    },
```

- [ ] **Step 5: Follow per frame in the stage**

In `packages/video/src/runtime/stage.ts`, in `cameraSteps`, right after `if (!element) continue;`:

```ts
      // Following an element that moves (a morph's changed lines) frames it at every frame.
      const track = beat.move === 'follow' ? m.shot?.track(element.id, beat.t) : undefined;
      if (track) {
        const start = from;
        const to = (t: number) =>
          beatView(
            'follow',
            m.shot!.track(element.id, t) ?? track,
            beat.zoom,
            start,
            m.region,
            this.pivot,
          );
        steps.push({ t: beat.t, seconds: beat.seconds, to });
        from = to(beat.t + beat.seconds);
        continue;
      }
```

`beatView` clamps every view to the scene's region (so the camera never shows the canvas beside the stop), and a target taller or wider than the view shows its start, so a zoomed follow keeps the start of the changed lines in view. Elements without `follow` (code, output, captures, labels) and the storyboard visual keep B2's behavior: aimed once, at the beat's end.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/canvas.test.ts tests/render/morph.test.ts`
Expected: PASS (B2's 8 camera tests and this one; the 7 morph render tests).

Then `npm run typecheck && npx biome check --write packages/video tests && npm run lint`, and in the background `npx vitest run tests/render/canvas.test.ts` (B2's camera beats, unchanged) and `npm test`; wait for both: expected PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/video/src/runtime packages/video/test/canvas.test.ts tests/render/morph.test.ts
git commit -m "$(cat <<'EOF'
Follow a morph's changed lines with the camera at every frame

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 5: Covi's default director morphs small code hunks

**Files:**
- Modify: `packages/video/src/direction/director.ts` (imports, `DirectorInput`, `defaultDirection`, `cameraBeats`; new `highlightPhrase`, `morphShot`)
- Modify: `packages/video/src/direction/plan.ts` (`planDirection` passes `sources`)
- Modify: `packages/video/test/director.test.ts` (imports; a new `describe` at the end)
- Modify: `tests/examples.test.ts` (B2's `directs its drafted storyboards with shots Covi’s own checks accept`)

**Interfaces:**
- Consumes: `morphProblem` (Task 1); the schema's morph element and verb (Task 3); B2's `sceneEvidence`, `DirectionSources`.
- Produces:
  ```ts
  // packages/video/src/direction/director.ts
  export interface DirectorInput { scenes: readonly Scene[]; evidence?: EvidenceIndex; seed: number; sources?: DirectionSources }
  // A morphable code scene's shot:
  // { scene, elements: [{ id: 'morph', kind: 'morph', evidence: <its diff-hunk id> }],
  //   beats: [{ verb: 'camera', move: 'follow', to: 'morph', zoom: CODE_ZOOM },
  //           { verb: 'morph', element: 'morph', at?: <its highlight phrase> }] }
  ```

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/director.test.ts`, change the `@covi/core` import to `import { buildEvidence, type EvidenceItem, type Hunk, indexEvidence } from '@covi/core';` and append:

```ts
describe('the default director’s morphs', () => {
  // One small replacement, and one hunk with more added lines than a morph shows.
  const small: Hunk = {
    oldStart: 10,
    oldLines: 3,
    newStart: 10,
    newLines: 3,
    lines: [
      { kind: 'context', text: 'function take(qty) {', oldLine: 10, newLine: 10 },
      { kind: 'del', text: '  qty = qty - 1;', oldLine: 11 },
      { kind: 'add', text: '  qty = Math.max(0, qty - 1);', newLine: 11 },
      { kind: 'context', text: '}', oldLine: 12, newLine: 12 },
    ],
  };
  const large: Hunk = {
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 14,
    lines: [
      { kind: 'context', text: 'start();', oldLine: 1, newLine: 1 },
      ...Array.from({ length: 13 }, (_, i) => ({
        kind: 'add' as const,
        text: `step${i}();`,
        newLine: i + 2,
      })),
    ],
  };
  const files = [
    { path: 'src/cart.ts', language: 'typescript', hunks: [small] },
    { path: 'src/steps.ts', language: 'typescript', hunks: [large] },
  ];
  const run = indexEvidence(buildEvidence({ diff: files }));
  const sources = directionSources({ files, evidence: run });
  const shows = (path: string, extra: Record<string, unknown> = {}) => ({
    kind: 'code',
    path,
    lines: [
      { type: 'del', text: 'qty = qty - 1;', number: 11 },
      { type: 'add', text: 'qty = Math.max(0, qty - 1);', number: 11 },
    ],
    highlight: [1],
    ...extra,
  });
  const direct = (scenes: Scene[]) =>
    defaultDirection({ scenes, evidence: run, seed: 0, sources }).shots;

  it('morphs a code scene’s small hunk, the camera following its changed lines', () => {
    const fix = scene('s2', shows('src/cart.ts'), {
      narration: 'The fix clamps the quantity at zero.',
      sync: { highlight1: 'clamps the quantity' },
    });
    const [, shot] = direct([scene('s1', callout), fix]);
    expect(shot).toEqual({
      scene: 's2',
      enter: expect.any(String),
      elements: [{ id: 'morph', kind: 'morph', evidence: 'diff-hunk:src/cart.ts:10' }],
      beats: [
        { verb: 'camera', move: 'follow', to: 'morph', zoom: CODE_ZOOM },
        { verb: 'morph', element: 'morph', at: 'clamps the quantity' },
      ],
    });
    // Without a phrase, the morph spreads through the line.
    const [plain] = direct([scene('s1', shows('src/cart.ts'))]);
    expect(plain!.beats.at(-1)).toEqual({ verb: 'morph', element: 'morph' });
  });

  it('keeps the visual of a line morph, a captioned card, a hunk too large, or a run without sources', () => {
    const kept = (visual: unknown) => direct([scene('s1', visual)])[0]!.elements;
    const visual = [{ id: 'visual', kind: 'visual' }];
    expect(kept(shows('src/cart.ts', { mode: 'morph' }))).toEqual(visual);
    expect(kept(shows('src/cart.ts', { caption: 'Clamped at zero' }))).toEqual(visual);
    expect(
      kept({
        kind: 'code',
        path: 'src/steps.ts',
        lines: [{ type: 'add', text: 'step0();', number: 2 }],
        highlight: [],
      }),
    ).toEqual(visual);
    const scenes = [scene('s1', shows('src/cart.ts'))];
    expect(defaultDirection({ scenes, evidence: run, seed: 0 }).shots[0]!.elements).toEqual(visual);
  });

  it('passes Covi’s own checks, and reads what scenes show, never what they cite', () => {
    const scenes = [scene('s1', callout), scene('s2', shows('src/cart.ts'))];
    const plan = defaultDirection({ scenes, evidence: run, seed: 4, sources });
    expect(directionProblems(plan, scenes, run, sources)).toEqual([]);
    const cited = scenes.map((s) => ({ ...s, evidenceIds: ['diff-hunk:src/steps.ts:1'] }));
    expect(defaultDirection({ scenes: cited, evidence: run, seed: 4, sources })).toEqual(plan);
  });
});
```

In `tests/examples.test.ts`, inside `it('directs its drafted storyboards with shots Covi’s own checks accept', …)`, pass the run's sources to the director (both calls), and require the benchmark to morph. Replace:

```ts
          const plan = defaultDirection({ scenes: storyboard.scenes, evidence, seed });
          expect(plan.shots.map((s) => s.scene)).toEqual(storyboard.scenes.map((s) => s.id));
          expect(directionProblems(plan, storyboard.scenes, evidence, sources)).toEqual([]);
          expect(defaultDirection({ scenes: storyboard.scenes, evidence, seed })).toEqual(plan);
```

with:

```ts
          const plan = defaultDirection({ scenes: storyboard.scenes, evidence, seed, sources });
          expect(plan.shots.map((s) => s.scene)).toEqual(storyboard.scenes.map((s) => s.id));
          expect(directionProblems(plan, storyboard.scenes, evidence, sources)).toEqual([]);
          expect(defaultDirection({ scenes: storyboard.scenes, evidence, seed, sources })).toEqual(
            plan,
          );
          // A change with nothing to see shows its code changing: the benchmark morphs.
          const morphs = plan.shots.filter((s) => s.elements.some((e) => e.kind === 'morph'));
          if (example.name === 'backend-slim-request')
            expect(morphs.length, mode).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/director.test.ts tests/examples.test.ts -t "morph|directs its drafted"`
Expected: FAIL — every shot keeps `{ id: 'visual', kind: 'visual' }` (the director ignores `sources`), and `backend-slim-request` has no morph.

- [ ] **Step 3: Morph small code hunks in the director**

In `packages/video/src/direction/director.ts`:

1. After the `./schema.ts` import add:

```ts
import type { DirectionSources } from './sources.ts';
import { morphProblem } from './tokens.ts';
```

2. In `DirectorInput`, after `seed: number;`:

```ts
  /** The run's evidence content: a code scene whose hunk can morph becomes a morph. */
  sources?: DirectionSources;
```

3. Replace `defaultDirection`'s doc comment and its `const shots: Shot[] = …;` statement with:

```ts
/**
 * Covi's own direction, for every run without an agent's (CI and `--json` runs get the same
 * motion as interactive ones): a code scene whose hunk is small enough morphs it, the camera
 * following the changed lines; every other scene keeps its storyboard visual, and a code scene
 * that highlights lines zooms toward them as they light. Each scene after the first gets its
 * entrance from the rotation unless the storyboard set its `transition`. Pure and deterministic.
 * It never invents content: what it adds (morphs, and later metrics and flows) comes from evidence.
 */
export function defaultDirection(input: DirectorInput): Direction {
  const shots: Shot[] = input.scenes.map(
    (scene, i) =>
      morphShot(scene, i, input) ?? {
        scene: sceneId(scene, i),
        elements: [{ id: 'visual', kind: 'visual' }],
        beats: cameraBeats(scene),
      },
  );
```

(the rest of `defaultDirection` is unchanged).

4. Replace `cameraBeats` (its doc comment stays) with these three functions:

```ts
/** The phrase that lights a code scene's first highlight group (or all of them), if it has one. */
function highlightPhrase(scene: Scene): string | undefined {
  const v = scene.visual;
  if (v.kind !== 'code' || !v.highlight.length) return undefined;
  const sync = scene.sync ?? {};
  const phase = [highlightGroups(v.highlight)[0]?.phase, 'highlight'].find(
    (name): name is string => name !== undefined && Object.hasOwn(sync, name),
  );
  return phase ? sync[phase] : undefined;
}

/**
 * A code scene that highlights lines zooms toward them, on the phrase that lights its first group
 * (or all of them), else spread through its line. Captures move their own camera inside their
 * frame (marks, focus), so a stage zoom would compound it; they get none.
 */
function cameraBeats(scene: Scene): ShotBeat[] {
  const v = scene.visual;
  if (v.kind !== 'code' || !v.highlight.length) return [];
  const at = highlightPhrase(scene);
  return [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: CODE_ZOOM, ...(at ? { at } : {}) }];
}

/**
 * A code scene that shows one hunk small enough to morph (code on both sides, every changed
 * line on the card) morphs it instead of showing it: the camera follows the changed lines, and
 * the morph lands on the phrase that lights its highlights, else spread through its line. A scene
 * the storyboard set apart keeps its visual: the line morph (`mode: "morph"`), or a caption the
 * morph would not draw. It reads what the scene shows, never what it cites.
 */
function morphShot(scene: Scene, i: number, input: DirectorInput): Shot | undefined {
  const v = scene.visual;
  const { evidence, sources } = input;
  if (v.kind !== 'code' || v.mode === 'morph' || v.caption || !evidence || !sources)
    return undefined;
  const hunks = sceneEvidence({ visual: v }, evidence).filter(
    (id) => evidence.find(id)?.kind === 'diff-hunk',
  );
  const hunk = hunks.length === 1 ? sources.hunk(hunks[0]!) : undefined;
  if (!hunk || morphProblem(hunk.lines)) return undefined;
  const at = highlightPhrase(scene);
  return {
    scene: sceneId(scene, i),
    elements: [{ id: 'morph', kind: 'morph', evidence: hunks[0]! }],
    beats: [
      { verb: 'camera', move: 'follow', to: 'morph', zoom: CODE_ZOOM },
      { verb: 'morph', element: 'morph', ...(at ? { at } : {}) },
    ],
  };
}
```

In `packages/video/src/direction/plan.ts`, add `sources: input.sources,` to the `defaultDirection({ … })` call, after `seed: input.seed,`. The pipeline already builds `sources` before planning (B2), so `covi video`, `covi render`, `covi ci`, and `covi video --draft` all get the morphs; a drafted `video/direction.json` shows them for the agent to keep or rewrite.

The camera beat has no phrase, so it takes the first spaced slot and frames the old lines before they change; the morph takes the scene's highlight phrase or the next slot. A drafted storyboard's code scenes carry no caption and no `mode`, so they morph whenever their hunk is small.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/director.test.ts tests/examples.test.ts packages/video/test/direction-plan.test.ts`
Expected: PASS. In the examples test, `backend-slim-request` morphs its drafted code scene (the `src/reader.js` hunk at line 19 when this plan was written), and every other example's drafted direction still passes Covi's own checks.

Then `npm run typecheck && npx biome check --write packages/video tests && npm run lint`, and in the background `npm test` (wait for it): expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/direction/director.ts packages/video/src/direction/plan.ts packages/video/test/director.test.ts tests/examples.test.ts
git commit -m "$(cat <<'EOF'
Morph small code hunks in Covi's default direction

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 6: The contact sheet shows every morph, and the benchmark morphs on screen

**Files:**
- Modify: `packages/video/src/render/renderer.ts` (`HERO_TILE` and `contactSheetFrames`)
- Modify: `packages/video/test/frames.test.ts` (one test in `describe('the contact sheet', …)`)
- Modify: `tests/render/render.test.ts` (B1's `covi video (full pipeline)` loop)

**Interfaces:**
- Consumes: the timeline's morph beats (Tasks 2–3); the default director's morphs (Task 5).
- Produces: `contactSheetFrames(timeline)` also returns, for every `morph` beat, the frame at `scene.start + beat.t + beat.seconds / 2`.

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/frames.test.ts`, inside `describe('the contact sheet', …)`, before `it('samples transitions of timelines written before they had kinds', …)`:

```ts
  it('samples the middle of every morph, where its tokens are on their way', () => {
    const frames = contactSheetFrames({
      fps: 30,
      frames: 300,
      transition: 0.45,
      scenes: [
        s('s1', 0, 4),
        s('s2', 4, 10, {
          transition: { kind: 'cut', seconds: 0 },
          direction: {
            whole: false,
            elements: [],
            beats: [
              { verb: 'camera', move: 'follow', to: 'm', t: 1, seconds: 0.8 },
              { verb: 'morph', element: 'm', t: 2, seconds: 1.6 },
            ],
          },
        }),
      ],
    });
    // 0.3 s; middles 2 and 7; the morph 4 + 2 + 0.8 s in. A camera beat gets no tile.
    expect(frames).toEqual([9, 60, 204, 210]);
  });
```

In `tests/render/render.test.ts`, in B1's `covi video (full pipeline)` loop, after B2's canvas assertions (they end with the `for (const kind of new Set(moves)) … toBeLessThanOrEqual(0.6);` line and define `timeline` and `story`), add:

```ts
      // The benchmark has nothing to see: its code changes on screen, and the sheet shows it.
      if (example === 'backend-slim-request') {
        const morphs = story.flatMap((s) =>
          (s.direction?.beats ?? []).flatMap((b) => (b.verb === 'morph' ? [{ s, b }] : [])),
        );
        expect(morphs.length).toBeGreaterThan(0);
        const tiles = contactSheetFrames(timeline);
        for (const { s, b } of morphs)
          expect(tiles).toContain(Math.round((s.start + b.t + b.seconds / 2) * timeline.fps));
      }
```

(`contactSheetFrames` is already imported in that file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/frames.test.ts`
Expected: FAIL — the frames are `[9, 60, 210]`: no tile at frame 204.

- [ ] **Step 3: Add the morph tile**

In `packages/video/src/render/renderer.ts`, after `const HERO_TILE = 0.1;`:

```ts
/** A morph's tile, halfway through it: kept tokens on their way, old lines folding, new arriving. */
const MORPH_TILE = 0.5;
```

Replace `contactSheetFrames`' doc comment with:

```ts
/**
 * Frames for the contact sheet, in time order: the opening, every scene's middle, the middle of
 * every transition (a cut has none; timelines without kinds faded over `transition`), the hero's
 * accent, and the middle of every morph, so the sheet shows the code changing.
 */
```

and inside its `timeline.scenes.forEach` callback, after the hero line:

```ts
    for (const beat of s.direction?.beats ?? [])
      if (beat.verb === 'morph') frames.add(frame(s.start + beat.t + beat.seconds * MORPH_TILE));
```

The poster stays where it is (1.6 s in): see the rulings.

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run packages/video/test/frames.test.ts`
Expected: PASS. Then `npm run typecheck && npx biome check --write packages/video tests && npm run lint`.

- [ ] **Step 5: Render the benchmark with the default director and look at it**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --json > "$RENDER/video.json"
```

Run the `covi video` line in the background (capture, narration, a 1080p render: several minutes) and wait for it. Then:

```bash
node -e '
const fs = require("fs"), path = require("path");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const t = JSON.parse(fs.readFileSync(path.join(r.runDir, "video", "timeline.json"), "utf8"));
const qc = JSON.parse(fs.readFileSync(path.join(r.runDir, "video", "qc.json"), "utf8"));
console.log(r.runDir, r.video.rendered, qc.status);
for (const s of t.scenes)
  for (const e of s.direction?.elements ?? [])
    if (e.kind === "morph")
      console.log(s.id, e.morph.path, "rows", e.morph.base.length, "→", e.morph.head.length,
        JSON.stringify(s.direction.beats.map((b) => [b.verb, b.t, b.seconds])));
for (const c of qc.checks.filter((c) => c.status !== "pass")) console.log(c.id, c.status, c.message);
' "$RENDER/video.json"
```

Expected: `rendered` true, `qc.status` not `fail`, and at least one story scene with a `morph` element (when this plan was written: the hero code scene, `src/reader.js`, 7 → 13 rows, beats `camera` then `morph` 1.6 s), `text-size` passing or warning only for scenes other than the morph.

Open `<runDir>/video/contact-sheet.jpg` and `<runDir>/video/poster.png` with the Read tool and judge as a viewer. The sheet must have a tile in the morph's middle (after the scene's middle tile) where the code is visibly changing: old tokens fading in red, kept tokens between their places, new lines opening in green; the code must read at the size of a code card (B1's floor) with the start of the changed lines in view. Record what the sheet shows, and the QC warnings, in the report. The poster is the opening frame and is not expected to show the morph (rulings).

If the render shows a defect of this branch (tokens drawn twice or misplaced, a morph that never settles, a camera that leaves the changed lines, text over the captions), write a failing test in `tests/render/morph.test.ts` that reproduces it with `morphed(…)`, fix it, and commit that fix separately before Step 6.

- [ ] **Step 6: Run the full-pipeline renders**

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "full pipeline"`
Expected: PASS — every example renders with QC not `fail`, and `backend-slim-request`'s timeline has a morph whose midpoint is a contact-sheet tile.

- [ ] **Step 7: Commit**

```bash
rm -rf "$RENDER"
git add packages/video/src/render/renderer.ts packages/video/test/frames.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Show every morph's midpoint on the contact sheet, and check the benchmark morphs

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 7: Documentation, changelog, and the full checks

**Files:**
- Modify: `docs/video.md` (B2's `### Direction and the canvas` section; the contact sheet bullet of `### Composition and rendering`)
- Modify: `docs/visual-system.md` (the "How they move" list)
- Modify: `docs/security.md` (B2's `### The direction file` subsection)
- Modify: `docs/contributing.md:293` (the contact sheet's tiles)
- Modify: `skills/covi-video/SKILL.md` (`## Run it`: B2's **Direction.** paragraph; the **Review it yourself** sentence)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

**Interfaces:**
- Consumes: the behavior of Tasks 1–6.
- Produces: documentation only. `skills/` is linked into `.claude/skills` and `.agents/skills`, so nothing is regenerated (`npm run agents:check` confirms it). The full direction methodology (when to morph, variety, the critique loop) is PR B7's; the skill gets a short pointer in agent-only sections.

If B2's merged documentation words a bullet differently from its plan, edit the merged bullet to say what is below.

- [ ] **Step 1: `docs/video.md`**

In `### Direction and the canvas`, in the **Elements** bullet, after the `capture` element's description ("`capture` (a `screenshot:` id);"), insert:

```markdown
`morph` (a `diff-hunk:` id: the hunk's code before the change, turning into the code after it on its `morph` beat; see [The token morph](#the-token-morph));
```

In the **Beats** bullet, after the `camera` beat's description, add: "`morph` (a morph element turns into the code after the change; a morph element no beat names morphs anyway, in the next spaced slot)." Replace its last sentence ("A camera beat aimed at the visual frames what the visual highlights then (its lines, its focus); `follow` frames its target the same way.") with:

```markdown
A camera beat aimed at the visual frames what the visual highlights then (its lines, its focus). `follow` on a morph frames its changed lines at every frame, so the camera moves with them as rows open and close; on anything else it frames its target like `zoom`.
```

In the **The default director** bullet, replace its opening, "**The default director** keeps every scene's visual, zooms a code scene 1.25× toward the lines it highlights as they light, and picks", with: "**The default director** morphs a code scene whose visual shows one hunk with code on both sides and at most 12 deleted and 12 added lines (the camera follows its changed lines at 1.25×, and the morph lands on the phrase that lights its highlights, else spread through its line; a scene in `mode: "morph"` or with a caption keeps its visual); every other scene keeps its visual, a code scene zooms 1.25× toward the lines it highlights as they light, and it picks". Then, after the section's last bullet, add:

````markdown
#### The token morph

A `morph` element shows a hunk's code before the change and turns it, token by token, into the code after it. Removed tokens tint red and fade; a removed line with nothing to replace it folds away. Added tokens slide in green and settle to their syntax colors half a second later; an added line opens room for itself. Tokens a replaced line keeps (Covi pairs each deleted line with the added line it shares the most with, and keeps their longest common run of tokens) travel from their old place to their new one, and lines below a change move with it. Before the morph the code reads as plain old code; after it, as the code after the change, its added lines tinted. A morph takes 1.6 s.

- **Tokens** are words in any script, numbers, single punctuation characters, and whitespace; comments and strings split into their words, so a changed word moves on its own, and a line inside a block comment colors as a comment. At most 64 tokens a line, 96 characters a line, as code elements cut them.
- **Elision.** A morph shows at most 14 rows a side (18 in 9:16): every changed line first, then the context nearest them. A run left out between kept lines becomes one `… N lines` marker (Covi counts N on each side; the words come from the video's language); runs at the top or bottom of a hunk are cut, as a code card cuts a hunk to its window.
- **Size.** Code renders as large as its longer side allows, as a code card does (24 px at 1080p at least, up to 44, 48 in 9:16); the card covers at least 60% of its slot.
- **What can morph.** Code on both sides (a new or deleted file has nothing to turn into) and at most 12 deleted and 12 added lines. `covi render` refuses a morph that does not fit and says why: show such a hunk as a `code` element with `lines`.
- Each hunk line is redacted whole before it is split into tokens, and every token is drawn as text.
````

In `### Composition and rendering`, in the contact sheet bullet, replace "and the hero's accent 0.1 s after its `hero` phase:" with "the hero's accent 0.1 s after its `hero` phase, and the middle of each morph:".

- [ ] **Step 2: `docs/visual-system.md`**

After B2's **The canvas.** bullet of "How they move", add:

```markdown
- **The token morph.** A morph (`runtime/direction/morph.ts`) lays out the code before and after the change once, then places every token, line number, mark, and row tint between its two boxes as a pure function of the frame: removed tokens tint to the delete color and fade (their row folds when nothing replaces it), kept tokens travel on an ease, added tokens slide in from 0.6 em to the left in the add color and settle to their syntax colors 0.5 s after the morph. Phases overlap (`MORPH_PHASES` in `timeline/cues.ts`), so its middle, which the contact sheet shows, has all three on screen.
```

- [ ] **Step 3: `docs/security.md`**

In B2's `### The direction file`, at the end of the **Content only from evidence.** bullet, add: "A morph's tokens come from its hunk in the run's diff: each line is redacted whole before it is split into tokens, so a secret cannot slip through in pieces."

- [ ] **Step 4: `docs/contributing.md`**

Replace "(the opening, every scene, every transition, and the hero's accent)" with "(the opening, every scene, every transition, the hero's accent, and every morph's middle)".

- [ ] **Step 5: `skills/covi-video/SKILL.md`**

In **Review it yourself**, replace "the middle of every transition, and the hero's accent; the outro last)" with "the middle of every transition, the hero's accent, and the middle of every morph; the outro last)".

At the end of B2's **Direction.** paragraph in `## Run it`, add:

```markdown
To show code changing, give a shot a `morph` element (a `diff-hunk:` id with code on both sides and at most 12 changed lines a side) and a `morph` beat on the phrase where the change lands; `camera` `follow` on it keeps the changed lines framed while they move. Covi's draft already morphs code scenes whose hunk is that small.
```

- [ ] **Step 6: `CHANGELOG.md`**

Under `## [Unreleased]`, in its `### Added` list, one line:

```markdown
- Code morph: a `morph` element (`diff-hunk:` id) and `morph` beat turn a hunk's code before the change into the code after it, token by token (removed lines fold away, new lines slide in, kept tokens travel), long hunks elide to 14 rows (18 in 9:16) with a `… N lines` marker in the video's language, `camera follow` keeps the changed lines framed at every frame, Covi's default director morphs code scenes whose hunk changes at most 12 lines a side, and the contact sheet shows every morph's midpoint.
```

- [ ] **Step 7: Run every check**

Run in the background and wait for each: `npm run check` (lint, typecheck, `agents:check`, `npm test`), then `npm run test:render`.
Expected: both PASS. If `npm run test:render` fails in a test this PR did not touch, check it against `main` before changing anything: a render test that fails on `main` too is not this PR's to fix, and the report says so.

- [ ] **Step 8: Commit**

```bash
git add docs skills/covi-video/SKILL.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
Document the token morph

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
## Self-review

Checked against the spec and the owner's scope with fresh eyes, then fixed inline.

- **Spec coverage.** §6 source from the redacted hunk → Task 3 (lines redacted whole, then `redactDeep`). Tokenizer classes and LCS alignment within replaced pairs, kept/removed/added → Task 1 (`tokenize`, `pairLines`, `sharedTokens`, `MorphVisual.tokens`). Removed lines fold, added lines slide in, kept tokens travel, both layouts measured after fonts load, eased → Task 2 (`morph.ts`). Changed tokens tint with add/del colors and settle → Task 2. Camera `follow` frames the changed lines → Task 4 (per frame), Task 5 (default). Elision 14/18, changed first then nearest context, one marker per run with N computed by Covi, deterministic → Task 1 (`keptLines`, `morphHunk`), Task 3 (catalog words, orientation). Code ≥ 24 px at 1080p and the card sized to content → Task 2 (B1's `codeFont`, `cardHeight`; the report's `font` feeds B1's `text-size`). §4.2 `morph` element and §4.3 `morph` verb, additive to `DirectionSchema`, `DIRECTION_LIMITS` as the bounds source → Tasks 1 and 3. §4.6 validation (evidence kind, compatible beat kinds) → Task 3. §4.8 default director's morph → Task 5. §14 untrusted input, text only → Tasks 2 (security render test) and 3 (redaction). §15 render tests (mid-animation frame, determinism, elision marker, camera following) → Tasks 2 and 4; the benchmark → Task 6. The owner's pointers: tokens bounded per line and per hunk → `DIRECTION_LIMITS.morph`; the existing `mode: "morph"` untouched → Task 5's director skips it and Task 2 styles under a different class; contact-sheet midpoint → Task 6; docs, skill pointer, CHANGELOG subsection, `npm run check`, `npm run test:render`, no `version` changes → Task 7 and Global Constraints.
- **Placeholders.** None: every code step carries its code, including the keyword table Task 1 moves; the B1- and B2-dependent edits name the merged code they change and say what to do if a merged name differs.
- **Type consistency.** `MorphToken`, `MorphRow`, `MorphVisual`, `TokenTone` (Task 1) are used with those shapes in Tasks 2, 3, and the tests; `morphHunk(lines, { max, language?, elided })` and `morphProblem(lines)` (Task 1) in Tasks 3 and 5; the timeline's `{ kind: 'morph'; morph }` element and `{ verb: 'morph'; element; t; seconds }` beat (Task 2) in Tasks 3, 4, 6; `MORPH_PHASES`, `MORPH_SETTLE` (Task 2) in `morph.ts` and its tests; `Component.follow(t)` (Task 2) behind `ShotComponent.track(id, t)` (Task 4) behind `cameraSteps`; `CameraStep.to: View | ((t) => View)` (Task 4); `DirectorInput.sources` (Task 5) from `planDirection`.
- **Verification of the plan itself.** Every task's code was applied to a scratch copy of the B2 planner's mirror (v0.2.0 + B2's plan code) with B1's `sizing.ts`, `drawnFont`, `LayoutItem` fields, code-card sizing, and benchmark example added from B1's plan and merged branch, and run there: the unit suites (`tokens`, `morph-timeline`, `direction-morph`, `director`, `canvas`, `frames`, and every existing suite), `tests/examples.test.ts` with the director over all six examples (the benchmark morphs `src/reader.js:19`), the render tests (`tests/render/morph.test.ts`, `tests/render/canvas.test.ts`, `tests/direction-security.test.ts`, `tests/render/render.test.ts`), the four full-pipeline renders under `COVI_TEST_RENDER=1`, lint, and both typechecks. A `backend-slim-request --standard` render drew the hero code scene as a morph with the camera following it, and its contact sheet's mid-morph tile shows the old call fading, `+ 1` arriving, and the new loop's rows opening in green. B1's density checks were not in that copy, so the `text-size` interplay was reasoned, not run (the morph reports `font: drawnFont(live)` and `text: 'code'` like B1's code card).
- **Review Focus.** Each of the five lines has its test in the owning task (Tasks 1, 3, 2, 1 and 2, 3).

## Rulings

- Ruling: tokens are words of any script, numbers, single punctuation characters, and whitespace runs (layout only), and comments and strings split into their words, each carrying the comment's or string's color — §6 lists strings and comments as token classes, but whole-comment tokens keep a doc comment's sentence from travelling when the comment is rewrapped (the benchmark's), and a changed word inside a string from moving alone — long strings make more tokens (64 a line at most).
- Ruling: a C-family line that starts with `*` or `/*` reads as a comment, unlike the code card's highlighter, which reads each line alone — the inside of a block comment is the most common multi-line context in a hunk, and coloring its words as names and types looks broken mid-morph — a C line starting with a dereference (`*p = …`) colors as a comment in a morph.
- Ruling: which deleted line an added line replaces is an order-preserving alignment maximizing kept characters, pairing only lines that share at least 2 characters and 25% of the shorter line's — §6 aligns lines by the hunk and tokens by LCS within a replaced pair, but does not say which lines pair; pairing in order would pair the benchmark's one-line comment with `/**` instead of its sentence, and any share (a comma) would pair unrelated lines — a reader could pair a block differently.
- Ruling: elision keeps changed lines first (in order, while they fit), then context nearest them (earlier on a tie), retrying until nothing more fits; a run left out between kept lines becomes one marker per side that hides lines, counting that side's lines (so a marker can read differently before and after); runs at either end of a hunk are cut without a marker — a hunk is already a window of its file, edge markers would count lines that cost rows context could use (the benchmark's 20-line hunk fits 14 rows with no marker), and a viewer is not told about lines the code card never showed either — a viewer is not told the hunk continues past the card's top or bottom.
- Ruling: the marker reads `… N lines` with `…` (U+2026), not the spec's `⋯` (U+22EF), through a new `video.elided` key in all four catalogs — the composition embeds only the latin slices of Inter and JetBrains Mono (U+0000–00FF, U+2000–206F), so `⋯` would fall back to a machine font and differ across machines — cosmetic.
- Ruling: a hunk can morph when it has code on both sides and at most 12 deleted and 12 added lines (`DIRECTION_LIMITS.morph.changedLines`, a landscape card's 14 rows less two for context); an agent's morph of any other hunk is refused (exit 2, with "show it as code, with `lines`"), and the director applies the same rule in every orientation — a new or deleted file has nothing to turn into, and a morph that elides changed lines hides the change it exists to show — a 9:16 video does not morph a 13–16-line change it could fit, and an agent cannot animate a long change.
- Ruling: a morph element that no `morph` beat names morphs anyway, on an implicit beat appended to the shot (spread like any beat without a phrase) — the spec says elements are present from the shot's start but not when a morph plays; a morph that never moves is a code card — an agent wanting a static before-view uses a `code` element with `side: "base"`.
- Ruling: both sides are laid out from the same first line (the longer side centered in the card), so the code above the first change does not move — centering each side separately moves every line by half the height change, which reads as the whole card jumping — the shorter side sits above center before or after the morph.
- Ruling: a morph takes 1.6 s (`BEAT_SECONDS.morph`); removed tokens fade over the first 70%, rows close and kept tokens travel over 10–90%, added tokens arrive over 35–100%, then take their syntax colors over 0.5 s (`MORPH_PHASES`, `MORPH_SETTLE`) — the spec leaves lengths open, and the contact sheet's midpoint tile must show the morph happening, so the three phases overlap there — the middle frame is busy by design; retuning is a data change.
- Ruling: before its beat a morph reads as plain old code (no tints, no marks), removed tokens tint to the brand's delete color over the first 12% then fade, changed rows take the diff tints (removed from the morph's start, added as they arrive), and the settled morph shows the code after the change with its added rows tinted — "changed tokens tint with the brand's add/del colors and settle", and the line morph already reads the old code plainly first — none expected.
- Ruling: camera `follow` on an element that reports `follow` (a morph) follows it per frame through a function-valued `CameraStep.to`, evaluated by `viewAt`; the box runs from the changed rows' start (their numbers) to the end of their longest text; the default director's follow uses `zoom: CODE_ZOOM` (1.25), as B2's code zoom does, while an agent's follow without `zoom` fits the box — B2 ruled that B3 must follow moving targets per frame; a fitted zoom on wide code is about 1.05× and barely moves, and a box that starts at the text would push the line numbers out of the frame — at 1.25× a 14-row card's first or last row is out of the region, though the changed lines never are.
- Ruling: the default director morphs a code scene when its visual (read for what it shows, `sceneEvidence({ visual })`, B2's ruling) shows exactly one hunk that can morph, unless the visual is `mode: "morph"` or has a caption; its beats are an unpinned `camera follow` (first spaced slot, so the old lines are framed before they change) and a `morph` on the scene's highlight phrase (its first group's phase, else `highlight`), else spread — `sync.morph` exists only on `mode: "morph"` scenes, and those keep the line morph exactly as the owner asked; a caption is text the morph would drop — a visual spanning two hunks keeps its code card.
- Ruling: the storyboard's line-level `mode: "morph"` is untouched (its component, styles under `.code.morph`, and timing), and `video.direction: off` never draws a token morph — the owner asked to keep it working unchanged, and R-016 — two morph looks coexist until B7's methodology steers agents.
- Ruling: a morph leads as `code` for B1/B2's monotony and empty-frame checks — it is a dark code card on screen — a code card, a morph, and a code card in a row warn.
- Ruling: the contact sheet gains one tile at every morph's midpoint; the poster stays at 1.6 s — the acceptance list judges the contact sheet and poster together, the sheet is where "code visibly morphs" must show, and a mid-morph frame (old and new tokens overlapping) makes a poor thumbnail for PR comments — if the owner wants the poster on the morph, `posterFrame` is a one-line change.
- Ruling: the resolver redacts each hunk line whole before tokenizing it, besides the final `redactDeep` — a secret outside a string splits into tokens (`hunter2`, `-`, `shh`) that per-token redaction would miss — none.
- Ruling: the morph reuses the code card's look (`.code` panel, head with path and language, gutter, marks, line height 1.55, B1's `codeFont` and `cardHeight` over its longer side) and draws absolutely placed spans measured once at mount from two flow layouts of the same rows — exact token boxes with the browser's own text layout, and every frame a pure function of time — about 300 spans for a 14-row morph.
- Ruling: `DIRECTION_LIMITS.morph` reads at most 400 lines of a hunk, 96 characters a line (as the code element), and 64 tokens a line — every list bounded; a hunk that long fills a card long before its 400th line, because git splits hunks at seven unchanged lines — none expected.
- Ruling: a shot without the storyboard visual points the narrator at its first element that has a target (a morph's changed lines) — B2 pointed only at the visual, so a morph-only shot would point nowhere — a shot of code and output elements still points by gaze (they report no target).
- Ruling: the morph render tests build timelines by hand (staging with a morph element and its beats, as the resolver writes them) instead of through B2's `directed()` helper — the runtime is tested apart from the schema and from a helper whose shape B2's execution may change — a little duplicated setup.
