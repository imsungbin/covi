### Task 3: Timeline scenes carry their transition, phases, hero, and camera

The timeline is the contract with the runtime, so everything the new grammar decides is resolved here: each scene's incoming transition (kind and length, from new brand tokens), its phases in scene-local seconds (Task 2's split), the hero flag and its `hero` phase, a static camera, and a title's background image. Speech text loses the `[[…]]` markup. Layout timing is untouched in this task (Task 5 changes it).

**Files:**
- Modify: `packages/brand/src/tokens.ts` (`motion`)
- Modify: `packages/video/src/timeline/types.ts`
- Modify: `packages/video/src/timeline/build.ts`
- Modify: `packages/video/src/pipeline.ts` (`storyboardImages`)
- Test: `packages/video/test/timeline-grammar.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 (`parseEmphasis`, `findPhrase`, `TRANSITION_KINDS`, `TransitionKind`, `HERO_PHASE`, the new `Scene` fields), Task 2 (`phraseTime`).
- Produces:
  - `motion.transitions: { fade: 0.45; cut: 0; push: 0.5; wipe: 0.55; 'zoom-through': 0.6 }`, `motion.drift = 0.02`, `motion.linger = 0.02`, `motion.punch = 0.06`, `motion.flash = { seconds: 0.18, opacity: 0.35 }` (Task 6 uses the last four).
  - `types.ts`: `interface SceneTransition { kind: TransitionKind; seconds: number }`; `TimelineScene.transition?: SceneTransition`, `phases?: Record<string, number>`, `hero?: boolean`, `camera?: 'static'`; the `title` timeline visual gains `background?: ImageAsset`.
  - `build.ts`: `sceneTransition(scene: Pick<Scene, 'transition' | 'hero'>): SceneTransition`; `scenePhases(scene: Pick<Scene, 'sync' | 'hero'>, text: string, timing: SceneTiming, options: CaptionOptions): Record<string, number> | undefined`.
  - `pipeline.ts`: `storyboardImages(storyboard: { scenes: readonly Pick<Scene, 'visual'>[] }): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/video/test/timeline-grammar.test.ts`:

```ts
import { motion } from '@covi/brand';
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { storyboardImages } from '../src/pipeline.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, TRANSITION_KINDS } from '../src/storyboard/schema.ts';
import {
  buildTimeline,
  layoutScenes,
  OUTRO_ID,
  pacingFor,
  sceneTransition,
} from '../src/timeline/build.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const shot = {
  kind: 'screenshot',
  image: { path: 'demo/a.png' },
  focus: { x: 0, y: 0, width: 10, height: 10 },
  click: { x: 5, y: 5 },
  device: 'desktop',
} as const;
const scene = (id: string, narration: string, extra: Record<string, unknown> = {}): Scene =>
  ({ id, beat: id, narration, visual: callout, ...extra }) as Scene;

function build(scenes: Scene[]) {
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  return buildTimeline({
    title: 'T',
    scenes,
    layout,
    spec,
    image: () => ({ src: 'a.png', width: 100, height: 100 }),
  });
}

describe('transitions in the timeline', () => {
  it('fade by default, zoom through into the hero, and take their length from the brand', () => {
    expect(sceneTransition({})).toEqual({ kind: 'fade', seconds: 0.45 });
    expect(sceneTransition({ hero: true })).toEqual({ kind: 'zoom-through', seconds: 0.6 });
    expect(sceneTransition({ hero: true, transition: 'cut' })).toEqual({ kind: 'cut', seconds: 0 });
    for (const kind of TRANSITION_KINDS)
      expect(sceneTransition({ transition: kind }).seconds).toBe(motion.transitions[kind]);
    expect(Object.keys(motion.transitions).sort()).toEqual([...TRANSITION_KINDS].sort());
  });

  it('give every scene but the first its transition, and the outro its fade', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'Two.', { transition: 'push' }),
      scene('s3', 'Three.'),
    ]);
    expect(timeline.scenes.at(-1)!.id).toBe(OUTRO_ID);
    expect(timeline.scenes.map((s) => s.transition)).toEqual([
      undefined,
      { kind: 'push', seconds: 0.5 },
      { kind: 'fade', seconds: 0.45 },
      { kind: 'fade', seconds: 0.45 },
    ]);
  });
});

