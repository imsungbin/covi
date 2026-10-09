import { MORPH_PHASES, MORPH_SETTLE, type Span } from '../../timeline/cues.ts';
import type { MorphRow, MorphToken, MorphVisual, Rect, TokenTone } from '../../timeline/types.ts';
import { easeInCubic, easeInOutCubic, easeOutCubic, lerp, rise, seg } from '../anim.ts';
import { lerpRect } from '../canvas.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  entered,
  rectOf,
} from '../components/types.ts';
import { el } from '../dom.ts';
import { union } from '../narrator.ts';
import { codeCard } from '../sizing.ts';

/*
 * A token morph: the hunk's code before the change turns into the code after it. Both layouts are
 * laid out once, at mount (fonts loaded, nothing transformed yet), and every frame places each
 * token between its two boxes: kept tokens travel, removed ones tint and fade with their row as it
 * folds away, added ones slide in as their row opens. Every value is a function of the frame time.
 */

/** A row as laid out, relative to the card: its box, and where its number, mark, and tokens sit. */
interface Laid {
  box: Rect;
  number?: Rect;
  mark: Rect;
  text: Rect;
  tokens: Rect[];
}

/** Where a row of one side sits before and after the morph, and how open it is at each end. */
interface Path {
  from: number;
  to: number;
  /** 1 for a row on both sides; a row on one side only folds away (base) or opens (head). */
  open: Span;
}

/** How far through each of its phases the morph is. */
interface Phase {
  travel: number;
  gone: number;
  arrive: number;
  tint: number;
}

/** How far an added token slides in from, in ems. */
const SLIDE = 0.6;
/** Removed tokens and marks tint over this share of the morph, from its start. */
const TINT = 0.12;

/** The morph's phases `k` (0–1) of the way through it. */
const phaseAt = (k: number): Phase => ({
  travel: easeInOutCubic(seg(k, ...MORPH_PHASES.travel)),
  gone: easeInCubic(seg(k, ...MORPH_PHASES.remove)),
  arrive: easeOutCubic(seg(k, ...MORPH_PHASES.add)),
  tint: seg(k, 0, TINT),
});

/** A token's classes, the same where it is measured and where it is drawn. */
const classes = (token: MorphToken, row: MorphRow) =>
  `tok${token.tone ? ` tk-${token.tone}` : ''}${row.type === 'elided' ? ' elided' : ''}`;

/** The rows laid out as a code card lays out its lines, measured relative to the panel. */
function layOut(rows: readonly MorphRow[], body: HTMLElement, panel: HTMLElement): Laid[] {
  body.replaceChildren();
  const nodes = rows.map((row) => {
    const line = el('div', `ln ${row.type}`, body);
    const gutter = el('span', 'gutter', line);
    const number =
      row.number === undefined ? undefined : el('span', '', gutter, String(row.number));
    const mark = el(
      'span',
      'mark',
      line,
      row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ',
    );
    const txt = el('span', 'txt', line);
    const tokens = row.tokens.map((t) => el('span', classes(t, row), txt, t.text));
    if (!tokens.length) txt.textContent = ' ';
    return { line, number, mark, txt, tokens };
  });
  const origin = panel.getBoundingClientRect();
  const rel = (node: Element): Rect => {
    const r = node.getBoundingClientRect();
    return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
  };
  return nodes.map((n) => ({
    box: rel(n.line),
    ...(n.number ? { number: rel(n.number) } : {}),
    mark: rel(n.mark),
    text: rel(n.txt),
    tokens: n.tokens.map(rel),
  }));
}

/** `a` mixed toward `b` by `k`, for two `#rrggbb` colors; otherwise whichever `k` is nearer. */
function mix(a: string, b: string, k: number): string {
  const hex = /^#([0-9a-f]{6})$/i;
  const [ha, hb] = [hex.exec(a), hex.exec(b)];
  if (!ha || !hb) return k < 0.5 ? a : b;
  const channel = (h: string, i: number) => Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const rgb = [0, 1, 2].map((i) => Math.round(lerp(channel(ha[1]!, i), channel(hb[1]!, i), k)));
  return `rgb(${rgb.join(', ')})`;
}

/**
 * Each row's vertical path, so every frame stacks the card's rows without gaps. A row on both
 * sides travels from its box on one to its box on the other. Between two such rows, the removed
 * rows close up toward the row above them as it travels, and the added rows open below them, where
 * the next row that stays was: heights change linearly, so linear paths keep the stack whole.
 */
