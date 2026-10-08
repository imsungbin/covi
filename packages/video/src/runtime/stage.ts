import { blendPoses, type FoxOptions, foxPose, foxSvg, type Pose } from '@covi/brand';
import {
  HERO_PHASE,
  type LayoutReport,
  type Rect,
  type Timeline,
  type TimelineScene,
} from '../timeline/types.ts';
import { clamp, easeInOutCubic, easeOutCubic, lerp, seeded, seg, spring } from './anim.ts';
import { type CameraPlan, cameraPlan, cameraPush, heroAccent } from './camera.ts';
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
  rectOf,
  type SceneClock,
} from './components/types.ts';
import { el, fitText, place } from './dom.ts';
import { computeRegions, type Regions } from './layout.ts';
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
  /** When the next scene takes over this scene's large fox (it is hidden from then on). */
  foxTaken?: number;
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

  constructor(root: HTMLElement, timeline: Timeline) {
    this.root = root;
    this.timeline = timeline;
    this.regions = computeRegions(timeline);
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
      const media = el('div', 'layer', root);
      const center = { x: r.media.x + r.media.width / 2, y: r.media.y + r.media.height / 2 };
      media.style.transformOrigin = `${center.x.toFixed(2)}px ${center.y.toFixed(2)}px`;
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
      const component = mountComponent(scene, ctx);
      let header: HTMLDivElement | undefined;
      const headerText: Rect[] = [];
      if (component.header !== false) {
        header = el('div', 'scene-header', root);
        place(header, r.header);
        const eyebrow = el('div', 'eyebrow', header, scene.eyebrow);
        if (scene.heading) {
          const h = el('div', 'heading', header, scene.heading);
          fitText(h, {
            max: u(t.orientation === 'vertical' ? 50 : 42),
            min: u(26),
            maxHeight: r.header.height - u(50),
            maxWidth: r.header.width,
          });
          headerText.push(...textBoxes(h));
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
        camera: cameraPlan(scene),
      });
    }

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
      ? m.component.target?.({
          t,
          duration,
          p: clamp(t / duration),
          frame,
          fox: { mouth, blink },
          open: m.index === 0,
        })
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
      else m.media.style.transform = push > 1e-6 ? `scale(${(1 + push).toFixed(5)})` : '';
      if (m.component.fox && m.foxTaken !== undefined)
        m.component.fox.element.style.visibility = time >= m.foxTaken - 1e-6 ? 'hidden' : 'visible';
      // The opening scene's header is in place at frame 0, like the rest of it.
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
    });

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

    // Narrator: present in scenes that do not feature the fox themselves.
    const narrated = this.scenes.filter(
      (m) => m.scene.narrator && m.root.style.display === 'block',
    );
    const shown = narrated.reduce((w, m) => Math.max(w, Number(m.root.style.opacity)), 0);
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
      // The narrator springs in when it appears, not between scenes it narrates in a row.
      const appears = !this.scenes[current.index - 1]?.scene.narrator;
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
      items: active ? active.component.report() : [],
      narrator: parts ? union(parts) : undefined,
      narratorParts: parts,
      headerText: active?.headerText.length ? active.headerText : undefined,
      imagesLoaded: this.imagesOk,
      fontsFailed: this.fontsFailed.length ? this.fontsFailed : undefined,
    };
  }
}