describe('phases', () => {
  it('pin each sync phrase to when it is spoken, in seconds since the scene started', () => {
    const timeline = build([
      scene('s1', 'Here is the composer.'),
      scene('s2', 'Open the composer, type a comment, then press Post.', {
        visual: shot,
        sync: { zoom: 'type a comment', click: 'press Post' },
      }),
      scene('s3', 'Done.'),
    ]);
    const s2 = timeline.scenes[1]!;
    const speech = { start: s2.speech!.start - s2.start, end: s2.speech!.end - s2.start };
    const { zoom, click } = s2.phases!;
    expect(zoom).toBeGreaterThan(speech.start);
    expect(click).toBeGreaterThan(zoom!);
    expect(click).toBeLessThan(speech.end);
    expect(timeline.scenes[0]).not.toHaveProperty('phases');
  });

  it('put the hero phase on its sync phrase, else on the start of its line', () => {
    const hero = (extra: Record<string, unknown>) =>
      build([scene('s1', 'One.'), scene('s2', 'The counter turns amber.', extra), scene('s3', 'Done.')])
        .scenes[1]!;
    const plain = hero({ hero: true });
    expect(plain.hero).toBe(true);
    expect(plain.phases).toEqual({ hero: Number((plain.speech!.start - plain.start).toFixed(3)) });
    const synced = hero({ hero: true, sync: { hero: 'turns amber' } });
    expect(synced.phases!.hero).toBeGreaterThan(plain.phases!.hero!);
  });

  it('skip a phrase that redaction removed instead of failing', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'The key [REDACTED] leaked.', { sync: { highlight: 'sk-live-123' } }),
      scene('s3', 'Done.'),
    ]);
    expect(timeline.scenes[1]).not.toHaveProperty('phases');
  });
});

