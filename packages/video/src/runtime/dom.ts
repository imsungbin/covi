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
