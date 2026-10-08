import type { ScreenshotTiming } from '../../timeline/cues.ts';
import type { ImageAsset, Point, Rect } from '../../timeline/types.ts';
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg } from '../anim.ts';
import { el } from '../dom.ts';
import { type FrameCamera, type FrameGeometry, frameCamera } from '../framing.ts';
import { contain } from '../layout.ts';

export interface FrameOptions {
  chrome: boolean;
  url?: string;
  u: (n: number) => number;
}

/**
 * A browser/device frame around a screenshot with a camera: zoom toward a focus region, dim the
 * rest, ring the focus, and move a cursor to a click point. All positions derive from image pixels.
 */
export class Frame {
  readonly root: HTMLDivElement;
  readonly viewport: Rect;
  readonly base: Rect;
  private readonly img: HTMLImageElement;
  private readonly image: ImageAsset;
  private readonly overlay: HTMLDivElement;
  private readonly dims: HTMLDivElement[];
  private readonly ring: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private readonly ripple: HTMLDivElement;
  private readonly u: (n: number) => number;
  private camera: FrameCamera = { z: 1, ox: 0, oy: 0 };

  constructor(parent: HTMLElement, box: Rect, image: ImageAsset, options: FrameOptions) {
    this.u = options.u;
    this.image = image;
    const chromeHeight = options.chrome ? options.u(38) : 0;
    // Fit the whole frame (chrome + image at its own aspect ratio) inside the box.
    const aspect = image.height / image.width;
    const width = Math.min(box.width, (box.height - chromeHeight) / aspect);
    const height = width * aspect + chromeHeight;
    const outer = {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    };
    this.root = el('div', 'frame', parent);
    Object.assign(this.root.style, {
      left: `${outer.x}px`,
      top: `${outer.y}px`,
      width: `${outer.width}px`,
      height: `${outer.height}px`,
    });
    if (options.chrome) {
      const chrome = el('div', 'chrome', this.root);
      chrome.style.height = `${chromeHeight}px`;
      for (let i = 0; i < 3; i++) el('i', '', chrome);
      el('div', 'url mono', chrome, options.url ?? '');
    }
    const vp = el('div', 'viewport', this.root);
    vp.style.top = `${chromeHeight}px`;
    this.viewport = {
      x: outer.x,
      y: outer.y + chromeHeight,
      width: outer.width,
      height: outer.height - chromeHeight,
    };
    this.base = contain(image.width, image.height, {
      x: 0,
      y: 0,
      width: this.viewport.width,
      height: this.viewport.height,
    });
    this.img = el('img', '', vp);
    this.img.src = image.src;
    this.img.decoding = 'sync';
    Object.assign(this.img.style, {
      left: `${this.base.x}px`,
      top: `${this.base.y}px`,
      width: `${this.base.width}px`,
      height: `${this.base.height}px`,
    });

    this.overlay = el('div', 'layer', parent);
    this.overlay.style.pointerEvents = 'none';
    this.dims = [0, 1, 2, 3].map(() => el('div', 'dim', this.overlay));
    this.ring = el('div', 'focus-ring', this.overlay);
    this.ripple = el('div', 'ripple', this.overlay);
    this.cursor = el('div', 'cursor', this.overlay);
    this.cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2.5 L4 19.5 L8.6 15.2 L11.6 21.6 L14.6 20.2 L11.7 13.9 L17.9 13.9 Z" fill="#1F2430" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    this.hideOverlays();
  }

  get decoded(): Promise<void> {
    return this.img.decode().catch(() => undefined);
  }

  /** Image pixels → stage pixels under the current camera (or a given one). */
  map(rect: Rect, camera = this.camera): Rect {
    const s = (this.base.width / this.image.width) * camera.z;
    return {
      x: this.viewport.x + camera.ox + rect.x * s,
      y: this.viewport.y + camera.oy + rect.y * s,
      width: rect.width * s,
      height: rect.height * s,
    };
  }

  mapPoint(p: Point): Point {
    const r = this.map({ x: p.x, y: p.y, width: 0, height: 0 });
    return { x: r.x, y: r.y };
  }

  /** What the camera works with, for the pure camera math in `framing.ts`. */
  get geometry(): FrameGeometry {
    return { image: this.image, base: this.base, viewport: this.viewport };
  }

  /** Zoom toward `focus` (image px) by progress `k` (0–1). */
  setCamera(focus: Rect | undefined, k: number, maxZoom = 1.9): void {
    this.apply(this.cameraFor(focus, k, maxZoom));
  }

