import { blendPoses, type FoxOptions, foxPose, foxSvg, type Pose } from '@covi/brand';
import {
  type DirectionElement,
  HERO_PHASE,
  type LayoutReport,
  type Point,
  type Rect,
  type Timeline,
  type TimelineScene,
} from '../timeline/types.ts';
import {
  clamp,
  easeInOutCubic,
  easeInOutSine,
  easeOutCubic,
  lerp,
  seeded,
  seg,
  spring,
} from './anim.ts';
import { type CameraPlan, cameraPlan, cameraPush, heroAccent } from './camera.ts';
import {
  beatView,
  between,
  type CameraKind,
  type CameraStep,
  clampView,
  clipRect,
  drawnRect,
  gridStyle,
  insetOf,
  isCameraMove,
  layerTransform,
  lerpRect,
  PULL_MARGIN,
  pullBack,
  restView,
  toWorld,
  type View,
  viewAt,
  withPush,
} from './canvas.ts';
import { summary, title, titleOver } from './components/cards.ts';
import {
  api,
  beforeAfter,
  callout,
  changeMap,
  code,
  diagram,
  findings,
  interaction,
  screenshot,
  terminal,
} from './components/media.ts';
import { outro } from './components/outro.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  type LayoutItem,
  overflows,
  rectOf,
  type SceneClock,
} from './components/types.ts';
import { mountShot, type ShotComponent } from './direction/elements.ts';
import { el, fitText, place } from './dom.ts';
import { computeRegions, gridSpacing, type Regions } from './layout.ts';
import {
  aimAt,
  clearAim,
  fitTail,
  type NarratorPlacement,
  narratorParts,
  toFox,
  union,
} from './narrator.ts';
import { stylesheet } from './styles.ts';
import { entering, leaving, REST, sceneStyle, transitionOf } from './transitions.ts';

interface MountedScene {
  scene: TimelineScene;
  index: number;
  root: HTMLDivElement;
  /** The camera layer: what the scene shows, pushed in by the camera. The header is not in it. */
  media: HTMLDivElement;
  header?: HTMLDivElement;
  component: Component;
  /** How the camera moves here; undefined: it does not (the outro). */
  camera?: CameraPlan;
  /** The clock of the frame drawn last, for the hero accent's ring. */
  clock?: SceneClock;
  /** The header's text as laid out (stage pixels): the narrator's tail stays off it. */
  headerText: Rect[];
  /** The header's heading as laid out, and whether it is clipped even at its smallest size. */
  heading?: LayoutItem;
  /** When the next scene takes over this scene's large fox (it is hidden from then on). */
  foxTaken?: number;
  /** On the canvas: the viewport that clips the media layer while the camera travels or zooms. */
  viewport?: HTMLDivElement;
  /** The region the scene owns: the media region, or the full frame for a card without a header. */
  region: Rect;
  /** The component that draws the storyboard visual; absent when a shot replaces it. */
  visual?: Component;
  /** The shot drawing its elements, when it lays out more than the storyboard visual. */
  shot?: ShotComponent;
  /** The camera's beats inside the stop, each toward its target. */
  steps: CameraStep[];
  /** How much of the narrator the scene shows in the frame drawn last (0–1). */
  presence: number;
}

/** The camera travelling from one stop to the next, in progress. */
interface Travel {
  from: MountedScene;
  to: MountedScene;
  kind: CameraKind;
  /** How far through the move the camera is, 0–1. */
  k: number;
  /** When the move ends, in seconds from the start of the video. */
  end: number;
}

/**
 * Boxes around each line of an element's visible text, as laid out (without transforms). Text
 * that overflows is clipped to the element's box, as it is drawn.
 */
function textBoxes(node: HTMLElement, fromLeftEdge = false): Rect[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  const box = node.getBoundingClientRect();
  return [...range.getClientRects()]
    .map((r) => {
      // The eyebrow's dot sits before its text, so its box starts at the element's edge.
      const left = fromLeftEdge ? box.left : Math.max(box.left, r.left);
      const right = Math.min(box.right, r.right);
      const top = Math.max(box.top, r.top);
      const bottom = Math.min(box.bottom, r.bottom);
      return { x: left, y: top, width: right - left, height: bottom - top };
    })
    .filter((r) => r.width > 0 && r.height > 0);
}

