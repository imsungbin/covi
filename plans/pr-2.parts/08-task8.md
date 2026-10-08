### Task 8: Cold-open support: a title over a capture, and frame 0 shows the subject

A `title` with `background` is drawn as the capture in the media region with the title in the scene header (Decision 9); the corner narrator shows and looks at it. The video's first scene skips its entrances, so frame 0 already shows the subject; its zoom, click, highlight, and typing still play on time.

**Files:**
- Modify: `packages/video/src/runtime/components/types.ts` (`SceneClock.open`, `entered`)
- Modify: `packages/video/src/runtime/components/cards.ts` (`titleOver`; entrances via `entered`)
- Modify: `packages/video/src/runtime/components/media.ts` (entrances via `entered`)
- Modify: `packages/video/src/runtime/stage.ts` (`open` clock, settled header, `titleOver` mount, gaze)
- Modify: `packages/video/src/timeline/build.ts` (narrator, eyebrow, and heading for a title over a capture)
- Test: `packages/video/test/cold-open.test.ts` (create)

**Interfaces:**
- Consumes: the title `background` (Tasks 1 and 3), `Frame` (`components/frame.ts`).
- Produces: `SceneClock.open: boolean`; `entered(clock: Pick<SceneClock, 't' | 'open'>, start: number, end: number): number`; `titleOver(v: TitleVisual & { background: ImageAsset }, ctx: ComponentContext): Component`.

- [ ] **Step 1: Write the failing test**

Create `packages/video/test/cold-open.test.ts`:

```ts
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { entered } from '../src/runtime/components/types.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes } from '../src/timeline/build.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
const build = (scenes: Scene[]) =>
  buildTimeline({
    title: 'T',
    scenes,
    layout: layoutScenes(scenes, new Map()),
    spec,
    image: () => ({ src: 'a.png', width: 1280, height: 800 }),
  });
const title = (extra: Record<string, unknown> = {}) => ({
  kind: 'title',
  title: 'Clamp quantities at zero',
  eyebrow: 'The bug',
  meta: [],
  ...extra,
});
const wrap = {
  id: 's2',
  beat: 'summary',
  narration: 'Done.',
  visual: { kind: 'callout', tone: 'info', title: 'C' },
};

describe('the opening scene', () => {
  it('is in place from frame 0, while later scenes enter', () => {
    expect(entered({ t: 0, open: true }, 0, 0.55)).toBe(1);
    expect(entered({ t: 0, open: false }, 0, 0.55)).toBe(0);
    expect(entered({ t: 0.275, open: false }, 0, 0.55)).toBeCloseTo(0.5, 9);
  });
});

describe('a title over a capture', () => {
  it('shows the capture, puts the title in the header, and keeps the narrator', () => {
    const over = build([
      {
        id: 's1',
        beat: 'context',
        narration: 'Remove one too many.',
        visual: title({ background: { path: 'demo/a.png' } }),
      },
      wrap,
    ] as Scene[]).scenes[0]!;
    expect(over).toMatchObject({
      eyebrow: 'The bug',
      heading: 'Clamp quantities at zero',
      narrator: true,
    });
  });

  it("lets the scene's own eyebrow and heading win", () => {
    const over = build([
      {
        id: 's1',
        beat: 'context',
        eyebrow: 'Cart',
        heading: 'Minus one',
        narration: 'Remove one too many.',
        visual: title({ background: { path: 'demo/a.png' } }),
      },
      wrap,
    ] as Scene[]).scenes[0]!;
    expect(over).toMatchObject({ eyebrow: 'Cart', heading: 'Minus one' });
  });

  it('leaves a title card as it was: the large fox, no header', () => {
    const card = build([
      { id: 's1', beat: 'context', narration: 'Hello.', visual: title() },
      wrap,
    ] as Scene[]).scenes[0]!;
    expect(card).toMatchObject({ eyebrow: 'context', narrator: false });
    expect(card.heading).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/cold-open.test.ts
```

Expected: FAIL (`entered` is not exported; the title over a capture has `narrator: false` and no heading).

- [ ] **Step 3: Map a title over a capture in `packages/video/src/timeline/build.ts`**

Replace `const NO_NARRATOR = new Set<TimelineVisual['kind']>(['title', 'summary', 'outro']);` with:

```ts
/** Title cards (without a capture), summaries, and the outro draw the fox large themselves. */
function drawsFox(visual: TimelineVisual): boolean {
  return (
    visual.kind === 'summary' ||
    visual.kind === 'outro' ||
    (visual.kind === 'title' && !visual.background)
  );
}
```

In the scenes map of `buildTimeline`, compute the header for a title over a capture and use `drawsFox`:

```ts
    // A title over a capture is a cold open: the capture fills the media region and the title
    // goes in the header, where a content scene's heading goes.
    const over = visual.kind === 'title' && visual.background ? visual : undefined;
```

and in the returned object:

```ts
      eyebrow: scene.eyebrow ?? over?.eyebrow ?? scene.beat,
      heading: scene.heading ?? over?.title,
      // …
      narrator: spec.mascot && !drawsFox(visual),
```

- [ ] **Step 4: Add `open` and `entered` in `packages/video/src/runtime/components/types.ts`**

Add `import { seg } from '../anim.ts';` and, in `SceneClock`, after `fox`:

```ts
  /** The video's first scene: already in place at frame 0, so the first frame shows the subject. */
  open: boolean;
```

After `overflows`, add:

```ts
/** Entrance progress over [start, end]; the opening scene is already in place at frame 0. */
export function entered(clock: Pick<SceneClock, 't' | 'open'>, start: number, end: number): number {
  return clock.open ? 1 : seg(clock.t, start, end);
}
```

- [ ] **Step 5: Draw the title over a capture in `packages/video/src/runtime/components/cards.ts`**

Add imports: `import type { ImageAsset, TimelineVisual } from '../../timeline/types.ts';` (merge with the existing type import) and `import { Frame } from './frame.ts';` and `entered` from `./types.ts`. Then add:

```ts
/**
 * A title over a capture, for a cold open: the capture fills the media region (in browser chrome
 * when it is a landscape page), and the stage draws the title in the scene header. The camera
 * drifts across it like any capture.
 */
export function titleOver(
  v: V<'title'> & { background: ImageAsset },
  ctx: ComponentContext,
): Component {
  const frame = new Frame(ctx.root, ctx.regions.media, v.background, {
    chrome: v.background.width >= v.background.height,
    url: v.background.label,
    u: ctx.u,
  });
  return {
    update(clock) {
      rise(frame.root, entered(clock, 0, 0.55), ctx.u(28));
    },
    report: () => [{ role: 'media', rect: rectOf(frame.root) }],
  };
}
```

In `title`'s `update`, switch the entrances to `entered` (the fox's spring too, so the opening title card is in place at frame 0):

```ts
    update(clock) {
      const { t } = clock;
      if (fox) {
        const s = clock.open ? 1 : spring(t, 1.6, 5.5);
        fox.style.transform = `scale(${lerp(0.82, 1, clamp(s, 0, 1.08)).toFixed(4)})`;
        fox.style.opacity = String(easeOutCubic(entered(clock, 0, 0.35)).toFixed(3));
        fox.innerHTML = foxSvg({ ...pose(clock), size: foxSize, theme: ctx.timeline.theme.name });
      }
      if (eyebrow) rise(eyebrow, entered(clock, 0.15, 0.55), ctx.u(14));
      rise(heading, entered(clock, 0.25, 0.75), ctx.u(22));
      if (sub) rise(sub, entered(clock, 0.4, 0.9), ctx.u(16));
      for (const [i, c] of chips.entries())
        rise(c, entered(clock, 0.5 + i * 0.08, 0.9 + i * 0.08), ctx.u(12));
    },
```

(The summary is never the first scene; leave it.)

- [ ] **Step 6: Settle the opening entrances in `packages/video/src/runtime/components/media.ts`**

Import `entered` from `./types.ts`. Each `update` that takes `{ t, duration }` now takes `clock` and destructures `const { t, duration } = clock;` where it needs them. Replace these entrance windows (and only these: choreography such as zooms, clicks, reveals, highlights, typing, finding cards, and the after panel keeps `seg`):

