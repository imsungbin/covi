### Task 6: Runtime transitions, the camera, and the hero accent

Two new pure runtime modules carry the motion math so it can be tested in Node: `transitions.ts` (how a scene looks entering or leaving, per kind) and `camera.ts` (drift, linger, the hero punch, the flash and ring). The stage applies them: each scene gets a media layer (the camera scales it about the media region's center; the header is outside it), scene roots take the transition looks, and a hero accent layer, clipped to the media region, sits above the scenes and under the narrator and captions. Cards that draw a large fox push their panel instead (Decision 8).

**Files:**
- Create: `packages/video/src/runtime/transitions.ts`
- Create: `packages/video/src/runtime/camera.ts`
- Modify: `packages/video/src/runtime/anim.ts` (`easeInCubic`, `easeInOutSine`)
- Modify: `packages/video/src/runtime/components/types.ts` (`Component.camera`)
- Modify: `packages/video/src/runtime/components/cards.ts` (`camera` on the title card and the summary)
- Modify: `packages/video/src/runtime/stage.ts`
- Modify: `packages/video/src/runtime/styles.ts`
- Test: `packages/video/test/motion.test.ts` (create)

**Interfaces:**
- Consumes: `TimelineScene.transition`/`phases`/`hero`/`camera` (Task 3), `settledAt` (Task 4), `motion.transitions`/`drift`/`linger`/`punch`/`flash` (Task 3), `HERO_PHASE` (Task 1).
- Produces:
  - `transitions.ts`: `interface Look { opacity: number; x: number; y: number; scale: number; clipRight: number }`; `const REST: Look`; `transitionOf(scene: Pick<TimelineScene, 'transition'>, timeline: Pick<Timeline, 'transition'>): SceneTransition`; `entering(kind: TransitionKind, k: number, unit: number, width: number): Look`; `leaving(kind, k, unit, width): Look`; `sceneStyle(enter: Look, leave: Look): { opacity: string; transform: string; clipPath: string }`.
  - `camera.ts`: `interface CameraPlan { duration: number; drift: boolean; settled: number; speechEnd?: number; still: boolean; hero?: number }`; `cameraPlan(scene: TimelineScene): CameraPlan | undefined`; `cameraPush(t: number, plan: CameraPlan): number`; `heroPunch(dt: number): number`; `heroAccent(dt: number): { flash: number; ring: number; ringOpacity: number }`.
  - `Component.camera?(push: number): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/video/test/motion.test.ts`:

```ts
import { motion } from '@covi/brand';
import { describe, expect, it } from 'vitest';
import { easeOutCubic } from '../src/runtime/anim.ts';
import { cameraPlan, cameraPush, heroAccent, heroPunch } from '../src/runtime/camera.ts';
import {
  entering,
  leaving,
  REST,
  sceneStyle,
  transitionOf,
} from '../src/runtime/transitions.ts';
import type { TimelineScene } from '../src/timeline/types.ts';

const W = 1920;
const U = 1;

describe('scene transitions', () => {
  it('fade the way scenes always have', () => {
    expect(entering('fade', 0, U, W)).toEqual({ ...REST, opacity: 0, y: 26 });
    const half = entering('fade', 0.5, U, W);
    expect(half.opacity).toBeCloseTo(0.875, 9);
    expect(half.y).toBeCloseTo(0.125 * 26, 9);
    expect(entering('fade', 1, U, W)).toEqual(REST);
    expect(leaving('fade', 1, U, W)).toEqual({ ...REST, opacity: 0, y: -14 });
  });

  it('cut at once', () => {
    expect(entering('cut', 0, U, W)).toEqual(REST);
    expect(leaving('cut', 0.99, U, W)).toEqual(REST);
    expect(leaving('cut', 1, U, W).opacity).toBe(0);
  });

  it('push the old scene out to the left as the new one slides in beside it', () => {
    for (const k of [0, 0.25, 0.5, 0.9, 1]) {
      expect(entering('push', k, U, W).x - leaving('push', k, U, W).x).toBeCloseTo(W, 6);
      expect(entering('push', k, U, W).opacity).toBe(1);
      expect(leaving('push', k, U, W).opacity).toBe(1);
    }
    expect(entering('push', 0, U, W).x).toBe(W);
    expect(leaving('push', 1, U, W).x).toBe(-W);
  });

  it('wipe the new scene in from the left over the old one', () => {
    expect(entering('wipe', 0, U, W).clipRight).toBe(1);
    expect(entering('wipe', 0.25, U, W).clipRight).toBeCloseTo(0.9375, 9);
    expect(entering('wipe', 1, U, W)).toEqual(REST);
    expect(leaving('wipe', 0.5, U, W)).toEqual(REST);
    expect(leaving('wipe', 1, U, W).opacity).toBe(0);
  });

  it('zoom through: the old scene grows away as the new one settles in', () => {
    expect(entering('zoom-through', 0, U, W)).toMatchObject({ opacity: 0, scale: 0.92 });
    expect(entering('zoom-through', 1, U, W)).toEqual(REST);
    expect(leaving('zoom-through', 1, U, W)).toMatchObject({ opacity: 0, scale: 1.12 });
  });

  it('compose an entrance and an exit into one style', () => {
    expect(sceneStyle(REST, REST)).toEqual({
      opacity: '1.0000',
      transform: 'translate(0.00px, 0.00px)',
      clipPath: '',
    });
    expect(sceneStyle(entering('wipe', 0.25, U, W), REST).clipPath).toBe('inset(0 93.750% 0 0)');
    expect(
      sceneStyle(entering('zoom-through', 0.5, U, W), leaving('fade', 0.5, U, W)).transform,
    ).toMatch(/ scale\(0\.9900\)$/);
  });

  it('fall back to the shared fade for timelines written before transitions had kinds', () => {
    expect(transitionOf({}, { transition: 0.45 })).toEqual({ kind: 'fade', seconds: 0.45 });
    expect(
      transitionOf({ transition: { kind: 'cut', seconds: 0 } }, { transition: 0.45 }),
    ).toEqual({ kind: 'cut', seconds: 0 });
  });
});

const image = { src: 'a.png', width: 100, height: 100 };
const scene = (visual: TimelineScene['visual'], extra: Partial<TimelineScene> = {}) =>
  ({
    id: 's',
    beat: 's',
    eyebrow: 's',
    start: 10,
    end: 14,
    visual,
    expression: 'explaining',
    narrator: true,
    speech: { start: 10.3, end: 13.5, text: 'x' },
    ...extra,
  }) as TimelineScene;
const shot = { kind: 'screenshot', image, device: 'desktop' } as const;
const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;

describe('the camera', () => {
  it('drifts across a capture, at most 2%, eased in and out', () => {
    const plan = cameraPlan(scene(shot))!;
    expect(plan).toMatchObject({ duration: 4, drift: true, still: false });
    expect(cameraPush(0, plan)).toBe(0);
    expect(cameraPush(2, plan)).toBeCloseTo(motion.drift / 2, 9);
    expect(cameraPush(4, plan)).toBeCloseTo(motion.drift, 9);
    for (let t = 0; t <= 4; t += 0.1) expect(cameraPush(t, plan)).toBeLessThanOrEqual(0.02 + 1e-12);
  });

  it('pushes in on a finished visual while its line continues', () => {
    const plan = cameraPlan(scene(callout))!;
    expect(plan).toMatchObject({ drift: false, settled: 0.6, speechEnd: 3.5 });
    expect(cameraPush(0.6, plan)).toBe(0);
    expect(cameraPush(2.3, plan)).toBeCloseTo(motion.linger / 2, 9);
    expect(cameraPush(4, plan)).toBeCloseTo(motion.linger, 9);
    // A visual still moving when its line ends has nothing to linger on.
    const finding = { title: 'x', certainty: 'risk', severity: 'low' } as const;
    const late = cameraPlan(
      scene(
        { kind: 'findings', findings: [finding, finding, finding] },
        { speech: { start: 10.2, end: 11, text: 'x' } },
      ),
    )!;
    expect(cameraPush(3.9, late)).toBe(0);
  });

  it('holds still when the storyboard says so, but the hero still punches', () => {
    expect(cameraPush(3, cameraPlan(scene(shot, { camera: 'static' }))!)).toBe(0);
    const hero = cameraPlan(scene(shot, { camera: 'static', hero: true, phases: { hero: 1 } }))!;
    expect(hero.hero).toBe(1);
    expect(cameraPush(1.1, hero)).toBeCloseTo(motion.punch, 9);
    expect(cameraPush(1.6, hero)).toBe(0);
  });

  it('leaves the outro alone, and lingers on cards and titles over a capture', () => {
    expect(cameraPlan(scene({ kind: 'outro' }))).toBeUndefined();
    const summary = { kind: 'summary', verdict: 'looks-good', headline: 'H', points: [] } as const;
    expect(cameraPlan(scene(summary))).toMatchObject({ drift: false });
    expect(
      cameraPlan(scene({ kind: 'title', title: 'T', meta: [], background: image })),
    ).toMatchObject({ drift: true });
    expect(cameraPlan(scene({ kind: 'title', title: 'T', meta: [] }))).toMatchObject({
      drift: false,
    });
  });
});

describe('the hero accent', () => {
  it('punches in fast and out slowly', () => {
    expect(heroPunch(-0.01)).toBe(0);
    expect(heroPunch(0)).toBe(0);
    expect(heroPunch(0.1)).toBe(1);
    expect(heroPunch(0.35)).toBeCloseTo(0.5, 9);
    expect(heroPunch(0.6)).toBe(0);
  });

  it('flashes for under 0.2 s and rings once', () => {
    expect(motion.flash.seconds).toBeLessThanOrEqual(0.2);
    expect(heroAccent(-0.01)).toEqual({ flash: 0, ring: 0, ringOpacity: 0 });
    expect(heroAccent(0.04).flash).toBeCloseTo(motion.flash.opacity, 9);
    expect(heroAccent(motion.flash.seconds).flash).toBe(0);
    expect(heroAccent(0.35).ring).toBeCloseTo(easeOutCubic(0.5), 9);
    expect(heroAccent(0.7)).toEqual({ flash: 0, ring: 0, ringOpacity: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/motion.test.ts
```

Expected: FAIL (`../src/runtime/camera.ts` and `../src/runtime/transitions.ts` do not exist).

- [ ] **Step 3: Add the easings to `packages/video/src/runtime/anim.ts`**

After `easeOutQuart`:

```ts
export const easeInCubic = (t: number) => t ** 3;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
```

- [ ] **Step 4: Create `packages/video/src/runtime/transitions.ts`**

```ts
import type { SceneTransition, Timeline, TimelineScene, TransitionKind } from '../timeline/types.ts';
import { easeInCubic, easeInOutCubic, easeOutCubic } from './anim.ts';

/*
 * How a scene looks while a transition brings it in or takes it away: pure functions of the
 * transition's progress, so any frame can be drawn on its own. The incoming scene is drawn over
 * the outgoing one (it comes later in the page).
 */

/** A scene's opacity, offset (px), scale, and how much of its right side is clipped (0–1). */
export interface Look {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  clipRight: number;
}

export const REST: Look = { opacity: 1, x: 0, y: 0, scale: 1, clipRight: 0 };

/** How a scene enters: as the timeline says, or as every scene did before kinds (a fade). */
export function transitionOf(
  scene: Pick<TimelineScene, 'transition'>,
  timeline: Pick<Timeline, 'transition'>,
): SceneTransition {
  return scene.transition ?? { kind: 'fade', seconds: timeline.transition };
}

/** The incoming scene, `k` (0–1) of the way through the transition that brings it in. */
export function entering(kind: TransitionKind, k: number, unit: number, width: number): Look {
  switch (kind) {
    case 'cut':
      return REST;
    case 'push': {
      const e = easeInOutCubic(k);
      return { ...REST, x: (1 - e) * width };
    }
    case 'wipe': {
      const e = easeInOutCubic(k);
      return { ...REST, clipRight: 1 - e };
    }
    case 'zoom-through': {
      const e = easeOutCubic(k);
      return { ...REST, opacity: e, scale: 0.92 + 0.08 * e };
    }
    default: {
      const e = easeOutCubic(k);
      return { ...REST, opacity: e, y: (1 - e) * 26 * unit };
    }
  }
}

/** The outgoing scene, `k` of the way through the next scene's transition. */
export function leaving(kind: TransitionKind, k: number, unit: number, width: number): Look {
  switch (kind) {
    case 'cut':
    case 'wipe':
      // The incoming scene covers it (a wipe uncovers the new one over it); then it is gone.
      return k >= 1 ? { ...REST, opacity: 0 } : REST;
    case 'push':
      return { ...REST, x: -easeInOutCubic(k) * width };
    case 'zoom-through': {
      const e = easeInCubic(k);
      return { ...REST, opacity: 1 - e, scale: 1 + 0.12 * e };
    }
    default: {
      const e = easeInOutCubic(k);
      return { ...REST, opacity: 1 - e, y: -e * 14 * unit };
    }
  }
}

/** An entrance and an exit at once, as the scene root's CSS. */
export function sceneStyle(
  enter: Look,
  leave: Look,
): { opacity: string; transform: string; clipPath: string } {
  const scale = enter.scale * leave.scale;
  return {
    opacity: Math.min(enter.opacity, leave.opacity).toFixed(4),
    transform: `translate(${(enter.x + leave.x).toFixed(2)}px, ${(enter.y + leave.y).toFixed(2)}px)${
      scale === 1 ? '' : ` scale(${scale.toFixed(4)})`
    }`,
    clipPath: enter.clipRight > 0 ? `inset(0 ${(enter.clipRight * 100).toFixed(3)}% 0 0)` : '',
  };
}
```

- [ ] **Step 5: Create `packages/video/src/runtime/camera.ts`**

```ts
import { motion } from '@covi/brand';
import { settledAt } from '../timeline/cues.ts';
import { HERO_PHASE, type TimelineScene } from '../timeline/types.ts';
import { easeInOutCubic, easeInOutSine, easeOutCubic, seg } from './anim.ts';

/*
 * The camera: a scene never holds still while its line is spoken. A capture drifts through its
 * whole scene; any other visual pushes in once its own choreography is done; the hero punches in
 * at its phase. Pure functions of the scene clock.
 */

export interface CameraPlan {
  duration: number;
  /** A capture: the camera drifts through the whole scene. */
  drift: boolean;
  /** When the visual's choreography is done (seconds since the scene started). */
  settled: number;
  /** When its line ends; a visual that settles before it pushes in. */
  speechEnd?: number;
  /** `camera: static`: neither drift nor push-in. */
  still: boolean;
  /** The hero phase, where the camera punches in. */
  hero?: number;
}

/** Visuals that are captures of the running software. */
const CAPTURES = new Set<TimelineScene['visual']['kind']>(['screenshot', 'before-after', 'interaction']);

/** How the camera moves in a scene; the outro moves on its own. */
export function cameraPlan(scene: TimelineScene): CameraPlan | undefined {
  const v = scene.visual;
  if (v.kind === 'outro') return undefined;
  const duration = scene.end - scene.start;
  const hero = scene.hero ? scene.phases?.[HERO_PHASE] : undefined;
  return {
    duration,
    drift: CAPTURES.has(v.kind) || (v.kind === 'title' && v.background !== undefined),
    settled: settledAt(v, duration, scene.phases),
    ...(scene.speech ? { speechEnd: scene.speech.end - scene.start } : {}),
    still: scene.camera === 'static',
    ...(hero === undefined ? {} : { hero }),
  };
}

/** How far the camera has pushed in at `t` (0 = not at all; 0.02 = 2%). */
export function cameraPush(t: number, plan: CameraPlan): number {
  let push = 0;
  if (!plan.still) {
    if (plan.drift) push += motion.drift * easeInOutSine(seg(t, 0, plan.duration));
    else if (plan.speechEnd !== undefined && plan.settled < Math.min(plan.speechEnd, plan.duration))
      push += motion.linger * easeInOutSine(seg(t, plan.settled, plan.duration));
  }
  if (plan.hero !== undefined) push += motion.punch * heroPunch(t - plan.hero);
  return push;
}

const PUNCH_IN = 0.1;
const PUNCH_OUT = 0.6;
const RING = 0.7;

/** The hero's punch, 0–1: in fast, out slowly. `dt` is seconds since the hero phase. */
export function heroPunch(dt: number): number {
  if (dt <= 0 || dt >= PUNCH_OUT) return 0;
  return dt < PUNCH_IN
    ? easeOutCubic(dt / PUNCH_IN)
    : 1 - easeInOutCubic((dt - PUNCH_IN) / (PUNCH_OUT - PUNCH_IN));
}

/** The hero's flash (opacity) and its one ring (progress 0–1 and opacity), `dt` after the phase. */
export function heroAccent(dt: number): { flash: number; ring: number; ringOpacity: number } {
  const { seconds, opacity } = motion.flash;
  const peak = 0.04;
  const flash =
    dt < 0 || dt >= seconds
      ? 0
      : dt < peak
        ? (opacity * dt) / peak
        : opacity * (1 - (dt - peak) / (seconds - peak));
  if (dt < 0 || dt >= RING) return { flash, ring: 0, ringOpacity: 0 };
  const ring = easeOutCubic(dt / RING);
  return { flash, ring, ringOpacity: 0.9 * (1 - ring) };
}
```

- [ ] **Step 6: Let cards with a large fox apply the push themselves**

In `packages/video/src/runtime/components/types.ts`, add to `Component` (after `entrance`):

```ts
  /**
   * Applies the camera's push-in itself (cards whose large fox the outro may take over, so the
   * fox must stay put); without it the stage scales the scene's media layer.
   */
  camera?(push: number): void;
```

In `packages/video/src/runtime/components/cards.ts`, add to the object `title` returns (after `report`):

```ts
    // The title text pushes in; the fox stays where the outro may pick it up.
    camera(push) {
      if (push > 1e-6)
        heading.style.transform = `${heading.style.transform} scale(${(1 + push).toFixed(5)})`;
    },
```

and to the object `summary` returns (after `report`):

```ts
    // The panel pushes in; the fox stays where the outro takes it over.
    camera(push) {
      if (push > 1e-6)
        panel.style.transform = `${panel.style.transform} scale(${(1 + push).toFixed(5)})`;
    },
```

(`rise` rewrites both transforms on every `update`, which the stage calls first, so the scale never accumulates.)

- [ ] **Step 7: Apply transitions, the camera, and the accent in `packages/video/src/runtime/stage.ts`**

Imports: add `lerp` to the `./anim.ts` import; add `place` is already imported from `./dom.ts`; add

```ts
import { HERO_PHASE } from '../timeline/types.ts';
import { type CameraPlan, cameraPlan, cameraPush, heroAccent } from './camera.ts';
import { type SceneClock } from './components/types.ts';
import { entering, leaving, REST, sceneStyle, transitionOf } from './transitions.ts';
```

(merge `SceneClock` into the existing `./components/types.ts` import, and `HERO_PHASE` into the existing `../timeline/types.ts` import, which becomes a mixed import with `type` on the types).

Extend `MountedScene`:

```ts
  /** The camera layer: what the scene shows, pushed in by the camera. The header is not in it. */
  media: HTMLDivElement;
  /** How the camera moves here; undefined: it does not (the outro). */
  camera?: CameraPlan;
  /** The clock of the frame drawn last, for the hero accent's ring. */
  clock?: SceneClock;
```

Add a field to `Stage`: `private accent?: { flash: HTMLDivElement; ring: HTMLDivElement; hero: MountedScene };`

In `mount`, at the top of the per-scene loop, after `root.dataset.scene = scene.id;`:

```ts
      const media = el('div', 'layer', root);
      const center = { x: r.media.x + r.media.width / 2, y: r.media.y + r.media.height / 2 };
      media.style.transformOrigin = `${center.x.toFixed(2)}px ${center.y.toFixed(2)}px`;
```

In the `ctx` literal, change `root,` to `root: media,` (the header is still appended to `root` below), and push the scene with its layer and camera:

```ts
      this.scenes.push({
        scene,
        index,
        root,
        media,
        header,
        component,
        headerText,
        camera: cameraPlan(scene),
      });
```

After the loop and before `this.narrator = el('div', 'narrator', this.root);`, add:

```ts
    // The hero's flash and ring: over the scenes, under the narrator and the captions, and only
    // inside the media region, so they never cover the header or the captions.
    const hero = this.scenes.find(
      (m) => m.scene.hero && m.scene.phases?.[HERO_PHASE] !== undefined,
    );
    if (hero) {
      const layer = el('div', 'layer hero-accent', this.root);
      const m = r.media;
      layer.style.clipPath = `inset(${m.y}px ${t.width - m.x - m.width}px ${t.height - m.y - m.height}px ${m.x}px)`;
      const flash = el('div', 'flash', layer);
      place(flash, m);
      this.accent = { flash, ring: el('div', 'ring', layer), hero };
    }
```

In `seek`, replace the body of the per-scene callback from `m.root.style.display = 'block';` through `m.component.update({...});` with:

```ts
      m.root.style.display = 'block';
      const unit = this.regions.unit;
      const enterWith = transitionOf(scene, t);
      const next = this.scenes[i + 1]?.scene;
      const leaveWith = next ? transitionOf(next, t) : undefined;
      const enter =
        first || m.component.entrance === false
          ? REST
          : entering(
              enterWith.kind,
              seg(time, scene.start, scene.start + enterWith.seconds),
              unit,
              t.width,
            );
      const leave =
        last || !leaveWith
          ? REST
          : leaving(leaveWith.kind, seg(time, scene.end - leaveWith.seconds, scene.end), unit, t.width);
      const look = sceneStyle(enter, leave);
      m.root.style.opacity = look.opacity;
      m.root.style.transform = look.transform;
      m.root.style.clipPath = look.clipPath;
      const local = time - scene.start;
      const duration = scene.end - scene.start;
      const clock: SceneClock = {
        t: local,
        duration,
        p: clamp(local / duration),
        frame,
        fox: { mouth, blink },
      };
      m.clock = clock;
      m.component.update(clock);
      const push = m.camera ? cameraPush(local, m.camera) : 0;
      if (m.component.camera) m.component.camera(push);
      else m.media.style.transform = push > 1e-6 ? `scale(${(1 + push).toFixed(5)})` : '';
```

(The `foxTaken` and header-entrance code after it stays; it already uses `local`.)

After the `this.scenes.forEach(...)` call and before the narrator block, add:

```ts
    if (this.accent) {
      const { flash, ring, hero } = this.accent;
      const accent = heroAccent(time - (hero.scene.start + hero.scene.phases![HERO_PHASE]!));
      flash.style.opacity = accent.flash.toFixed(3);
      if (accent.ringOpacity > 0.001 && hero.root.style.display === 'block' && hero.clock) {
        // The ring opens around what the hero highlights, else the middle of the media region.
        const media = this.regions.media;
        const box = hero.component.target?.(hero.clock) ?? media;
        const size = lerp(0.12, 0.7, accent.ring) * Math.min(media.width, media.height);
        place(ring, {
          x: box.x + box.width / 2 - size / 2,
          y: box.y + box.height / 2 - size / 2,
          width: size,
          height: size,
        });
        ring.style.opacity = accent.ringOpacity.toFixed(3);
      } else ring.style.opacity = '0';
    }
```

Replace the two remaining uses of `t.transition`:

```ts
          easeInOutCubic(
            seg(time, current.scene.start, current.scene.start + transitionOf(current.scene, t).seconds),
          ),
```

and, for the progress bar:

```ts
      ? (
          1 -
          easeInOutCubic(
            seg(time, outroScene.start, outroScene.start + transitionOf(outroScene, t).seconds),
          )
        ).toFixed(3)
```

- [ ] **Step 8: Style the accent in `packages/video/src/runtime/styles.ts`**

After the `/* Frames */` block's last rule (`.ripple …`), add:

```ts
/* Hero accent */
.hero-accent { pointer-events: none; }
.hero-accent .flash { position: absolute; background: #FFFFFF; opacity: 0; }
.hero-accent .ring { position: absolute; border-radius: 50%; border: ${u(6)} solid ${c.primary}; opacity: 0; }
```

(It goes inside the template string, as plain CSS lines.)

- [ ] **Step 9: Run the tests, the runtime typecheck, and the render tests**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/motion.test.ts packages/video/test
cd "$WT" && npm run typecheck
cd "$WT" && npx vitest run tests/render/render.test.ts
cd "$WT" && npx biome check --write packages/video/src/runtime packages/video/test/motion.test.ts
```

Expected: all PASS. The render tests include the determinism test (the same timeline renders the same frame bytes, now with drift and linger) and the layout QC (`captions-clear-of-content` must still pass with the camera's push).

- [ ] **Step 10: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src/runtime packages/video/test/motion.test.ts && git commit -F - <<'EOF'
Add scene transitions, a moving camera, and the hero accent

Scenes enter with fade, cut, push, wipe, or zoom-through. Captures drift
slowly, any other visual pushes in once it has settled while its line
continues, and the hero punches in with a short flash and one ring at its
phase. The motion math lives in pure runtime modules with tests.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