function paths(
  laid: readonly Laid[],
  other: readonly Laid[],
  links: ReadonlyMap<number, number>,
  base: boolean,
): Path[] {
  const linked = [...links.keys()].sort((a, b) => a - b);
  const bottom = (row: Laid) => row.box.y + row.box.height;
  // Both layouts start at the same line.
  const top = laid[0]?.box.y ?? 0;
  return laid.map((row, i) => {
    const j = links.get(i);
    if (j !== undefined)
      return base
        ? { from: row.box.y, to: other[j]!.box.y, open: [1, 1] }
        : { from: other[j]!.box.y, to: row.box.y, open: [1, 1] };
    if (base) {
      const above = linked.filter((l) => l < i).at(-1);
      const to = above === undefined ? top : bottom(other[links.get(above)!]!);
      return { from: row.box.y, to, open: [1, 0] };
    }
    const below = linked.find((l) => l > i);
    const last = other.at(-1);
    const from = below !== undefined ? other[links.get(below)!]!.box.y : last ? bottom(last) : top;
    return { from, to: row.box.y, open: [0, 1] };
  });
}

/** An absolutely placed piece of the live card: a token, a line number, a mark, or a row's tint. */
function piece(parent: HTMLElement, className: string, text: string, height: number): HTMLElement {
  const node = el('span', className, parent, text);
  Object.assign(node.style, { height: `${height}px`, lineHeight: `${height}px` });
  return node;
}