| Component | Before | After |
|---|---|---|
| screenshot | `rise(frame.root, seg(t, 0, 0.55), …)` | `rise(frame.root, entered(clock, 0, 0.55), …)` |
| beforeAfter | `rise(frames[0]!.root, seg(t, 0, 0.5), …)` and `rise(labels[0]!, seg(t, 0.05, 0.5), …)` | `entered(clock, 0, 0.5)` and `entered(clock, 0.05, 0.5)` |
| wipe | `rise(before.root, seg(t, 0, 0.5), …)` and `fade(labels[0]!, seg(t, 0.1, 0.5))` | `entered(clock, 0, 0.5)` and `entered(clock, 0.1, 0.5)` |
| interaction | first step: `easeOutCubic(i === 0 ? seg(t, 0, 0.45) : …)`; label: `fade(label, seg(since, 0, 0.3))` | `i === 0 ? entered(clock, 0, 0.45) : …`; `fade(label, active === 0 ? entered(clock, 0, 0.3) : seg(since, 0, 0.3))` |
| code | `rise(panel, seg(t, 0, 0.5), …)` and `fade(row, seg(t, 0.15 + i * 0.035, 0.45 + i * 0.035))` | `entered(clock, 0, 0.5)` and `entered(clock, 0.15 + i * 0.035, 0.45 + i * 0.035)` |
| terminal | `i === 0 ? seg(t, 0, 0.5) : …` | `i === 0 ? entered(clock, 0, 0.5) : …` |
| api | `rise(req, seg(t, 0, 0.4), …)`; the first panel when it is the only one or the before panel | `entered(clock, 0, 0.4)`; `rise(p, i === 0 ? entered(clock, ...spans[0]!) : seg(t, ...spans[i]!), …)` |
| changeMap | `rise(row, seg(t, 0.1 + i * 0.12, 0.5 + i * 0.12), …)` and the bars' `seg(t, 0.4 + i * 0.12, 1.1 + i * 0.12)` | `entered(clock, …)` for both |
| callout | `seg(t, 0, 0.55)` and the icon's `seg(t, 0.15, 0.6)` | `entered(clock, 0, 0.55)` and `entered(clock, 0.15, 0.6)` |
| diagram | the nodes' `seg(t, 0.1 + i * 0.1, 0.5 + i * 0.1)` and the edges' `seg(t, 0.8 + i * 0.12, 1.5 + i * 0.12)` | `entered(clock, …)` for both |

For an API scene, the first panel (the only response, or the before panel of a pair) is the subject and enters settled in the opening scene; the after panel of a pair is choreography and keeps `seg`.

- [ ] **Step 7: Wire it in `packages/video/src/runtime/stage.ts`**

- Import `titleOver` alongside `summary, title` from `./components/cards.ts`.
- In `mountComponent`, change the title case to:

```ts
    case 'title':
      return v.background ? titleOver({ ...v, background: v.background }, ctx) : title(v, ctx, scene.expression);
```

- In `gazeFor`, look ahead only on cards that draw the large fox:

```ts
  const v = scene.visual;
  if (v.kind === 'summary' || (v.kind === 'title' && !v.background)) return { x: 0, y: 0 };
```

- In `seek`, add `open: first,` to the `clock` literal.
- In the header entrance, settle the opening scene's header:

```ts
      if (m.header) {
        const eyebrow = m.header.firstElementChild as HTMLElement;
        eyebrow.style.opacity = easeOutCubic(first ? 1 : seg(local, 0.05, 0.4)).toFixed(3);
        const heading = m.header.children[1] as HTMLElement | undefined;
        if (heading) {
          const e = easeOutCubic(first ? 1 : seg(local, 0.12, 0.55));
          heading.style.opacity = e.toFixed(3);
          heading.style.transform = `translateY(${((1 - e) * 14 * this.regions.unit).toFixed(2)}px)`;
        }
      }
```

- [ ] **Step 8: Run the tests, the typecheck, and the render tests**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/cold-open.test.ts packages/video/test
cd "$WT" && npm run typecheck && npx vitest run tests/render/render.test.ts
cd "$WT" && npx biome check --write packages/video/src packages/video/test/cold-open.test.ts
```

Expected: all PASS (the render tests' first scene is a title card whose fox and text are now in place at frame 0; the determinism test still renders identical bytes).

- [ ] **Step 9: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src packages/video/test/cold-open.test.ts && git commit -F - <<'EOF'
Open on the subject: a title over a capture, settled at frame 0

A title with a background draws the capture in the media region and the
title in the scene header, with the narrator in its corner. The first
scene skips its entrances, so frame 0 already shows what the video is
about; its zooms, clicks, and highlights still play on time.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