function mountComponent(scene: TimelineScene, ctx: ComponentContext): Component {
  const v = scene.visual;
  switch (v.kind) {
    case 'title':
      return v.background
        ? titleOver({ ...v, background: v.background }, ctx)
        : title(v, ctx, scene.expression);
    case 'summary':
      return summary(v, ctx);
    case 'screenshot':
      return screenshot(v, ctx);
    case 'before-after':
      return beforeAfter(v, ctx);
    case 'interaction':
      return interaction(v, ctx);
    case 'code':
      return code(v, ctx);
    case 'terminal':
      return terminal(v, ctx);
    case 'api':
      return api(v, ctx);
    case 'findings':
      return findings(v, ctx);
    case 'change-map':
      return changeMap(v, ctx);
    case 'callout':
      return callout(v, ctx);
    case 'diagram':
      return diagram(v, ctx);
    case 'outro':
      return outro(v, ctx);
  }
}

/** Scenes whose content the narrator points at with its tail. */
const POINTS_AT = new Set<TimelineScene['visual']['kind']>([
  'code',
  'screenshot',
  'before-after',
  'interaction',
  'api',
  'terminal',
  'findings',
  'diagram',
  'change-map',
]);

/** Where the narrator looks when nothing in the scene is highlighted: toward the content. */
function gazeFor(scene: TimelineScene, vertical: boolean): { x: number; y: number } {
  const v = scene.visual;
  if (v.kind === 'summary' || (v.kind === 'title' && !v.background)) return { x: 0, y: 0 };
  return vertical ? { x: -0.55, y: 0.75 } : { x: -0.7, y: 0.45 };
}

/** The fox's eyes in view-box units; gaze is measured from here. */
const EYES = { x: 70, y: 52 };
/** The share of a camera move over which the viewport closes to its band, and opens again. */
const CLIP_RAMP = 0.2;
/** How far a beat magnifies a stop by the time the viewport has closed (a push never closes it). */
const CLIP_ZOOM = 0.1;
/** Room kept between the tail and what it must not cover, in view-box units. */
const TAIL_MARGIN = 4;

export class Stage {
  readonly timeline: Timeline;
  readonly regions: Regions;
  readonly ready: Promise<void>;
  private readonly root: HTMLElement;
  private scenes: MountedScene[] = [];
  private narrator!: HTMLDivElement;
  private captionLayer!: HTMLDivElement;
  private captionBox!: HTMLDivElement;
  private captionKey = '';
  private emphasis: Array<{ node: HTMLElement; start: number; end: number }> = [];
  private progressBar!: HTMLDivElement;
  private progress: HTMLDivElement[] = [];
  private blinkTimes: number[] = [];
  private imagesOk = true;
  /** Families of declared font faces that failed to load. */
  private fontsFailed: string[] = [];
  private lastFrame = 0;
  /** The narrator's pose and placement in the last frame drawn, for the layout report. */
  private drawn?: { fox: FoxOptions; placement: NarratorPlacement };
  /** The hero's flash and ring, when a scene is the hero. */
  private accent?: { flash: HTMLDivElement; ring: HTMLDivElement; hero: MountedScene };
  /** The canvas's dot grid, which moves with the camera; absent without a canvas. */
  private grid?: HTMLDivElement;
  /** Where a view's focus is drawn: the media region's center, as the push-in always scaled from. */
  private readonly pivot: Point;

  constructor(root: HTMLElement, timeline: Timeline) {
    this.root = root;
    this.timeline = timeline;
    this.regions = computeRegions(timeline);
    const m = this.regions.media;
    this.pivot = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
    const style = document.createElement('style');
    style.textContent = stylesheet(timeline, this.regions);
    document.head.appendChild(style);
    this.ready = this.mount();
  }

