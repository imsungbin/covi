/** Pure animation math: every value is a function of time, so any frame can be rendered in isolation. */
export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of `t` through the window [start, end], clamped to 0–1. */
export const seg = (t: number, start: number, end: number) =>
  end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start));

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
export const easeInCubic = (t: number) => t ** 3;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
/** Damped spring settling to 1; `t` in seconds since the spring started. */
export const spring = (t: number, frequency = 2.2, damping = 6) =>
  t <= 0 ? 0 : 1 - Math.exp(-damping * t) * Math.cos(2 * Math.PI * frequency * t);

/** Opacity + upward drift for entrances. */
export function rise(el: HTMLElement | SVGElement, p: number, distance = 18): void {
  const e = easeOutCubic(clamp(p));
  el.style.opacity = String(e);
  el.style.transform = `translateY(${((1 - e) * distance).toFixed(2)}px)`;
}

export function fade(el: HTMLElement | SVGElement, p: number): void {
  el.style.opacity = String(easeOutCubic(clamp(p)).toFixed(3));
}

/** The first share `k` (0–1) of a text, by character (code point), so typing never splits one. */
export function typedPrefix(text: string, k: number): string {
  const chars = [...text];
  return chars.slice(0, Math.floor(chars.length * clamp(k) + 1e-9)).join('');
}

/** Deterministic pseudo-random sequence (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
