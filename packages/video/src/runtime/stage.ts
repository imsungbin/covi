import { foxPose, foxSvg } from '@covi/brand';
import type { LayoutReport, Timeline, TimelineScene } from '../timeline/types.ts';
import { clamp, easeInOutCubic, easeOutCubic, seeded, seg, spring } from './anim.ts';
import { summary, title } from './components/cards.ts';
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
import { type Component, type ComponentContext, rectOf } from './components/types.ts';
import { el, fitText, place } from './dom.ts';
import { computeRegions, type Regions } from './layout.ts';
import { stylesheet } from './styles.ts';

interface MountedScene {
  scene: TimelineScene;
  root: HTMLDivElement;
  header?: HTMLDivElement;
  component: Component;
}

function mountComponent(scene: TimelineScene, ctx: ComponentContext): Component {
  const v = scene.visual;
  switch (v.kind) {
    case 'title':
      return title(v, ctx, scene.expression);
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
  }
}

/** Where the narrator looks for each kind of scene: toward the content it is talking about. */
/** Scenes whose content the narrator points at (it leans toward the highlighted part). */
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

function gazeFor(scene: TimelineScene, vertical: boolean): { x: number; y: number } {
  if (scene.visual.kind === 'title' || scene.visual.kind === 'summary') return { x: 0, y: 0 };
  return vertical ? { x: -0.55, y: 0.75 } : { x: -0.7, y: 0.45 };
}

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
  private progress: HTMLDivElement[] = [];
  private blinkTimes: number[] = [];
  private imagesOk = true;
  private lastFrame = 0;

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
    await document.fonts.ready;
    const t = this.timeline;
    const r = this.regions;
    const u = (n: number) => n * r.unit;

    const bar = el('div', 'progress', this.root);
    place(bar, r.progress);
    const total = t.duration;
    for (const s of t.scenes) {
      const segEl = el('div', 'seg', bar);
      segEl.style.flexGrow = String(Math.max(0.2, (s.end - s.start) / total));
      this.progress.push(el('div', 'fill', segEl));
    }

    for (const scene of t.scenes) {
      const root = el('div', 'scene', this.root);
      root.dataset.scene = scene.id;
      const ctx: ComponentContext = { timeline: t, regions: r, u, root };
      const component = mountComponent(scene, ctx);
      let header: HTMLDivElement | undefined;
      if (component.header !== false) {
        header = el('div', 'scene-header', root);
        place(header, r.header);
        el('div', 'eyebrow', header, scene.eyebrow);
        if (scene.heading) {
          const h = el('div', 'heading', header, scene.heading);
          fitText(h, {
            max: u(t.orientation === 'vertical' ? 50 : 42),
            min: u(26),
            maxHeight: r.header.height - u(50),
            maxWidth: r.header.width,
          });
        }
      }
      this.scenes.push({ scene, root, header, component });
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

  seek(frame: number): void {
    const t = this.timeline;
    const time = frame / t.fps;
    this.lastFrame = frame;
    const mouth = t.mouth[frame] ?? 0;
    const blink = this.blink(time);
    let lead: { scene: TimelineScene; weight: number } | undefined;

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
      const enter = first ? 1 : easeOutCubic(seg(time, scene.start, scene.start + t.transition));
      const exit = last ? 0 : easeInOutCubic(seg(time, scene.end - t.transition, scene.end));
      const presence = Math.min(enter, 1 - exit);
      m.root.style.opacity = presence.toFixed(4);
      m.root.style.transform = `translateY(${((1 - enter) * 26 * this.regions.unit - exit * 14 * this.regions.unit).toFixed(2)}px)`;
      const local = time - scene.start;
      const duration = scene.end - scene.start;
      m.component.update({
        t: local,
        duration,
        p: clamp(local / duration),
        frame,
        fox: { mouth, blink },
      });
      if (m.header) {
        const eyebrow = m.header.firstElementChild as HTMLElement;
        eyebrow.style.opacity = easeOutCubic(seg(local, 0.05, 0.4)).toFixed(3);
        const heading = m.header.children[1] as HTMLElement | undefined;
        if (heading) {
          const e = easeOutCubic(seg(local, 0.12, 0.55));
          heading.style.opacity = e.toFixed(3);
          heading.style.transform = `translateY(${((1 - e) * 14 * this.regions.unit).toFixed(2)}px)`;
        }
      }
      if (!lead || presence > lead.weight) lead = { scene, weight: presence };
    });

    // Narrator: present in scenes that do not feature the fox themselves.
    if (lead && t.mascot) {
      const scene = lead.scene;
      const shown = this.scenes
        .filter((m) => m.scene.narrator && time >= m.scene.start && time <= m.scene.end)
        .reduce((w, m) => Math.max(w, Number(m.root.style.opacity)), 0);
      this.narrator.style.opacity = shown.toFixed(3);
      if (shown > 0.001) {
        const local = time - scene.start;
        const enter = clamp(spring(local, 2.4, 7), 0, 1.06);
        const bob = Math.sin(time * 2.1 + t.seed) * 1.2;
        const pose = foxPose({
          expression: scene.expression,
          t: local,
          time,
          mouth,
          blink,
          gaze: gazeFor(scene, t.orientation === 'vertical'),
          pointing: POINTS_AT.has(scene.visual.kind),
          seed: t.seed,
        });
        const px = this.regions.narrator.size / 128;
        this.narrator.style.transform = `translate(${(pose.lean.x * px).toFixed(2)}px, ${bob.toFixed(2)}px) rotate(${pose.lean.rotate.toFixed(2)}deg) scale(${(0.9 + 0.1 * enter).toFixed(4)})`;
        this.narrator.innerHTML = foxSvg({ ...pose.fox, size: this.regions.narrator.size });
      }
    } else {
      this.narrator.style.opacity = '0';
    }

    // Captions.
    const cue = t.captions.find((c) => time >= c.start && time < c.end);
    const key = cue ? `${cue.start}` : '';
    if (key !== this.captionKey) {
      this.captionKey = key;
      this.captionBox.innerHTML = '';
      for (const line of cue?.lines ?? []) el('span', 'line', this.captionBox, line);
    }
    if (cue) {
      const inP = seg(time, cue.start, cue.start + 0.12);
      const outP = seg(time, cue.end - 0.1, cue.end);
      const next = t.captions.find((c) => Math.abs(c.start - cue.end) < 0.05);
      this.captionBox.style.opacity = String(Math.min(inP, next ? 1 : 1 - outP).toFixed(3));
    } else {
      this.captionBox.style.opacity = '0';
    }

    // Progress.
    t.scenes.forEach((s, i) => {
      const k = seg(time, s.start, s.end);
      this.progress[i]!.style.transform = `scaleX(${k.toFixed(4)})`;
    });
  }

  report(): LayoutReport {
    const time = this.lastFrame / this.timeline.fps;
    const shown =
      Boolean(this.captionBox.textContent) && Number(this.captionBox.style.opacity) > 0.05;
    const active = this.scenes.find((m) => time >= m.scene.start && time < m.scene.end);
    return {
      frame: this.lastFrame,
      scene: active?.scene.id,
      captions: shown ? rectOf(this.captionBox) : undefined,
      captionOverflow: shown
        ? [...this.captionBox.children].some((line) => line.scrollWidth > line.clientWidth + 2) ||
          this.captionBox.scrollWidth > this.captionBox.clientWidth + 2
        : undefined,
      items: active ? active.component.report() : [],
      narrator: Number(this.narrator.style.opacity) > 0.05 ? rectOf(this.narrator) : undefined,
      imagesLoaded: this.imagesOk,
    };
  }
}