  private async mount(): Promise<void> {
    // Load every declared face up front: CJK slices load lazily by unicode-range otherwise, and
    // text measured before its slice arrives would lay out with fallback metrics.
    const faces: FontFace[] = [];
    document.fonts.forEach((face) => {
      faces.push(face);
    });
    await Promise.all(faces.map((face) => face.load().catch(() => undefined)));
    await document.fonts.ready;
    // Text whose face did not load falls back to the machine's fonts: other shapes and metrics,
    // or boxes on a runner without CJK fonts. QC fails the render instead of shipping that.
    const failed = faces.filter((face) => face.status === 'error');
    this.fontsFailed = [...new Set(failed.map((face) => face.family.replace(/^["']|["']$/g, '')))];
    const t = this.timeline;
    const r = this.regions;
    const u = (n: number) => n * r.unit;

    // The canvas's dots, under everything: one grid over the whole frame that travels with the
    // camera (see `gridStyle`), lined up with the stage's own dots at rest.
    if (t.scenes.some((s) => s.stop)) this.grid = el('div', 'layer canvas-grid', this.root);

    // The progress bar follows the story's scenes; the outro is a sign-off, not part of it.
    const bar = el('div', 'progress', this.root);
    this.progressBar = bar;
    place(bar, r.progress);
    const total = t.duration;
    for (const s of t.scenes) {
      if (s.visual.kind === 'outro') continue;
      const segEl = el('div', 'seg', bar);
      segEl.style.flexGrow = String(Math.max(0.2, (s.end - s.start) / total));
      this.progress.push(el('div', 'fill', segEl));
    }

    for (const [index, scene] of t.scenes.entries()) {
      const root = el('div', 'scene', this.root);
      root.dataset.scene = scene.id;
      // On the canvas the media layer sits in a viewport, which clips it while the camera travels
      // or magnifies; the camera moves the layer (from its origin), never the viewport.
      const viewport = scene.stop ? el('div', 'layer stop-view', root) : undefined;
      const media = el('div', 'layer', viewport ?? root);
      const center = { x: r.media.x + r.media.width / 2, y: r.media.y + r.media.height / 2 };
      media.style.transformOrigin = scene.stop
        ? '0 0'
        : `${center.x.toFixed(2)}px ${center.y.toFixed(2)}px`;
      // The outro takes over the large fox of the card before it (the summary's, usually).
      const before = this.scenes.at(-1);
      const handoff =
        scene.visual.kind === 'outro' && before?.component.fox
          ? { fox: before.component.fox, sceneStart: before.scene.start }
          : undefined;
      if (handoff && before) before.foxTaken = scene.start;
      const ctx: ComponentContext = {
        timeline: t,
        regions: r,
        u,
        root: media,
        phases: scene.phases ?? {},
        ...(handoff ? { previousFox: handoff } : {}),
      };
      // A shot that lays out more than the storyboard visual draws its elements; one that shows the
      // visual alone draws it exactly as without direction.
      const shot =
        scene.direction && !scene.direction.whole
          ? mountShot(scene, ctx, (sub) => mountComponent(scene, sub))
          : undefined;
      const component = shot ?? mountComponent(scene, ctx);
      let header: HTMLDivElement | undefined;
      const headerText: Rect[] = [];
      let heading: LayoutItem | undefined;
      if (component.header !== false) {
        header = el('div', 'scene-header', root);
        place(header, r.header);
        const eyebrow = el('div', 'eyebrow', header, scene.eyebrow);
        if (scene.heading) {
          const h = el('div', 'heading', header, scene.heading);
          fitText(h, {
            max: u(t.orientation === 'vertical' ? 50 : 42),
            min: u(28),
            maxHeight: r.header.height - u(50),
            maxWidth: r.header.width,
          });
          const lines = textBoxes(h);
          headerText.push(...lines);
          // A heading that still does not fit is clipped at two lines: QC's text-fit check sees it.
          if (lines.length)
            heading = {
              role: 'text',
              rect: union(lines),
              overflow: overflows(h),
              font: drawnFont(h),
              text: 'body',
            };
        }
        headerText.push(...textBoxes(eyebrow, true));
      }
      this.scenes.push({
        scene,
        index,
        root,
        media,
        header,
        component,
        headerText,
        ...(heading ? { heading } : {}),
        camera: cameraPlan(scene),
        ...(viewport ? { viewport } : {}),
        region: component.header === false ? r.full : r.media,
        ...(shot
          ? { shot, ...(shot.visual ? { visual: shot.visual } : {}) }
          : { visual: component }),
        steps: [],
        presence: 0,
      });
    }

    // Camera beats aim at what their target shows when they end, measured before any frame is
    // drawn: every scene is still displayed and untransformed, so rects are the stop's own pixels.
    for (const m of this.scenes) m.steps = this.cameraSteps(m);

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

    this.narrator = el('div', 'narrator', this.root);
    place(this.narrator, {
      x: r.narrator.x,
      y: r.narrator.y,
      width: r.narrator.size,
      height: r.narrator.size,
    });

    this.captionLayer = el('div', 'captions', this.root);
    place(this.captionLayer, r.captions);
    this.captionBox = el('div', 'caption-box', this.captionLayer);
    this.captionBox.style.opacity = '0';

    // Deterministic blinks every 2.6–4.4 seconds.
    const rand = seeded(t.seed);
    for (let at = 1.4 + rand() * 1.5; at < t.duration; at += 2.6 + rand() * 1.8)
      this.blinkTimes.push(at);

    const images = [...this.root.querySelectorAll('img')];
    const results = await Promise.all(
      images.map((img) =>
        img.decode().then(
          () => true,
          () => false,
        ),
      ),
    );
    this.imagesOk = results.every(Boolean);
    for (const s of this.scenes) s.root.style.display = 'none';
    this.seek(0);
  }

  private blink(time: number): number {
    for (const at of this.blinkTimes) {
      const d = time - at;
      if (d >= 0 && d < 0.18) return Math.sin((d / 0.18) * Math.PI);
    }
    return 0;
  }

  /** The narrator's pose for one scene at this moment (a pure function of the frame). */
  private poseFor(
    m: MountedScene,
    time: number,
    frame: number,
    mouth: number,
    blink: number,
  ): Pose {
    const { scene } = m;
    const t = time - scene.start;
    const duration = scene.end - scene.start;
    const pointing = POINTS_AT.has(scene.visual.kind);
    const target = pointing
      ? this.targetOf(
          m,
          {
            t,
            duration,
            p: clamp(t / duration),
            frame,
            fox: { mouth, blink },
            open: m.index === 0,
          },
          time,
        )
      : undefined;
    const { aim, reach, gaze } = this.aimFor(m, target);
    return foxPose({
      expression: scene.expression,
      t,
      time,
      mouth,
      blink,
      gaze,
      pointing,
      aim,
      reach,
      seed: this.timeline.seed,
    });
  }

  /**
   * Where the narrator looks and points in a scene: at the highlighted target when there is one,
   * else toward the content. The tail may leave the narrator's box only into empty space, so it
   * takes the nearest direction that keeps it off the header text, captions, and media region.
   */
  private aimFor(
    m: MountedScene,
    target: Rect | undefined,
  ): { aim: number; reach: number; gaze: { x: number; y: number } } {
    const placement = this.regions.narrator;
    let gaze = gazeFor(m.scene, this.timeline.orientation === 'vertical');
    let desired = Math.atan2(gaze.y, gaze.x) * (180 / Math.PI);
    if (target) {
      const box = toFox(target, placement);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const dx = point.x - EYES.x;
      const dy = point.y - EYES.y;
      const length = Math.hypot(dx, dy) || 1;
      gaze = { x: (dx / length) * 0.9, y: (dy / length) * 0.9 };
      desired = aimAt(point);
    }
    const r = this.regions;
    const keepOut = [...m.headerText, r.captions, r.media, r.progress].map((rect) => {
      const box = toFox(rect, placement);
      return {
        x: box.x - TAIL_MARGIN,
        y: box.y - TAIL_MARGIN,
        width: box.width + 2 * TAIL_MARGIN,
        height: box.height + 2 * TAIL_MARGIN,
      };
    });
    return { ...clearAim(desired, keepOut), gaze };
  }

  seek(frame: number): void {
    const t = this.timeline;
    const time = frame / t.fps;
    this.lastFrame = frame;
    const mouth = t.mouth[frame] ?? 0;
    const blink = this.blink(time);

    this.scenes.forEach((m, i) => {
      const { scene } = m;
      const first = i === 0;
      const last = i === this.scenes.length - 1;
      const visible = time >= scene.start - 1e-6 && (time <= scene.end + 1e-6 || last);
      if (!visible) {
        m.root.style.display = 'none';
        return;
      }
      m.root.style.display = 'block';
      const unit = this.regions.unit;
      const enterWith = transitionOf(scene, t);
      const next = this.scenes[i + 1];
      const leaveWith = next ? transitionOf(next.scene, t) : undefined;
      // A camera move carries both pictures across the canvas: neither fades nor slides.
      const cameraIn = !first && this.travels(this.scenes[i - 1], m);
      const cameraOut = !last && this.travels(m, next);
      const enter =
        first || m.component.entrance === false || cameraIn
          ? REST
          : entering(
              enterWith.kind,
              seg(time, scene.start, scene.start + enterWith.seconds),
              unit,
              t.width,
            );
      const leave =
        last || !leaveWith || cameraOut
          ? REST
          : leaving(
              leaveWith.kind,
              seg(time, scene.end - leaveWith.seconds, scene.end),
              unit,
              t.width,
            );
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
        open: first,
      };
      m.clock = clock;
      m.component.update(clock);
      const push = m.camera ? cameraPush(local, m.camera) : 0;
      if (m.component.camera) m.component.camera(push);
      if (m.viewport && scene.stop) {
        m.media.style.transform = layerTransform(this.cameraAt(i, time), scene.stop, this.pivot);
        const clip = this.clipAt(i, time);
        m.viewport.style.clipPath = clip ? insetOf(clip, t.width, t.height) : '';
      } else if (!m.component.camera)
        m.media.style.transform = push > 1e-6 ? `scale(${(1 + push).toFixed(5)})` : '';
      if (m.component.fox && m.foxTaken !== undefined)
        m.component.fox.element.style.visibility = time >= m.foxTaken - 1e-6 ? 'hidden' : 'visible';
      // The opening scene's header is in place at frame 0, like the rest of it.
      if (m.header) {
        // Across a camera move both headers sit in one place: the old one has gone (over the
        // move's first 40%) before the new one comes in.
        const lead = cameraIn ? 0.4 * enterWith.seconds : 0;
        const eyebrow = m.header.firstElementChild as HTMLElement;
        eyebrow.style.opacity = easeOutCubic(
          first ? 1 : seg(local, lead + 0.05, lead + 0.4),
        ).toFixed(3);
        const heading = m.header.children[1] as HTMLElement | undefined;
        if (heading) {
          const e = easeOutCubic(first ? 1 : seg(local, lead + 0.12, lead + 0.55));
          heading.style.opacity = e.toFixed(3);
          heading.style.transform = `translateY(${((1 - e) * 14 * this.regions.unit).toFixed(2)}px)`;
        }
        m.header.style.opacity =
          cameraOut && leaveWith
            ? (
                1 -
                easeInOutCubic(
                  seg(time, scene.end - leaveWith.seconds, scene.end - 0.6 * leaveWith.seconds),
                )
              ).toFixed(3)
            : '';
      }
      // The narrator comes and goes with the scenes it narrates. Across a camera move both
      // pictures stay up, so to or from a scene without it, it eases over most of the move instead
      // (gently: never more than a fifth of the way in one frame).
      let presence = Number(m.root.style.opacity);
      if (cameraIn && !this.scenes[i - 1]!.scene.narrator)
        presence = Math.min(presence, easeInOutSine(seg(local, 0, 0.6 * enterWith.seconds)));
      if (cameraOut && leaveWith && !next!.scene.narrator)
        presence = Math.min(
          presence,
          1 -
            easeInOutSine(
              seg(time, scene.end - leaveWith.seconds, scene.end - 0.4 * leaveWith.seconds),
            ),
        );
      m.presence = presence;
    });

    if (this.grid) {
      const front = this.scenes.findLast((m) => m.viewport && m.root.style.display === 'block');
      if (front) {
        const { position, size } = gridStyle(
          this.cameraAt(front.index, time),
          this.pivot,
          gridSpacing(this.regions.unit),
        );
        Object.assign(this.grid.style, {
          display: 'block',
          backgroundPosition: position,
          backgroundSize: size,
        });
      } else this.grid.style.display = 'none';
    }

    if (this.accent) {
      const { flash, ring, hero } = this.accent;
      const accent = heroAccent(time - (hero.scene.start + hero.scene.phases![HERO_PHASE]!));
      flash.style.opacity = accent.flash.toFixed(3);
      if (accent.ringOpacity > 0.001 && hero.root.style.display === 'block' && hero.clock) {
        // The ring opens around what the hero highlights, else the middle of the media region.
        const media = this.regions.media;
        const box = this.targetOf(hero, hero.clock, time) ?? media;
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

    // Narrator: present in scenes that do not feature the fox themselves.
    const narrated = this.scenes.filter(
      (m) => m.scene.narrator && m.root.style.display === 'block',
    );
    const shown = narrated.reduce((w, m) => Math.max(w, m.presence), 0);
    this.narrator.style.opacity = t.mascot ? shown.toFixed(3) : '0';
    this.drawn = undefined;
    const current = narrated.at(-1);
    if (t.mascot && current && shown > 0.001) {
      // The incoming scene leads; across a cut the pose eases out of the outgoing one.
      const previous = narrated.at(-2);
      let pose = this.poseFor(current, time, frame, mouth, blink);
      if (previous)
        pose = blendPoses(
          this.poseFor(previous, time, frame, mouth, blink),
          pose,
          easeInOutCubic(
            seg(
              time,
              current.scene.start,
              current.scene.start + transitionOf(current.scene, t).seconds,
            ),
          ),
        );
      // The narrator springs in when it appears, not between scenes it narrates in a row, and is
      // already in place when the video opens on it.
      const appears = current.index > 0 && !this.scenes[current.index - 1]?.scene.narrator;
      const enter = appears ? clamp(spring(time - current.scene.start, 2.4, 7), 0, 1.06) : 1;
      const placement: NarratorPlacement = {
        ...this.regions.narrator,
        bob: Math.sin(time * 2.1 + t.seed) * 1.2,
        scale: 0.9 + 0.1 * enter,
      };
      // Whatever the tail is doing, it leaves the box only into empty space.
      const r = this.regions;
      const fox = fitTail(
        pose.fox,
        [...narrated.flatMap((m) => m.headerText), r.captions, r.media, r.progress],
        placement,
      );
      this.narrator.style.transform = `translate(0px, ${placement.bob!.toFixed(2)}px) scale(${placement.scale!.toFixed(4)})`;
      this.narrator.innerHTML = foxSvg({ ...fox, size: r.narrator.size, theme: t.theme.name });
      this.drawn = { fox, placement };
    }

    // Captions.
    const cue = t.captions.find((c) => time >= c.start && time < c.end);
    const key = cue ? `${cue.start}` : '';
    if (key !== this.captionKey) {
      this.captionKey = key;
      this.captionBox.innerHTML = '';
      this.emphasis = [];
      for (const [i, line] of (cue?.lines ?? []).entries()) {
        const span = el('span', 'line', this.captionBox);
        let at = 0;
        for (const mark of (cue?.emphasis ?? []).filter((e) => e.line === i)) {
          if (mark.from > at) span.append(line.slice(at, mark.from));
          const node = el('span', 'em', span, line.slice(mark.from, mark.to));
          this.emphasis.push({ node, start: mark.start, end: mark.end });
          at = mark.to;
        }
        if (at < line.length) span.append(line.slice(at));
      }
    }
    // The marker sweeps under the key phrase as it is spoken (at least a quarter second).
    for (const e of this.emphasis) {
      const p = easeInOutCubic(seg(time, e.start, Math.max(e.end, e.start + 0.25)));
      e.node.style.backgroundSize = `${(p * 100).toFixed(2)}% 100%`;
    }
    if (cue) {
      const inP = seg(time, cue.start, cue.start + 0.12);
      const outP = seg(time, cue.end - 0.1, cue.end);
      const next = t.captions.find((c) => Math.abs(c.start - cue.end) < 0.05);
      this.captionBox.style.opacity = String(Math.min(inP, next ? 1 : 1 - outP).toFixed(3));
    } else {
      this.captionBox.style.opacity = '0';
    }

    // Progress: full by the end of the story, then it fades away under the outro.
    t.scenes.forEach((s, i) => {
      const fill = this.progress[i];
      if (fill) fill.style.transform = `scaleX(${seg(time, s.start, s.end).toFixed(4)})`;
    });
    const outroScene = t.scenes.find((s) => s.visual.kind === 'outro');
    this.progressBar.style.opacity = outroScene
      ? (
          1 -
          easeInOutCubic(
            seg(time, outroScene.start, outroScene.start + transitionOf(outroScene, t).seconds),
          )
        ).toFixed(3)
      : '1';
  }

  report(): LayoutReport {
    const time = this.lastFrame / this.timeline.fps;
    const shown =
      Boolean(this.captionBox.textContent) && Number(this.captionBox.style.opacity) > 0.05;
    const active = this.scenes.find((m) => time >= m.scene.start && time < m.scene.end);
    // On the canvas, what lies outside the viewport is not drawn, so it is not reported either;
    // a focus computed from layout is reported where the camera draws it.
    const clip = active?.viewport ? this.drawnClip(active, time) : undefined;
    const drawn = (active?.component.report() ?? []).flatMap((item) => {
      const at =
        active?.component.laidOut && item.role === 'focus'
          ? { ...item, rect: this.onCanvas(active, item.rect, time) }
          : item;
      if (!clip) return [at];
      const rect = clipRect(at.rect, clip);
      return rect ? [{ ...at, rect }] : [];
    });
    // The fox as drawn, tail included: it can reach past its box when it points.
    const parts =
      this.drawn && Number(this.narrator.style.opacity) > 0.05
        ? narratorParts(this.drawn.fox, this.drawn.placement)
        : undefined;
    return {
      frame: this.lastFrame,
      scene: active?.scene.id,
      captions: shown ? rectOf(this.captionBox) : undefined,
      captionOverflow: shown
        ? [...this.captionBox.children].some((line) => line.scrollWidth > line.clientWidth + 2) ||
          this.captionBox.scrollWidth > this.captionBox.clientWidth + 2
        : undefined,
      items: active ? [...drawn, ...(active.heading ? [active.heading] : [])] : [],
      narrator: parts ? union(parts) : undefined,
      narratorParts: parts,
      headerText: active?.headerText.length ? active.headerText : undefined,
      imagesLoaded: this.imagesOk,
      fontsFailed: this.fontsFailed.length ? this.fontsFailed : undefined,
    };
  }

  /** Whether the camera travels the canvas from scene `a` to scene `b`: `b` enters by pan or zoom. */
  private travels(a: MountedScene | undefined, b: MountedScene | undefined): boolean {
    return Boolean(
      a?.scene.stop && b?.scene.stop && isCameraMove(transitionOf(b.scene, this.timeline).kind),
    );
  }

  /** The camera move into scene `i` from the one before, while it is in progress at `time`. */
  private moveAt(i: number, time: number): Travel | undefined {
    const from = this.scenes[i - 1];
    const to = this.scenes[i];
    if (!from || !to || !this.travels(from, to)) return undefined;
    const { kind, seconds } = transitionOf(to.scene, this.timeline);
    const end = to.scene.start + seconds;
    if (!isCameraMove(kind) || time < to.scene.start || time > end) return undefined;
    return { from, to, kind, k: seg(time, to.scene.start, end), end };
  }

  /**
   * The scene the camera is on its way to when it draws scene `i` at `time`: `i` itself, or the
   * last of the moves in progress that leave from it, one after another. So every scene on screen
   * is drawn by the same camera, even when a scene is too short to settle between two moves.
   */
  private headedTo(i: number, time: number): number {
    let j = i;
    while (this.moveAt(j + 1, time)) j++;
    return j;
  }

  /** Where the camera looks in a scene's own stop at `time` (world coordinates): beats, then push. */
  private stopView(m: MountedScene, time: number): View {
    const local = Math.max(0, time - m.scene.start);
    const push = m.camera && !m.component.camera ? cameraPush(local, m.camera) : 0;
    const view = viewAt(m.steps, local, restView(this.pivot));
    return toWorld(clampView(withPush(view, push), m.region, this.pivot), m.scene.stop!);
  }

  /** Where the camera looks at `time` as it arrives at scene `j`'s stop, or rests there. */
  private viewInto(j: number, time: number): View {
    const move = this.moveAt(j, time);
    if (!move) return this.stopView(this.scenes[j]!, time);
    const back = pullBack(move.from.scene.stop!, move.to.scene.stop!, this.regions.media);
    // The move lands on the next stop's view as it is when the move ends, beats and push
    // included, so the stop's own camera takes over without a jump.
    return between(
      move.kind,
      this.viewInto(j - 1, time),
      this.stopView(move.to, move.end),
      move.k,
      back * PULL_MARGIN,
    );
  }

  /** The camera that draws scene `i` at `time`: its stop's view, or the move it is part of. */
  private cameraAt(i: number, time: number): View {
    return this.viewInto(this.headedTo(i, time), time);
  }

  /**
   * The band the viewport closes to as the camera arrives at scene `j`'s stop, or rests there: its
   * region's rows across the whole frame. Only the header and the captions need protecting, and
   * they sit above and below the region in every orientation; the frame's sides hold nothing else.
   */
  private bandInto(j: number, time: number): Rect {
    const move = this.moveAt(j, time);
    const r = this.scenes[j]!.region;
    const band = { x: 0, y: r.y, width: this.timeline.width, height: r.height };
    return move ? lerpRect(this.bandInto(j - 1, time), band, easeInOutCubic(move.k)) : band;
  }

  /**
   * How closed the viewport is (0–1) as the camera arrives at scene `j`'s stop, or rests there:
   * open at rest, closing over the start of a move and opening over its end (before and after a
   * neighbouring stop can be in the frame), and closed while a beat magnifies the stop.
   */
  private closedInto(j: number, time: number): number {
    const move = this.moveAt(j, time);
    if (!move) return this.magnified(this.scenes[j]!, time);
    const travel = Math.min(1, move.k / CLIP_RAMP, (1 - move.k) / CLIP_RAMP);
    const ends = lerp(
      this.closedInto(j - 1, time),
      this.magnified(move.to, move.end),
      easeInOutCubic(move.k),
    );
    return Math.max(travel, ends);
  }

  /** How far a scene's beats magnify its stop at `time`, toward closing the viewport (0–1). */
  private magnified(m: MountedScene, time: number): number {
    const view = viewAt(m.steps, Math.max(0, time - m.scene.start), restView(this.pivot));
    return clamp((view.scale - 1) / CLIP_ZOOM);
  }

  /**
   * Scene `i`'s viewport clip at `time`, or nothing: at rest a stop is drawn whole, as without a
   * canvas (a card's shadow, the large fox's tail past the region).
   */
  private clipAt(i: number, time: number): Rect | undefined {
    const j = this.headedTo(i, time);
    const w = easeInOutCubic(this.closedInto(j, time));
    if (w <= 1e-6) return undefined;
    const frame = { x: 0, y: 0, width: this.timeline.width, height: this.timeline.height };
    return lerpRect(frame, this.bandInto(j, time), w);
  }

  /** Scene `m`'s clip where it is drawn (see `throughScene`), or nothing at rest. */
  private drawnClip(m: MountedScene, time: number): Rect | undefined {
    const clip = this.clipAt(m.index, time);
    return clip && this.throughScene(m, clip);
  }

  /**
   * A box in stage pixels where scene `m` draws it: its entrance or exit (a push, a fade's rise)
   * moves and scales the viewport with the rest of the scene.
   */
  private throughScene(m: MountedScene, rect: Rect): Rect {
    const box = m.viewport!.getBoundingClientRect();
    const sx = box.width / this.timeline.width;
    const sy = box.height / this.timeline.height;
    return {
      x: box.x + rect.x * sx,
      y: box.y + rect.y * sy,
      width: rect.width * sx,
      height: rect.height * sy,
    };
  }

  /** A box laid out in scene `m`'s stop, where it is drawn at `time` (as it is without a canvas). */
  private onCanvas(m: MountedScene, rect: Rect, time: number): Rect {
    if (!m.viewport || !m.scene.stop) return rect;
    const view = this.cameraAt(m.index, time);
    return this.throughScene(m, drawnRect(rect, view, m.scene.stop, this.pivot));
  }

  /** What scene `m` highlights, where it is drawn at `time` (see `Component.laidOut`). */
  private targetOf(m: MountedScene, clock: SceneClock, time: number): Rect | undefined {
    const target = m.component.target?.(clock);
    return target && m.component.laidOut ? this.onCanvas(m, target, time) : target;
  }

  /**
   * The camera's beats in a directed scene, each toward its target as drawn when the beat ends, or,
   * following an element that moves, toward where it is laid out at each frame.
   */
  private cameraSteps(m: MountedScene): CameraStep[] {
    const d = m.scene.direction;
    if (!d || !m.scene.stop) return [];
    // `viewAt` reads steps in time order; the sort is stable, so beats at one moment keep theirs.
    const beats = d.beats
      .flatMap((b) => (b.verb === 'camera' ? [b] : []))
      .sort((a, b) => a.t - b.t);
    const steps: CameraStep[] = [];
    let from = restView(this.pivot);
    for (const beat of beats) {
      const element = d.elements.find((e) => e.id === beat.to);
      if (!element) continue;
      // Following an element that moves (a morph's changed lines) frames it at every frame.
      const shot = beat.move === 'follow' ? m.shot : undefined;
      const track = shot?.track(element.id, beat.t);
      if (shot && track) {
        const start = from;
        const to = (t: number) =>
          beatView(
            'follow',
            shot.track(element.id, t) ?? track,
            beat.zoom,
            start,
            m.region,
            this.pivot,
          );
        steps.push({ t: beat.t, seconds: beat.seconds, to });
        from = to(beat.t + beat.seconds);
        continue;
      }
      // A beat frames its target as drawn when it ends: what the visual highlights then (its
      // lines, its focus), or the element's box.
      const measured = this.targetAt(m, element, beat.t + beat.seconds);
      const target =
        measured && measured.width >= 1 && measured.height >= 1 ? measured : element.rect;
      const to = beatView(beat.move, target, beat.zoom, from, m.region, this.pivot);
      steps.push({ t: beat.t, seconds: beat.seconds, to });
      from = to;
    }
    return steps;
  }

  /**
   * Where a beat's target is drawn `t` seconds into its scene, in stage pixels (before any
   * transform). Components draw as pure functions of their clock, so drawing one at a later moment
   * here leaves nothing behind: a scene is drawn for its own frame before it is shown.
   */
  private targetAt(m: MountedScene, element: DirectionElement, t: number): Rect | undefined {
    const duration = m.scene.end - m.scene.start;
    const clock: SceneClock = {
      t,
      duration,
      p: clamp(t / duration),
      frame: Math.round((m.scene.start + t) * this.timeline.fps),
      fox: { mouth: 0, blink: 0 },
      open: m.index === 0,
    };
    m.component.update(clock);
    return element.kind === 'visual' ? m.visual?.target?.(clock) : m.shot?.frame(element.id);
  }
}
