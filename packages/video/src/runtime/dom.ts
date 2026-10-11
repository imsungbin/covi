import type { Rect } from '../timeline/types.ts';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export function place(
  node: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
): void {
  Object.assign(node.style, {
    position: 'absolute',
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Largest font size (px) at which the element's text fits its box. Needs fonts loaded and the node visible. */
export function fitText(
  node: HTMLElement,
  options: { max: number; min: number; maxHeight?: number; maxWidth?: number },
): number {
  let lo = options.min;
  let hi = options.max;
  const fits = () =>
    (options.maxWidth === undefined || node.scrollWidth <= options.maxWidth + 1) &&
    (options.maxHeight === undefined || node.scrollHeight <= options.maxHeight + 1);
  node.style.fontSize = `${hi}px`;
  if (fits()) return hi;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    node.style.fontSize = `${mid}px`;
    if (fits()) lo = mid;
    else hi = mid;
  }
  node.style.fontSize = `${lo}px`;
  return lo;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/** A color with nothing to show: `transparent`, or an alpha of zero. */
const clear = (color: string) => color === 'transparent' || /,\s*0\)$/.test(color);

/** Whether an element paints a box of its own: a fill, an image, a shadow, or a border. */
function paints(style: CSSStyleDeclaration): boolean {
  return (
    !clear(style.backgroundColor) ||
    style.backgroundImage !== 'none' ||
    style.boxShadow !== 'none' ||
    (['Top', 'Right', 'Bottom', 'Left'] as const).some(
      (side) =>
        Number.parseFloat(style[`border${side}Width`]) > 0 && !clear(style[`border${side}Color`]),
    )
  );
}

/**
 * Elements whose own box is what they draw: images and media, and SVG shapes. An `<svg>` is a
 * container like any other (a shot's flow layer spans the whole stage, its edges inside it).
 */
const DRAWN = new Set([
  'IMG',
  'CANVAS',
  'VIDEO',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'image',
  'use',
]);

/**
 * The box around what `root` visibly draws inside `clip`, in stage pixels: text, images, and boxes
 * with a fill, a border, or a shadow, at an opacity (its own times every ancestor's up to `root`)
 * above a tenth. Containers that draw nothing and parts not shown yet (an entrance still to come)
 * do not count, so this is what a viewer sees of the scene, not where its parts are laid out.
 */
export function drawnBox(root: HTMLElement, clip: Rect): Rect | undefined {
  let box: { left: number; top: number; right: number; bottom: number } | undefined;
  const add = (r: DOMRect) => {
    const left = Math.max(r.left, clip.x);
    const top = Math.max(r.top, clip.y);
    const right = Math.min(r.right, clip.x + clip.width);
    const bottom = Math.min(r.bottom, clip.y + clip.height);
    if (right <= left || bottom <= top) return;
    box = box
      ? {
          left: Math.min(box.left, left),
          top: Math.min(box.top, top),
          right: Math.max(box.right, right),
          bottom: Math.max(box.bottom, bottom),
        }
      : { left, top, right, bottom };
  };
  const range = document.createRange();
  const walk = (node: Element, opacity: number) => {
    const style = getComputedStyle(node);
    if (style.display === 'none') return;
    const shown = opacity * Number.parseFloat(style.opacity || '1');
    if (shown < 0.1) return;
    const visible = style.visibility !== 'hidden';
    if (DRAWN.has(node.tagName)) {
      if (visible) add(node.getBoundingClientRect());
      return;
    }
    if (visible && node !== root && paints(style)) add(node.getBoundingClientRect());
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element, shown);
      else if (visible && child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) add(r);
      }
    }
  };
  walk(root, 1);
  return (
    box && { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }
  );
}