/** Puts a piece at `x` and its row at `p`'s place, `travel` of the way along it. */
function position(node: HTMLElement, x: number, p: Path, travel: number): void {
  const y = lerp(p.from, p.to, travel);
  const open = lerp(p.open[0], p.open[1], travel);
  node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)${open < 1 ? ` scaleY(${open.toFixed(4)})` : ''}`;
}

export function morph(v: MorphVisual, ctx: ComponentContext, span: Span): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const panel = el('div', 'code mono tokens', ctx.root);
  const head = el('div', 'code-head', panel);
  el('span', 'dot', head);
  el('span', 'file', head, v.path);
  if (v.language) el('span', '', head, v.language);
  const body = el('div', 'lines', panel);
  // Sized as a code card holding both sides: the longer sets the rows, all lines the width.
  const text = (row: MorphRow) => row.tokens.map((t) => t.text).join('');
  const { font, height, top, padding } = codeCard(
    [...v.base, ...v.head].map(text),
    Math.max(v.base.length, v.head.length),
    box,
    ctx.timeline.orientation,
    ctx.regions.unit,
  );
  body.style.fontSize = `${font}px`;
  // Both sides start at the same line, so the code above the first change stays where it is.
  body.style.paddingTop = `${padding}px`;
  Object.assign(panel.style, {
    left: `${box.x}px`,
    top: `${top}px`,
    width: `${box.width}px`,
    height: `${height}px`,
  });
  const before = layOut(v.base, body, panel);
  const after = layOut(v.head, body, panel);
  body.remove();

  const forward = new Map(v.rows);
  const backward = new Map(v.rows.map(([b, h]) => [h, b] as const));
  const sides = [
    {
      base: true,
      rows: v.base,
      laid: before,
      path: paths(before, after, forward, true),
      links: forward,
      twins: { rows: v.head, laid: after },
      kept: new Set(v.tokens.map(([b, i]) => `${b}:${i}`)),
    },
    {
      base: false,
      rows: v.head,
      laid: after,
      path: paths(after, before, backward, false),
      links: backward,
      twins: { rows: v.base, laid: before },
      kept: new Set(v.tokens.map(([, , h, j]) => `${h}:${j}`)),
    },
  ];
  // Row tints and marks lie under the text; the text stops where a code card's lines end.
  const tints = el('div', 'mrows', panel);
  const live = el('div', 'mlive', panel);
  for (const layer of [tints, live]) layer.style.fontSize = `${font}px`;
  const color = (tone: TokenTone | undefined) => (tone ? theme.syntax[tone] : theme.codeText);
  // Each piece draws itself at the morph's phase; `settle` (0–1) follows the morph.
  const draws: Array<(f: Phase, settle: number) => void> = [];

  for (const { base, rows, laid, path, links, twins, kept } of sides)
    laid.forEach((row, r) => {
      const p = path[r]!;
      const { number, tokens, type } = rows[r]!;
      // A removed row's tint shows as the morph starts, an added row's as it arrives.
      if (type === 'del' || type === 'add') {
        const bar = piece(tints, `mbar ${type}`, '', row.box.height);
        bar.style.width = `${row.box.width}px`;
        const mark = piece(tints, `mmark ${type}`, type === 'add' ? '+' : '−', row.box.height);
        draws.push((f) => {
          const shown = type === 'del' ? Math.min(f.tint, 1 - f.gone) : f.arrive;
          for (const node of [bar, mark]) node.style.opacity = shown.toFixed(3);
          position(bar, row.box.x, p, f.travel);
          position(mark, row.mark.x, p, f.travel);
        });
      }
      // A number both sides share travels once (drawn from the base); others go and come as
      // tokens do.
      const other = links.get(r);
      const twin = other === undefined ? undefined : twins.rows[other]!.number;
      const shared = twin !== undefined && twin === number;
      if (row.number && number !== undefined && (base || !shared)) {
        const n = piece(live, 'mnum', String(number), row.box.height);
        const from = row.number.x;
        const to = shared ? (twins.laid[other!]!.number?.x ?? from) : from;
        draws.push((f) => {
          n.style.opacity = (shared ? 1 : base ? 1 - f.gone : f.arrive).toFixed(3);
          position(n, lerp(from, to, f.travel), p, f.travel);
        });
      }
      // A marker for lines left out is no change: it fades, untinted, when its count changes.
      const tinted = type !== 'elided';
      tokens.forEach((t, i) => {
        if (/^\s*$/u.test(t.text) || kept.has(`${r}:${i}`)) return;
        const x = row.tokens[i]!.x;
        const node = piece(live, classes(t, rows[r]!), t.text, row.box.height);
        node.dataset.token = base ? 'removed' : 'added';
        draws.push((f, settle) => {
          if (base) {
            node.style.opacity = (1 - f.gone).toFixed(3);
            node.style.color =
              tinted && f.tint > 0 ? mix(color(t.tone), theme.delText, f.tint) : '';
            position(node, x, p, f.travel);
          } else {
            node.style.opacity = f.arrive.toFixed(3);
            node.style.color =
              tinted && settle < 1 ? mix(theme.addText, color(t.tone), settle) : '';
            position(node, x - (1 - f.arrive) * SLIDE * font, p, f.travel);
          }
        });
      });
    });

  // Kept tokens last, over everything: drawn once, from the base, travelling to their head box.
  for (const [b, i, h, j] of v.tokens) {
    const token = v.base[b]!.tokens[i]!;
    const [from, to] = [before[b]!.tokens[i]!, after[h]!.tokens[j]!];
    const node = piece(live, classes(token, v.base[b]!), token.text, before[b]!.box.height);
    node.dataset.token = 'kept';
    const p = sides[0]!.path[b]!;
    draws.push((f) => position(node, lerp(from.x, to.x, f.travel), p, f.travel));
  }

  /**
   * The changed lines of one side, relative to the card: from the row's start (its number) to the
   * end of its longest text, so a zoomed camera keeps the start of the lines in view.
   */
  const changed = (laid: readonly Laid[], rows: readonly MorphRow[], type: 'del' | 'add') => {
    const boxes = laid.flatMap((row, r) =>
      rows[r]!.type === type
        ? [
            {
              x: row.box.x,
              y: row.box.y,
              width:
                Math.max(row.text.x + font, ...row.tokens.map((t) => t.x + t.width)) - row.box.x,
              height: row.box.height,
            },
          ]
        : [],
    );
    return boxes.length ? union(boxes) : undefined;
  };
  const removed = changed(before, v.base, 'del');
  const added = changed(after, v.head, 'add');
  const start = removed ?? added ?? before[0]?.box ?? after[0]?.box;
  const end = added ?? removed ?? after[0]?.box ?? start;
  /** Where the changed lines are `t` seconds in, relative to the card. */
  const focus = (t: number) =>
    start && end ? lerpRect(start, end, phaseAt(seg(t, ...span)).travel) : undefined;

  return {
    update(clock) {
      rise(panel, entered(clock, 0, 0.5), ctx.u(30));
      const f = phaseAt(seg(clock.t, ...span));
      const settle = seg(clock.t, span[1], span[1] + MORPH_SETTLE);
      for (const draw of draws) draw(f, settle);
    },
    report: () => [{ role: 'media', rect: rectOf(panel), font: drawnFont(live), text: 'code' }],
    // The narrator points at the changed lines as drawn, wherever the camera has them.
    target: (clock) => {
      const at = focus(clock.t);
      if (!at) return undefined;
      const p = panel.getBoundingClientRect();
      const s = p.width / box.width;
      return { x: p.x + at.x * s, y: p.y + at.y * s, width: at.width * s, height: at.height * s };
    },
    // The camera follows the changed lines as laid out, so it can aim at any frame.
    follow: (t) => {
      const at = focus(t);
      return at && { ...at, x: box.x + at.x, y: top + at.y };
    },
  };
}