  /** Points the camera exactly (a pan between marks blends two cameras). */
  apply(camera: FrameCamera): void {
    this.camera = { ...camera };
    this.img.style.transform = `translate(${(camera.ox - this.base.x).toFixed(2)}px, ${(camera.oy - this.base.y).toFixed(2)}px) scale(${camera.z.toFixed(4)})`;
  }

  /** The camera `setCamera` would set, without setting it. */
  cameraFor(focus: Rect | undefined, k: number, maxZoom = 1.9): FrameCamera {
    return frameCamera(this.geometry, focus, k, maxZoom);
  }

  /** Dims everything outside the focus and draws a ring around it. */
  spotlight(focus: Rect | undefined, strength: number): void {
    if (!focus || strength <= 0.001) {
      for (const d of this.dims) d.style.opacity = '0';
      this.ring.style.opacity = '0';
      return;
    }
    const pad = this.u(10);
    const r = this.map(focus);
    const v = this.viewport;
    const x0 = Math.max(v.x, r.x - pad);
    const y0 = Math.max(v.y, r.y - pad);
    const x1 = Math.min(v.x + v.width, r.x + r.width + pad);
    const y1 = Math.min(v.y + v.height, r.y + r.height + pad);
    const boxes = [
      { x: v.x, y: v.y, width: v.width, height: Math.max(0, y0 - v.y) },
      { x: v.x, y: y1, width: v.width, height: Math.max(0, v.y + v.height - y1) },
      { x: v.x, y: y0, width: Math.max(0, x0 - v.x), height: Math.max(0, y1 - y0) },
      { x: x1, y: y0, width: Math.max(0, v.x + v.width - x1), height: Math.max(0, y1 - y0) },
    ];
    boxes.forEach((b, i) => {
      Object.assign(this.dims[i]!.style, {
        left: `${b.x}px`,
        top: `${b.y}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
        opacity: String((strength * 0.9).toFixed(3)),
      });
    });
    const grow = 1 + (1 - easeOutBack(clamp(strength))) * 0.08;
    Object.assign(this.ring.style, {
      left: `${x0}px`,
      top: `${y0}px`,
      width: `${x1 - x0}px`,
      height: `${y1 - y0}px`,
      opacity: String(clamp(strength * 1.4).toFixed(3)),
      transform: `scale(${grow.toFixed(4)})`,
    });
  }

  /**
   * Moves the cursor to `click` (image px) and plays the click ripple. It comes from `from` (image
   * px; the previous mark, where it already rests), else in from the viewport's corner.
   */
  pointer(click: Point | undefined, move: number, press: number, from?: Point): void {
    if (!click || (move <= 0 && !from)) {
      this.cursor.style.opacity = '0';
      this.ripple.style.opacity = '0';
      return;
    }
    const target = this.mapPoint(click);
    const start = from
      ? this.mapPoint(from)
      : {
          x: this.viewport.x + this.viewport.width * 0.82,
          y: this.viewport.y + this.viewport.height * 0.92,
        };
    const e = easeInOutCubic(clamp(move));
    // Separate easing per axis gives a natural curved path.
    const x = lerp(start.x, target.x, e);
    const y = lerp(start.y, target.y, easeOutCubic(clamp(move)));
    const dip = press > 0 && press < 1 ? 1 - Math.sin(press * Math.PI) * 0.18 : 1;
    Object.assign(this.cursor.style, {
      left: `${x - this.u(6)}px`,
      top: `${y - this.u(3)}px`,
      opacity: String((from ? 1 : clamp(move * 3)).toFixed(3)),
      transform: `scale(${dip.toFixed(3)})`,
    });
    if (press > 0 && press < 1) {
      const size = this.u(24) + press * this.u(70);
      Object.assign(this.ripple.style, {
        left: `${target.x - size / 2}px`,
        top: `${target.y - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        opacity: String((1 - press).toFixed(3)),
      });
    } else {
      this.ripple.style.opacity = '0';
    }
  }

  hideOverlays(): void {
    this.spotlight(undefined, 0);
    this.pointer(undefined, 0, 0);
  }
}

/** Standard choreography for a single screenshot: settle, zoom to focus, then point and click. */
export function choreograph(
  frame: Frame,
  focus: Rect | undefined,
  click: Point | undefined,
  t: number,
  timing: ScreenshotTiming,
): void {
  frame.setCamera(focus, seg(t, ...timing.zoom));
  frame.spotlight(focus, focus ? seg(t, ...timing.spot) : 0);
  frame.pointer(click, seg(t, ...timing.move), seg(t, ...timing.press));
}