describe('the line, the hero, and the camera', () => {
  it('speak and caption the line without markup', () => {
    const timeline = build([scene('s1', 'It counts [[down to zero]].'), scene('s2', 'Done.')]);
    expect(timeline.scenes[0]!.speech!.text).toBe('It counts down to zero.');
    expect(timeline.captions.flatMap((c) => c.lines).join(' ')).not.toMatch(/\[\[|\]\]/);
  });

  it('carry the hero and a static camera, and add nothing to a storyboard that uses neither', () => {
    const timeline = build([
      scene('s1', 'One.'),
      scene('s2', 'Two.', { hero: true, camera: 'static' }),
      scene('s3', 'Three.', { camera: 'drift' }),
    ]);
    expect(timeline.scenes[1]).toMatchObject({ hero: true, camera: 'static' });
    expect(timeline.scenes[2]).not.toHaveProperty('camera');
    for (const s of build([scene('s1', 'One.'), scene('s2', 'Two.')]).scenes) {
      expect(s).not.toHaveProperty('phases');
      expect(s).not.toHaveProperty('hero');
      expect(s).not.toHaveProperty('camera');
    }
  });

  it('set a title over a capture, and list the capture among the images to prepare', () => {
    const title = {
      kind: 'title',
      title: 'T',
      meta: [],
      background: { path: 'demo/a.png', label: '/' },
    } as const;
    const scenes = [scene('s1', 'One.', { visual: title }), scene('s2', 'Two.', { visual: shot })];
    expect(build(scenes).scenes[0]!.visual).toEqual({
      kind: 'title',
      title: 'T',
      meta: [],
      background: { src: 'a.png', width: 100, height: 100, label: '/' },
    });
    expect(storyboardImages({ scenes })).toEqual(['demo/a.png', 'demo/a.png']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/timeline-grammar.test.ts
```

Expected: FAIL (`sceneTransition` and `storyboardImages` are not exported; `motion.transitions` is undefined).

- [ ] **Step 3: Add the motion tokens in `packages/brand/src/tokens.ts`**

Replace the `motion` constant with:

```ts
export const motion = {
  /** The default scene transition (a fade) in seconds; consecutive scenes overlap by it. */
  transition: 0.45,
  /**
   * Each scene transition's length in seconds; a cut has none. All stay under 0.625 s, so the
   * scene before a transition ends at most 0.6 s after its line (see the video timeline).
   */
  transitions: { fade: 0.45, cut: 0, push: 0.5, wipe: 0.55, 'zoom-through': 0.6 },
  /** A capture's camera drift through its scene: a slow push-in of at most 2%, eased in and out. */
  drift: 0.02,
  /** The push-in once a visual has finished while its line continues, so it never holds still. */
  linger: 0.02,
  /** The hero's camera punch. */
  punch: 0.06,
  /** The hero's flash: how long it lasts (s) and its peak opacity. */
  flash: { seconds: 0.18, opacity: 0.35 },
} as const;
```

- [ ] **Step 4: Extend `packages/video/src/timeline/types.ts`**

After `HERO_PHASE` (Task 1), add:

```ts
/** The transition into a scene, resolved: its kind and its length in seconds. */
export interface SceneTransition {
  kind: TransitionKind;
  seconds: number;
}
```

Change the `title` member of `TimelineVisual` to:

```ts
  | {
      kind: 'title';
      title: string;
      subtitle?: string;
      eyebrow?: string;
      meta: string[];
      /** A capture the title is set over (a cold open). */
      background?: ImageAsset;
    }
```

In `TimelineScene`, after `speech`, add:

```ts
  /**
   * How the scene enters, and for how long. The first scene has none. Timelines written before
   * transitions had kinds lack it: every scene faded in over `Timeline.transition`.
   */
  transition?: SceneTransition;
  /**
   * Moments the visual pins to, in seconds since the scene started, by phase name: the
   * storyboard's `sync` phrases resolved against the speech, and the hero's `hero`.
   */
  phases?: Record<string, number>;
  /** The scene where the change clicks (storyboard `hero: true`). */
  hero?: boolean;
  /** The storyboard asked the picture to hold still: no drift, no linger. */
  camera?: 'static';
```

- [ ] **Step 5: Resolve transitions, phases, the hero, and markup in `packages/video/src/timeline/build.ts`**

Update the imports:

```ts
import { motion, themes, typography } from '@covi/brand';
import { type Language, seedFrom, t } from '@covi/core';
import { buildCaptions, type CaptionOptions, captionOptionsFor, phraseTime } from '../captions.ts';
import { cjkFontsFor, withCjkFamilies } from '../composition/fonts.ts';
import { orientationOf, timingPreset, type VideoSpec } from '../spec.ts';
import { findPhrase, parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene, Storyboard, Visual } from '../storyboard/schema.ts';
import { heroScene } from '../templates.ts';
import { SPEECH_RATE, speechUnits } from '../text.ts';
import { buildCues } from './cues.ts';
import {
  type CaptionCue,
  type Expression,
  HERO_PHASE,
  type ImageAsset,
  type SceneTransition,
  type Timeline,
  type TimelineLabels,
  type TimelineScene,
  type TimelineVisual,
} from './types.ts';
```

After `export const TRANSITION = motion.transition;`, add:

```ts
/** How a scene enters: its own transition, else zoom-through into the hero, else a fade. */
export function sceneTransition(scene: Pick<Scene, 'transition' | 'hero'>): SceneTransition {
  const kind = scene.transition ?? (scene.hero ? 'zoom-through' : 'fade');
  return { kind, seconds: motion.transitions[kind] };
}

/** A line's caption window: its speech, at least 0.9 s long so a short line's cue can be read. */
function captionWindow(text: string, timing: SceneTiming) {
  return {
    text,
    start: timing.speechStart,
    end: Math.max(timing.speechEnd, timing.speechStart + 0.9),
  };
}

/**
 * The moments a scene's visual pins to, in seconds since the scene started: each `sync` phrase
 * placed in the line's caption window with the captions' own split, and the hero's `hero` (its
 * `sync.hero` phrase, else the start of its line). `text` is the line without markup.
 */
export function scenePhases(
  scene: Pick<Scene, 'sync' | 'hero'>,
  text: string,
  timing: SceneTiming,
  options: CaptionOptions,
): Record<string, number> | undefined {
  const phases: Record<string, number> = {};
  for (const [name, phrase] of Object.entries(scene.sync ?? {})) {
    const span = findPhrase(text, phrase);
    // Redaction can rewrite a line after it was validated; a phrase it hid pins nothing.
    if (span.count !== 1) continue;
    const time = phraseTime(captionWindow(text, timing), span, options);
    if (time) phases[name] = round(time.start - timing.start);
  }
  if (scene.hero && phases[HERO_PHASE] === undefined)
    phases[HERO_PHASE] = round(timing.speechStart - timing.start);
  return Object.keys(phases).length ? phases : undefined;
}
```

In `buildTimeline`, replace the `const scenes: TimelineScene[] = input.scenes.map(...)` block with:

```ts
  const captionOptions = { ...captionOptionsFor(orientation), language };
  const scenes: TimelineScene[] = input.scenes.map((scene, i) => {
    const timing = layout.scenes[i]!;
    const visual = toTimelineVisual(scene.visual, input.image);
    // The markup only marks the caption's emphasis: speech, captions, and reports get the text.
    const text = parseEmphasis(scene.narration).text;
    const phases = scenePhases(scene, text, timing, captionOptions);
    return {
      id: timing.id,
      beat: scene.beat,
      eyebrow: scene.eyebrow ?? scene.beat,
      heading: scene.heading,
      start: timing.start,
      end: timing.end,
      visual,
      expression: (scene.expression ?? 'explaining') as Expression,
      narrator: spec.mascot && !NO_NARRATOR.has(visual.kind),
      speech: text.trim()
        ? { start: timing.speechStart, end: timing.speechEnd, text }
        : undefined,
      ...(i > 0 ? { transition: sceneTransition(scene) } : {}),
      ...(phases ? { phases } : {}),
      ...(scene.hero ? { hero: true } : {}),
      ...(scene.camera === 'static' ? { camera: 'static' as const } : {}),
    };
  });
```

In the outro block, add the outro's transition to the pushed scene (after `narrator: false,`):

```ts
      transition: { kind: 'fade', seconds: TRANSITION },
```

In the captions block, pass `captionOptions` instead of `{ ...captionOptionsFor(orientation), language }`; the windows stay as they are (`end: Math.max(s.speech!.end, s.speech!.start + 0.9)`, the same window `captionWindow` gives the phases):

```ts
  const captions: CaptionCue[] = spec.captions
    ? buildCaptions(
        scenes
          .filter((s) => s.speech)
          .map((s) => ({
            text: s.speech!.text,
            start: s.speech!.start,
            end: Math.max(s.speech!.end, s.speech!.start + 0.9),
          })),
        captionOptions,
      )
    : [];
```

In `toTimelineVisual`, add a `title` case before `default`:

```ts
    case 'title': {
      const { background, ...rest } = visual;
      return background
        ? { ...rest, background: { ...image(background.path), label: background.label } }
        : rest;
    }
```

- [ ] **Step 6: Add `storyboardImages` to `packages/video/src/pipeline.ts` and use it**

Add the import `type Scene` to the existing `./storyboard/schema.ts` import, and this function above `produceVideo`:

```ts
/** Every run-relative image a storyboard shows, in scene order (a title's background too). */
export function storyboardImages(storyboard: {
  scenes: ReadonlyArray<Pick<Scene, 'visual'>>;
}): string[] {
  return storyboard.scenes.flatMap(({ visual: v }) =>
    v.kind === 'screenshot'
      ? [v.image.path]
      : v.kind === 'before-after'
        ? [v.before.path, v.after.path]
        : v.kind === 'interaction'
          ? v.steps.map((s) => s.image.path)
          : v.kind === 'title' && v.background
            ? [v.background.path]
            : [],
  );
}
```

In `produceVideo`, replace the whole image loop (from `const missing: string[] = [];` through the closing brace of `for (const scene of storyboard.scenes)`) with:

```ts
  const missing: string[] = [];
  const imagePaths = new Set<string>();
  for (const p of storyboardImages(storyboard)) {
    let full: string;
    try {
      full = run.path(p);
    } catch {
      throw new UsageError(
        `storyboard.json references an image outside the run directory: ${p}`,
        'Image paths are relative to the run directory, e.g. demo/screenshots/home-desktop-after.png.',
      );
    }
    imagePaths.add(p);
    if (!(await exists(full))) missing.push(p);
  }
```

The `if (missing.length) throw …` that follows stays as it is.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/timeline-grammar.test.ts packages/video/test packages/brand/test
cd "$WT" && npm run typecheck && node scripts/generate-assets.ts --check
cd "$WT" && npx biome check --write packages/brand/src/tokens.ts packages/video/src/timeline packages/video/src/pipeline.ts packages/video/test/timeline-grammar.test.ts
```

Expected: all PASS; the asset check reports no stale files (motion tokens are not drawn into SVGs); typecheck and Biome clean.

- [ ] **Step 8: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/brand/src/tokens.ts packages/video/src/timeline packages/video/src/pipeline.ts packages/video/test/timeline-grammar.test.ts && git commit -F - <<'EOF'
Resolve transitions, phases, and the hero in the timeline

Each timeline scene now records how it enters (kind and length, from
new brand motion tokens), the moments its visual pins to in scene-local
seconds, the hero flag and phase, a static camera, and a title's
background capture. Speech and captions get the line without [[…]].

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
