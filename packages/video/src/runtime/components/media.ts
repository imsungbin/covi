import {
  activeStep,
  apiPanels,
  beforeAfterTiming,
  codeHighlights,
  edgeEntrance,
  edgeLabelEntrance,
  findingEntrance,
  HIGHLIGHT_SWEEP,
  interactionTiming,
  morphTiming,
  screenshotMarks,
  screenshotTiming,
  TYPE_TO_OUTPUT,
  terminalStarts,
} from '../../timeline/cues.ts';
import type { Point, Rect, TimelineVisual } from '../../timeline/types.ts';
import { clamp, easeOutCubic, fade, lerp, rise, seg, typedPrefix } from '../anim.ts';
import { el, escapeHtml } from '../dom.ts';
import { center, marksCamera, tourNote } from '../framing.ts';
import { highlightLine } from '../highlight.ts';
import { union } from '../narrator.ts';
import { choreograph, Frame } from './frame.ts';
import {
  type Component,
  type ComponentContext,
  entered,
  type LayoutItem,
  overflows,
  rectOf,
  type SceneClock,
} from './types.ts';

type V<K extends TimelineVisual['kind']> = Extract<TimelineVisual, { kind: K }>;

function chip(
  parent: HTMLElement,
  text: string,
  tone: 'primary' | 'soft' | 'muted',
): HTMLSpanElement {
  return el('span', `chip ${tone}`, parent, text);
}

function frameItems(frames: Frame[]): LayoutItem[] {
  return frames.map((f) => ({ role: 'media' as const, rect: rectOf(f.root) }));
}

/** What a frame highlights, in stage pixels: the focus box, else the click point. */
function frameTarget(
  frame: Frame,
  focus: Rect | undefined,
  click: Point | undefined,
  camera?: ReturnType<Frame['cameraFor']>,
): Rect | undefined {
  if (focus) return frame.map(focus, camera);
  return click ? frame.map({ x: click.x, y: click.y, width: 0, height: 0 }, camera) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------------------------

/**
 * A chip for the storyboard's own text under a frame (a mark's gloss, a step's label): it
 * ellipsizes, and QC checks it for fit.
 */
function noteChip(ctx: ComponentContext): HTMLSpanElement {
  const node = chip(ctx.root, '', 'soft');
  node.classList.add('gloss');
  node.style.position = 'absolute';
  return node;
}

/**
 * Places a note chip just under a frame, from its left edge, so it reads with the capture however
 * narrow it is. It stays in the band reserved under `box`, and never runs past its right edge.
 */
function underFrame(node: HTMLElement, frame: Frame, box: Rect, ctx: ComponentContext): void {
  const v = frame.viewport;
  Object.assign(node.style, {
    left: `${v.x}px`,
    top: `${v.y + v.height + ctx.u(16)}px`,
    maxWidth: `${box.x + box.width - v.x}px`,
  });
}

/** Shows a tour's note in `node`, at its fade. */
function showNote(node: HTMLElement, note: { text: string | undefined; k: number }): void {
  if (node.textContent !== (note.text ?? '')) node.textContent = note.text ?? '';
  fade(node, note.k);
}

export function screenshot(v: V<'screenshot'>, ctx: ComponentContext): Component {
  const marks = v.marks ?? [];
  const media = ctx.regions.media;
  // A gloss sits under the frame, inside the media region, never in the captions' band.
  const glossed = marks.some((m) => m.label);
  const box = glossed ? { ...media, height: media.height - ctx.u(64) } : media;
  const frame = new Frame(ctx.root, box, v.image, {
    chrome: v.device === 'desktop',
    url: v.label,
    u: ctx.u,
  });
  if (!marks.length)
    return {
      update(clock) {
        const { t, duration } = clock;
        rise(frame.root, entered(clock, 0, 0.55), ctx.u(28));
        choreograph(frame, v.focus, v.click, t, screenshotTiming(duration, ctx.phases));
      },
      report: () => [
        ...frameItems([frame]),
        ...(v.focus ? [{ role: 'focus' as const, rect: frame.map(v.focus) }] : []),
      ],
      target: () => frameTarget(frame, v.focus, v.click),
    };
  const gloss = glossed ? noteChip(ctx) : undefined;
  if (gloss) underFrame(gloss, frame, box, ctx);
  const rects = marks.map((m) => m.focus);
  const pose = ({ t, duration }: Pick<SceneClock, 't' | 'duration'>) => {
    const timing = screenshotMarks(duration, marks, ctx.phases);
    return { timing, at: marksCamera(frame.geometry, rects, timing.marks, t) };
  };
  // The region framed in the frame drawn last, for the layout report.
  let framed = rects[0]!;
  return {
    update(clock) {
      const { t } = clock;
      rise(frame.root, entered(clock, 0, 0.55), ctx.u(28));
      const { timing, at } = pose(clock);
      framed = at.focus;
      frame.apply(at.camera);
      frame.spotlight(at.focus, at.from < 0 ? seg(t, ...timing.spot) : 1);
      // The cursor glides from mark to mark, then from the last one to the click.
      if (v.click && t >= timing.move[0])
        frame.pointer(
          v.click,
          seg(t, ...timing.move),
          seg(t, ...timing.press),
          center(rects.at(-1)!),
        );
      else
        frame.pointer(
          center(rects[at.to]!),
          at.k,
          0,
          at.from < 0 ? undefined : center(rects[at.from]!),
        );
      if (gloss)
        showNote(
          gloss,
          tourNote(
            marks.map((m) => m.label),
            timing.marks.map((m) => m.start),
            t,
          ),
        );
    },
    report: () => [
      ...frameItems([frame]),
      { role: 'focus' as const, rect: frame.map(framed) },
      ...(gloss
        ? [{ role: 'text' as const, rect: rectOf(gloss), overflow: overflows(gloss) }]
        : []),
    ],
    target(clock) {
      const { at } = pose(clock);
      return frame.map(at.focus, at.camera);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Before / after
// ---------------------------------------------------------------------------------------------

export function beforeAfter(v: V<'before-after'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const gap = ctx.u(28);
  const labelSpace = ctx.u(54);
  if (v.layout === 'wipe') return wipe(v, ctx);
  const halves: [Rect, Rect] =
    v.layout === 'stack'
      ? [
          {
            x: box.x,
            y: box.y + labelSpace,
            width: box.width,
            height: (box.height - gap) / 2 - labelSpace,
          },
          {
            x: box.x,
            y: box.y + (box.height + gap) / 2 + labelSpace,
            width: box.width,
            height: (box.height - gap) / 2 - labelSpace,
          },
        ]
      : [
          {
            x: box.x,
            y: box.y + labelSpace,
            width: (box.width - gap) / 2,
            height: box.height - labelSpace,
          },
          {
            x: box.x + (box.width + gap) / 2,
            y: box.y + labelSpace,
            width: (box.width - gap) / 2,
            height: box.height - labelSpace,
          },
        ];
  const frames = [
    new Frame(ctx.root, halves[0], v.before, { chrome: false, u: ctx.u }),
    new Frame(ctx.root, halves[1], v.after, { chrome: false, u: ctx.u }),
  ];
  const labels = [
    chip(ctx.root, v.labels.before, 'muted'),
    chip(ctx.root, v.labels.after, 'primary'),
  ];
  labels.forEach((label, i) => {
    const r = frames[i]!.root;
    Object.assign(label.style, {
      position: 'absolute',
      left: r.style.left,
      top: `${Number.parseFloat(r.style.top) - ctx.u(46)}px`,
    });
  });
  return {
    update(clock) {
      const { t, duration } = clock;
      const timing = beforeAfterTiming(v.layout, duration, ctx.phases);
      rise(frames[0]!.root, entered(clock, 0, 0.5), ctx.u(24));
      rise(labels[0]!, entered(clock, 0.05, 0.5), ctx.u(10));
      rise(frames[1]!.root, seg(t, ...timing.reveal), ctx.u(24));
      rise(labels[1]!, seg(t, ...timing.label), ctx.u(10));
      const k = seg(t, ...timing.focus);
      for (const f of frames) {
        f.setCamera(v.focus, k * 0.6, 1.6);
        f.spotlight(v.focus, v.focus ? seg(t, ...timing.spot) : 0);
      }
    },
    report: () => [
      ...frameItems(frames),
      ...(v.focus ? frames.map((f) => ({ role: 'focus' as const, rect: f.map(v.focus!) })) : []),
    ],
    // The change is on the "after" side.
    target: () => frameTarget(frames[1]!, v.focus, undefined),
  };
}

function wipe(v: V<'before-after'>, ctx: ComponentContext): Component {
  const box = {
    ...ctx.regions.media,
    y: ctx.regions.media.y + ctx.u(54),
    height: ctx.regions.media.height - ctx.u(54),
  };
  const after = new Frame(ctx.root, box, v.after, { chrome: false, u: ctx.u });
  const before = new Frame(ctx.root, box, v.before, { chrome: false, u: ctx.u });
  const divider = el('div', '', ctx.root);
  Object.assign(divider.style, {
    position: 'absolute',
    width: `${ctx.u(5)}px`,
    background: ctx.timeline.theme.primary,
    borderRadius: '99px',
    zIndex: '6',
  });
  const labels = [
    chip(ctx.root, v.labels.before, 'muted'),
    chip(ctx.root, v.labels.after, 'primary'),
  ];
  for (const [i, l] of labels.entries()) {
    Object.assign(l.style, {
      position: 'absolute',
      top: `${box.y - ctx.u(48)}px`,
      left: i === 0 ? `${box.x}px` : '',
      right: i === 1 ? `${ctx.timeline.width - box.x - box.width}px` : '',
    });
  }
  return {
    update(clock) {
      const { t, duration } = clock;
      const timing = beforeAfterTiming('wipe', duration, ctx.phases);
      rise(before.root, entered(clock, 0, 0.5), ctx.u(24));
      after.root.style.opacity = before.root.style.opacity;
      fade(labels[0]!, entered(clock, 0.1, 0.5));
      const w = easeOutCubic(seg(t, ...timing.reveal));
      const vp = before.viewport;
      before.root.style.clipPath = `inset(0 0 0 ${(w * 100).toFixed(2)}%)`;
      Object.assign(divider.style, {
        left: `${vp.x + vp.width * w - ctx.u(2.5)}px`,
        top: `${vp.y}px`,
        height: `${vp.height}px`,
        opacity: w > 0.001 && w < 0.999 ? '1' : '0',
      });
      fade(labels[1]!, seg(t, ...timing.label));
      after.spotlight(v.focus, v.focus ? seg(t, ...timing.spot) : 0);
    },
    report: () => frameItems([before]),
    target: () => frameTarget(after, v.focus, undefined),
  };
}

// ---------------------------------------------------------------------------------------------
// Interaction: a sequence of screenshots with cursor and click emphasis
// ---------------------------------------------------------------------------------------------

/** How far an interaction step zooms toward its focus or its marks: less than a screenshot. */
const STEP_ZOOM = 1.5;

export function interaction(v: V<'interaction'>, ctx: ComponentContext): Component {
  const box = { ...ctx.regions.media, height: ctx.regions.media.height - ctx.u(64) };
  const frames = v.steps.map((s) => new Frame(ctx.root, box, s.image, { chrome: true, u: ctx.u }));
  // The step's number, then its label or the gloss of the mark the camera is on.
  const label = noteChip(ctx);
  const count = el('span', '', label);
  const note = el('span', '', label);
  const marks = v.steps.map((s) => s.marks?.map((m) => m.focus));
  /**
   * Where the cursor waits as a step opens: where the step before left it, on its click, else on
   * its last mark; with neither, it comes in from the corner.
   */
  const waiting = (i: number) => {
    const click = v.steps[i - 1]?.click;
    const prior = marks[i - 1]?.at(-1);
    return click ?? (prior ? center(prior) : undefined);
  };
  const timingOf = (duration: number) =>
    interactionTiming(
      duration,
      v.steps.length,
      ctx.phases,
      v.steps.map((s) => s.marks),
    );
  return {
    update(clock) {
      const { t, duration } = clock;
      const timing = timingOf(duration);
      const active = activeStep(timing, t);
      const since = t - timing[active]!.start;
      frames.forEach((f, i) => {
        const step = timing[i]!;
        // The previous step stays underneath while the next one fades in on top.
        if (i === active) {
          const enter = i === 0 ? entered(clock, 0, 0.45) : seg(t, step.start, step.start + 0.3);
          f.root.style.opacity = String(easeOutCubic(enter).toFixed(3));
        } else f.root.style.opacity = i === active - 1 && since < 0.3 ? '1' : '0';
        if (i !== active) {
          f.hideOverlays();
          return;
        }
        const shown = v.steps[i]!;
        const rects = marks[i];
        if (rects && step.marks) {
          const at = marksCamera(f.geometry, rects, step.marks, t, STEP_ZOOM);
          f.apply(at.camera);
          f.spotlight(at.focus, (at.from < 0 ? seg(t, ...step.spot) : 1) * 0.8);
          if (shown.click && t >= step.move[0])
            f.pointer(
              shown.click,
              seg(t, ...step.move),
              seg(t, ...step.press),
              center(rects.at(-1)!),
            );
          else
            f.pointer(
              center(rects[at.to]!),
              at.k,
              0,
              at.from < 0 ? waiting(i) : center(rects[at.from]!),
            );
        } else {
          f.setCamera(shown.focus, seg(t, ...step.zoom) * 0.7, STEP_ZOOM);
          f.spotlight(shown.focus, shown.focus ? seg(t, ...step.spot) * 0.8 : 0);
          f.pointer(shown.click, seg(t, ...step.move), seg(t, ...step.press));
        }
      });
      const shown = v.steps[active]!;
      underFrame(label, frames[active]!, box, ctx);
      count.textContent = `${active + 1}/${v.steps.length}`;
      // Once the camera heads for a mark with a gloss, the gloss stands in for the step's label.
      const tour = timing[active]!.marks;
      const now = tour
        ? tourNote(
            shown.marks!.map((m) => m.label ?? shown.label),
            tour.map((m) => m.start),
            t,
            shown.label,
          )
        : { text: shown.label, k: 1 };
      showNote(note, { ...now, text: now.text && `  ${now.text}` });
      fade(label, active === 0 ? entered(clock, 0, 0.3) : seg(since, 0, 0.3));
    },
    report: () => [
      ...frameItems(frames.slice(0, 1)),
      { role: 'text' as const, rect: rectOf(label), overflow: overflows(label) },
    ],
    target({ t, duration }) {
      const timing = timingOf(duration);
      // Each step's camera recomputed for this moment, so no frame depends on an earlier one.
      const of = (i: number) => {
        const shown = v.steps[i]!;
        const rects = marks[i];
        if (rects && timing[i]!.marks) {
          const at = marksCamera(frames[i]!.geometry, rects, timing[i]!.marks!, t, STEP_ZOOM);
          return frameTarget(frames[i]!, at.focus, undefined, at.camera);
        }
        const camera = frames[i]!.cameraFor(
          shown.focus,
          seg(t, ...timing[i]!.zoom) * 0.7,
          STEP_ZOOM,
        );
        return frameTarget(frames[i]!, shown.focus, shown.click, camera);
      };
      const active = activeStep(timing, t);
      const now = of(active);
      const prev = active > 0 ? of(active - 1) : undefined;
      // Glide from the previous step's target to this one's, so the tail never jumps at a cut.
      const start = timing[active]!.start;
      const k = easeOutCubic(seg(t, start, start + 0.4));
      if (!prev || !now || k >= 1) return now ?? prev;
      return {
        x: lerp(prev.x, now.x, k),
        y: lerp(prev.y, now.y, k),
        width: lerp(prev.width, now.width, k),
        height: lerp(prev.height, now.height, k),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Code callout
// ---------------------------------------------------------------------------------------------

/** A deleted line's ghost after a morph: still readable, clearly gone. */
const GHOST = 0.4;

/**
 * The order rows are drawn in. In a morph each added line sits directly under the deleted line
 * it replaces (the k-th added line of a change under its k-th deleted line), so it types in where
 * the old code was; lines a change adds or deletes beyond those pairs follow them.
 */
function morphOrder(lines: V<'code'>['lines']): number[] {
  const order: number[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.type === 'context') {
      order.push(i++);
      continue;
    }
    const deleted: number[] = [];
    const added: number[] = [];
    for (; i < lines.length && lines[i]!.type !== 'context'; i++)
      (lines[i]!.type === 'del' ? deleted : added).push(i);
    for (let k = 0; k < Math.max(deleted.length, added.length); k++) {
      if (k < deleted.length) order.push(deleted[k]!);
      if (k < added.length) order.push(added[k]!);
    }
  }
  return order;
}

export function code(v: V<'code'>, ctx: ComponentContext): Component {
  const vertical = ctx.timeline.orientation === 'vertical';
  // The caption sits under the card, inside the media region, so the captions' band stays clear.
  const band = v.caption ? ctx.u(vertical ? 96 : 72) : 0;
  const gap = ctx.u(12);
  const box = { ...ctx.regions.media, height: ctx.regions.media.height - band };
  const morph = v.mode === 'morph';
  const panel = el('div', morph ? 'code mono morph' : 'code mono', ctx.root);
  const head = el('div', 'code-head', panel);
  el('span', 'dot', head);
  el('span', 'file', head, v.path);
  if (v.language) el('span', '', head, v.language);
  const body = el('div', 'lines', panel);
  const lit = new Set(v.highlight);
  const rows = v.lines.map((line, i) => {
    const row = el('div', `ln ${line.type}`, body);
    el('span', 'gutter', row, line.number !== undefined ? String(line.number) : '');
    const mark = el(
      'span',
      'mark',
      row,
      line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ',
    );
    const txt = el('span', 'txt', row);
    txt.innerHTML = highlightLine(line.text, v.language) || ' ';
    const strike = morph && line.type === 'del' ? el('div', 'strike', row) : undefined;
    const hl = lit.has(i) ? el('div', 'hl', row) : undefined;
    // What the typed text last drew, so a frame redraws a line only when it changed.
    return { row, mark, txt, strike, hl, drawn: '', place: i };
  });
  if (morph)
    morphOrder(v.lines).forEach((i, place) => {
      body.append(rows[i]!.row);
      rows[i]!.place = place;
    });
  // Size code by its typical (90th percentile) line so one long line does not shrink everything;
  // longer lines end in an ellipsis rather than wrapping.
  const lengths = v.lines.map((l) => l.text.length + 7).sort((a, b) => a - b);
  const typical = Math.max(28, lengths[Math.floor((lengths.length - 1) * 0.9)] ?? 28);
  const fontByWidth = (box.width - ctx.u(40)) / (typical * 0.61);
  const fontByHeight = (box.height - ctx.u(90)) / (v.lines.length * 1.55 + 1.2);
  const font = clamp(Math.min(fontByWidth, fontByHeight), ctx.u(16), ctx.u(34));
  body.style.fontSize = `${font}px`;
  const height = Math.min(box.height, v.lines.length * font * 1.55 + font * 1.2 + ctx.u(66));
  Object.assign(panel.style, {
    left: `${box.x}px`,
    top: `${box.y + (box.height - height) / 2}px`,
    width: `${box.width}px`,
    height: `${height}px`,
  });
  const caption = v.caption ? el('div', 'code-caption', ctx.root, v.caption) : undefined;
  if (caption)
    Object.assign(caption.style, {
      left: `${box.x}px`,
      top: `${box.y + (box.height + height) / 2 + gap}px`,
      width: `${box.width}px`,
      maxHeight: `${band - gap}px`,
      fontSize: `${ctx.u(vertical ? 28 : 23)}px`,
    });
  return {
    update(clock) {
      const { t, duration } = clock;
      rise(panel, entered(clock, 0, 0.5), ctx.u(30));
      if (caption) rise(caption, entered(clock, 0.2, 0.6), ctx.u(12));
      const swap = morph ? morphTiming(duration, v.lines, ctx.phases) : undefined;
      const starts = codeHighlights(v, duration, ctx.phases);
      rows.forEach((r, i) => {
        const typing = swap?.typing.get(i);
        if (typing) {
          // An added line opens under the deleted one it replaces, then types in behind a caret.
          const open = easeOutCubic(seg(t, typing[0], typing[0] + 0.15));
          r.row.style.height = `${(open * 1.55).toFixed(4)}em`;
          r.row.style.opacity = open.toFixed(3);
          const k = seg(t, ...typing);
          const text = typedPrefix(v.lines[i]!.text, k);
          const caret = k > 0 && k < 1;
          const key = `${text.length}${caret ? '|' : ''}`;
          if (key !== r.drawn) {
            r.drawn = key;
            r.txt.innerHTML =
              (highlightLine(text, v.language) || ' ') +
              (caret ? '<span class="caret"></span>' : '');
          }
        } else {
          fade(r.row, entered(clock, 0.15 + r.place * 0.035, 0.45 + r.place * 0.035));
          if (swap && r.strike) {
            // Struck through over the first 60% of the strike, then faded to a ghost. Before it,
            // the line reads as the old code: no tint and no "−".
            const k = seg(t, ...swap.strike);
            r.strike.style.transform = `scaleX(${easeOutCubic(seg(k, 0, 0.6)).toFixed(4)})`;
            r.txt.style.opacity = lerp(1, GHOST, easeOutCubic(seg(k, 0.6, 1))).toFixed(3);
            r.row.classList.toggle('struck', k > 0);
            r.mark.textContent = k > 0 ? '−' : ' ';
          }
        }
        if (r.hl) {
          // A row has `hl` exactly when its index is highlighted, so it has a start.
          const start = starts.get(i)!;
          const k = easeOutCubic(seg(t, start, start + HIGHLIGHT_SWEEP));
          r.hl.style.transform = `scaleX(${k.toFixed(4)})`;
          r.hl.style.opacity = String(k.toFixed(3));
        }
      });
    },
    report: () => [
      { role: 'media', rect: rectOf(panel) },
      ...(caption
        ? [{ role: 'text' as const, rect: rectOf(caption), overflow: overflows(caption) }]
        : []),
    ],
    target: () => {
      const highlighted = rows.filter((r) => r.hl).map((r) => rectOf(r.row));
      return highlighted.length ? union(highlighted) : undefined;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------------------------

function terminalWindow(
  parent: HTMLElement,
  rect: Rect,
  label: string,
  command: string,
  output: string,
  ctx: ComponentContext,
) {
  const win = el('div', 'term mono', parent);
  Object.assign(win.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px` });
  const head = el('div', 'term-head', win);
  for (const color of ['#FF5F57', '#FEBC2E', '#28C840']) el('i', '', head).style.background = color;
  el('span', 'label', head, label);
  const body = el('div', 'term-body', win);
  const lines = output.split('\n');
  const longest = Math.max(command.length + 2, ...lines.map((l) => l.length), 24);
  const font = clamp(
    Math.min(
      (rect.width - ctx.u(40)) / (longest * 0.61),
      (rect.height - ctx.u(70)) / ((lines.length + 1.5) * 1.5),
    ),
    ctx.u(13),
    ctx.u(ctx.timeline.orientation === 'vertical' ? 30 : 26),
  );
  body.style.fontSize = `${font}px`;
  // The window fits its content (centered in its slot) instead of leaving an empty black box.
  const contentHeight = (lines.length + 1) * font * 1.5 + ctx.u(32) + ctx.u(44);
  const height = Math.min(rect.height, Math.max(ctx.u(180), contentHeight));
  win.style.height = `${height}px`;
  win.style.top = `${rect.y + (rect.height - height) / 2}px`;
  const prompt = el('div', '', body);
  prompt.innerHTML = '<span class="prompt">$ </span><span class="cmd"></span>';
  const cmd = prompt.querySelector('.cmd') as HTMLSpanElement;
  const outLines = lines.map((l) => el('div', 'out', body, l || ' '));
  return {
    win,
    play(t: number, start: number) {
      const typed = Math.floor(command.length * seg(t, start, start + 0.6));
      cmd.textContent = command.slice(0, typed);
      for (const [i, line] of outLines.entries())
        fade(
          line,
          seg(t, start + TYPE_TO_OUTPUT + i * 0.06, start + TYPE_TO_OUTPUT + 0.15 + i * 0.06),
        );
    },
  };
}

export function terminal(v: V<'terminal'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const gap = ctx.u(26);
  const windows: Array<ReturnType<typeof terminalWindow>> = [];
  if (v.before !== undefined) {
    const vertical = ctx.timeline.orientation !== 'landscape';
    const a = vertical
      ? { ...box, height: (box.height - gap) / 2 }
      : { ...box, width: (box.width - gap) / 2 };
    const b = vertical ? { ...a, y: box.y + a.height + gap } : { ...a, x: box.x + a.width + gap };
    windows.push(
      terminalWindow(
        ctx.root,
        a,
        ctx.timeline.labels?.before ?? 'Before',
        v.command,
        v.before,
        ctx,
      ),
      terminalWindow(ctx.root, b, ctx.timeline.labels?.after ?? 'After', v.command, v.output, ctx),
    );
  } else {
    windows.push(
      terminalWindow(
        ctx.root,
        box,
        v.title ?? ctx.timeline.labels?.terminal ?? 'Terminal',
        v.command,
        v.output,
        ctx,
      ),
    );
  }
  return {
    update(clock) {
      const { t, duration } = clock;
      const starts = terminalStarts(duration, windows.length, ctx.phases);
      windows.forEach((w, i) => {
        const start = starts[i]!;
        // The first window is up from the start; a phase only moves when its command is typed.
        rise(w.win, i === 0 ? entered(clock, 0, 0.5) : seg(t, start - 0.2, start + 0.3), ctx.u(24));
        w.play(t, start);
      });
    },
    report: () => windows.map((w) => ({ role: 'media' as const, rect: rectOf(w.win) })),
  };
}

// ---------------------------------------------------------------------------------------------
// API request / response
// ---------------------------------------------------------------------------------------------

/** Line-level LCS diff, small inputs only (responses are clipped before they get here). */
export function diffLines(
  a: string[],
  b: string[],
): { left: Array<'same' | 'del'>; right: Array<'same' | 'add'> } {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const left = new Array<'same' | 'del'>(n).fill('del');
  const right = new Array<'same' | 'add'>(m).fill('add');
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      left[i] = 'same';
      right[j] = 'same';
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return { left, right };
}

export function api(v: V<'api'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const req = el('div', 'api-req mono', ctx.root);
  el('span', 'method', req, v.method);
  el('span', 'path', req, v.path);
  const reqHeight = ctx.u(64);
  req.style.fontSize = `${ctx.u(ctx.timeline.orientation === 'vertical' ? 30 : 26)}px`;
  Object.assign(req.style, { left: `${box.x}px`, top: `${box.y}px`, height: `${reqHeight}px` });
  const area = {
    x: box.x,
    y: box.y + reqHeight + ctx.u(22),
    width: box.width,
    height: box.height - reqHeight - ctx.u(22),
  };
  const gap = ctx.u(24);
  const afterLines = v.after.body.split('\n');
  const beforeLines = v.before?.body.split('\n') ?? [];
  const marks = v.before ? diffLines(beforeLines, afterLines) : undefined;
  const panels: HTMLDivElement[] = [];
  const make = (rect: Rect, title: string, status: number, lines: string[], kinds?: string[]) => {
    const panel = el('div', 'api-panel card', ctx.root);
    Object.assign(panel.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const head = el('div', 'api-head', panel);
    el('span', '', head, title).style.fontWeight = '700';
    const badge = el('span', 'status mono', head, String(status));
    badge.style.background = status < 300 ? theme.addBackground : theme.delBackground;
    badge.style.color = status < 300 ? theme.success : theme.danger;
    const pre = el('pre', 'mono', panel);
    const longest = Math.max(24, ...lines.map((l) => l.length));
    pre.style.fontSize = `${clamp(Math.min((rect.width - ctx.u(44)) / (longest * 0.61), (rect.height - ctx.u(80)) / (lines.length * 1.5 + 1)), ctx.u(13), ctx.u(24))}px`;
    pre.innerHTML = lines
      .map((l, i) => {
        // The "… N more lines" marker from clipping (in any language) is a note, not JSON.
        const html = /^… /.test(l)
          ? `<span class="tk-comment">${escapeHtml(l)}</span>`
          : highlightLine(l, 'json') || ' ';
        const kind = kinds?.[i];
        return kind === 'add' || kind === 'del'
          ? `<span class="${kind}">${html}</span>`
          : `${html}\n`;
      })
      .join('');
    panels.push(panel);
    return panel;
  };
  if (v.before) {
    const vertical = ctx.timeline.orientation !== 'landscape';
    const a = vertical
      ? { ...area, height: (area.height - gap) / 2 }
      : { ...area, width: (area.width - gap) / 2 };
    const b = vertical ? { ...a, y: area.y + a.height + gap } : { ...a, x: area.x + a.width + gap };
    make(a, ctx.timeline.labels?.before ?? 'Before', v.before.status, beforeLines, marks!.left);
    make(b, ctx.timeline.labels?.after ?? 'After', v.after.status, afterLines, marks!.right);
  } else {
    make(area, ctx.timeline.labels?.response ?? 'Response', v.after.status, afterLines);
  }
  return {
    update(clock) {
      const { t, duration } = clock;
      rise(req, entered(clock, 0, 0.4), ctx.u(16));
      const spans = apiPanels(duration, panels.length, ctx.phases);
      // The first panel (the only response, or the before panel) is the subject; the after
      // panel is choreography and rises on time.
      for (const [i, p] of panels.entries())
        rise(p, i === 0 ? entered(clock, ...spans[0]!) : seg(t, ...spans[i]!), ctx.u(24));
    },
    report: () => [
      { role: 'media', rect: rectOf(req) },
      ...panels.map((p) => ({ role: 'media' as const, rect: rectOf(p) })),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

const CERTAINTY_LABEL = {
  confirmed: 'Confirmed issue',
  likely: 'Likely issue',
  risk: 'Risk worth checking',
  question: 'Question',
} as const;

export function findings(v: V<'findings'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const vertical = ctx.timeline.orientation === 'vertical';
  const color = {
    confirmed: theme.danger,
    likely: theme.accent,
    risk: theme.primary,
    question: theme.textMuted,
  };
  const gap = ctx.u(24);
  const maxCard = (box.height - gap * (v.findings.length - 1)) / v.findings.length;
  const cards = v.findings.map((f) => {
    const card = el('div', 'finding card', ctx.root);
    Object.assign(card.style, {
      left: `${box.x}px`,
      width: `${box.width}px`,
      maxHeight: `${maxCard}px`,
    });
    el('div', 'bar', card).style.background = color[f.certainty];
    const body = el('div', 'body', card);
    const meta = el('div', 'meta', body);
    const labels = ctx.timeline.labels;
    const c = chip(meta, labels?.certainty[f.certainty] ?? CERTAINTY_LABEL[f.certainty], 'soft');
    c.style.color = color[f.certainty];
    c.style.background = `${color[f.certainty]}1F`;
    chip(meta, labels?.severity[f.severity] ?? `${f.severity} severity`, 'muted');
    const title = el('div', 'ftitle', body, f.title);
    title.style.fontSize = `${ctx.u(vertical ? 38 : 32)}px`;
    if (f.location)
      el('div', 'loc mono', body, f.location).style.fontSize = `${ctx.u(vertical ? 22 : 20)}px`;
    if (f.note) el('div', 'note', body, f.note).style.fontSize = `${ctx.u(vertical ? 27 : 23)}px`;
    return { card, body };
  });
  // Cards size to their content and the stack is centered in the media region.
  const heights = cards.map(({ card }) => Math.min(maxCard, card.offsetHeight));
  const total = heights.reduce((a, b) => a + b, 0) + gap * (cards.length - 1);
  let y = box.y + Math.max(0, (box.height - total) / 2);
  cards.forEach(({ card }, i) => {
    card.style.top = `${y}px`;
    y += heights[i]! + gap;
  });
  return {
    update({ t }) {
      cards.forEach(({ card }, i) => {
        const e = easeOutCubic(seg(t, ...findingEntrance(i, ctx.phases)));
        card.style.opacity = String(e.toFixed(3));
        card.style.transform = `translateX(${((1 - e) * ctx.u(60)).toFixed(2)}px)`;
      });
    },
    report: () =>
      cards.map(({ card, body }) => ({
        role: 'text' as const,
        rect: rectOf(card),
        overflow: overflows(body),
      })),
    // The first finding is the one the narration leads with.
    target: () => (cards[0] ? rectOf(cards[0].card) : undefined),
  };
}

// ---------------------------------------------------------------------------------------------
// Change map
// ---------------------------------------------------------------------------------------------

export function changeMap(v: V<'change-map'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const rows = v.areas.slice(0, 6);
  const rowHeight = Math.min(
    ctx.u(ctx.timeline.orientation === 'vertical' ? 150 : 96),
    box.height / rows.length,
  );
  const top = box.y + (box.height - rowHeight * rows.length) / 2;
  const max = Math.max(1, ...rows.map((a) => a.additions + a.deletions));
  const items = rows.map((area, i) => {
    const row = el('div', 'area-row card', ctx.root);
    Object.assign(row.style, {
      left: `${box.x}px`,
      top: `${top + i * rowHeight}px`,
      width: `${box.width}px`,
      height: `${rowHeight - ctx.u(14)}px`,
      padding: `0 ${ctx.u(26)}px`,
    });
    const name = el('div', 'name mono', row, area.name);
    name.style.fontSize = `${ctx.u(ctx.timeline.orientation === 'vertical' ? 28 : 24)}px`;
    name.style.width = `${box.width * (ctx.timeline.orientation === 'vertical' ? 0.42 : 0.3)}px`;
    if (area.surface) chip(row, area.surface, 'soft');
    const bars = el('div', 'bars', row);
    const plus = el('div', 'plus', bars);
    const minus = el('div', 'minus', bars);
    plus.style.width = `${(area.additions / max) * 100}%`;
    minus.style.width = `${(area.deletions / max) * 100}%`;
    const nums = el('div', 'nums mono', row);
    nums.innerHTML = `<span style="color:${theme.success}">+${area.additions}</span> <span style="color:${theme.danger}">−${area.deletions}</span>`;
    nums.style.fontSize = `${ctx.u(22)}px`;
    return { row, plus, minus };
  });
  return {
    update(clock) {
      items.forEach(({ row, plus, minus }, i) => {
        rise(row, entered(clock, 0.1 + i * 0.12, 0.5 + i * 0.12), ctx.u(18));
        const g = easeOutCubic(entered(clock, 0.4 + i * 0.12, 1.1 + i * 0.12));
        plus.style.transform = `scaleX(${g.toFixed(4)})`;
        minus.style.transform = `scaleX(${g.toFixed(4)})`;
      });
    },
    report: () => items.map(({ row }) => ({ role: 'media' as const, rect: rectOf(row) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------------------------

export function callout(v: V<'callout'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const tone = { info: theme.primary, warning: theme.accent, success: theme.success }[v.tone];
  const card = el('div', 'callout card', ctx.root);
  const width = Math.min(box.width, ctx.u(ctx.timeline.orientation === 'vertical' ? 940 : 1100));
  Object.assign(card.style, { left: `${box.x + (box.width - width) / 2}px`, width: `${width}px` });
  const icon = el(
    'div',
    'icon',
    card,
    v.tone === 'success' ? '✓' : v.tone === 'warning' ? '!' : 'i',
  );
  const size = ctx.u(96);
  Object.assign(icon.style, {
    width: `${size}px`,
    height: `${size}px`,
    background: tone,
    fontSize: `${size * 0.5}px`,
  });
  const title = el('div', 'ctitle', card, v.title);
  title.style.fontSize = `${ctx.u(ctx.timeline.orientation === 'vertical' ? 46 : 40)}px`;
  const body = v.body ? el('div', 'cbody', card, v.body) : undefined;
  if (body) body.style.fontSize = `${ctx.u(ctx.timeline.orientation === 'vertical' ? 30 : 26)}px`;
  card.style.top = `${box.y + (box.height - card.offsetHeight) / 2}px`;
  return {
    update(clock) {
      const e = easeOutCubic(entered(clock, 0, 0.55));
      card.style.opacity = String(e.toFixed(3));
      card.style.transform = `scale(${lerp(0.94, 1, e).toFixed(4)})`;
      icon.style.transform = `scale(${lerp(0.6, 1, easeOutCubic(entered(clock, 0.15, 0.6))).toFixed(4)})`;
    },
    report: () => [{ role: 'text', rect: rectOf(card), overflow: overflows(card) }],
  };
}

// ---------------------------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------------------------

export function diagram(v: V<'diagram'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const perRow = ctx.timeline.orientation === 'vertical' ? 2 : Math.min(4, v.nodes.length);
  const rowsCount = Math.ceil(v.nodes.length / perRow);
  const gapX = ctx.u(70);
  const gapY = ctx.u(80);
  const nodeW = (box.width - gapX * (perRow - 1)) / perRow;
  const nodeH = Math.min(ctx.u(170), (box.height - gapY * (rowsCount - 1)) / rowsCount);
  const totalH = rowsCount * nodeH + (rowsCount - 1) * gapY;
  const vertical = ctx.timeline.orientation === 'vertical';
  const positions = new Map<string, Rect>();
  const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svgLayer.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${ctx.timeline.width}px`,
    height: `${ctx.timeline.height}px`,
    overflow: 'visible',
  });
  ctx.root.appendChild(svgLayer);
  const nodes = v.nodes.map((n, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, v.nodes.length - row * perRow);
    const offset = (box.width - (inRow * nodeW + (inRow - 1) * gapX)) / 2;
    const rect = {
      x: box.x + offset + (i % perRow) * (nodeW + gapX),
      y: box.y + (box.height - totalH) / 2 + row * (nodeH + gapY),
      width: nodeW,
      height: nodeH,
    };
    positions.set(n.id, rect);
    const node = el('div', `node${n.changed ? ' changed' : ''}`, ctx.root);
    Object.assign(node.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const label = el('div', 'nlabel mono', node, n.label);
    label.style.fontSize = `${ctx.u(vertical ? 28 : 24)}px`;
    if (n.detail) el('div', 'ndetail mono', node, n.detail).style.fontSize = `${ctx.u(19)}px`;
    return node;
  });
  // An edge keeps its index in `v.edges` even after one that names a missing node, so its timing
  // matches settledAt's (see edgeEntrance).
  const edges = v.edges.flatMap((e, index) => {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) return [];
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const [x1, y1, x2, y2] = [
      a.x + a.width / 2,
      a.y + a.height / 2,
      b.x + b.width / 2,
      b.y + b.height / 2,
    ];
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', ctx.timeline.theme.primary);
    line.setAttribute('stroke-width', String(ctx.u(4)));
    line.setAttribute('stroke-linecap', 'round');
    const length = Math.hypot(x2 - x1, y2 - y1);
    line.setAttribute('stroke-dasharray', String(length));
    svgLayer.appendChild(line);
    // The label sits on the line's midpoint, between the two nodes, above them.
    const label = e.label ? el('div', 'edge-label', ctx.root, e.label) : undefined;
    if (label) {
      Object.assign(label.style, {
        fontSize: `${ctx.u(vertical ? 20 : 18)}px`,
        maxWidth: `${Math.max(gapX, nodeW * 0.6)}px`,
        zIndex: '2',
      });
      label.style.left = `${(x1 + x2) / 2 - label.offsetWidth / 2}px`;
      label.style.top = `${(y1 + y2) / 2 - label.offsetHeight / 2}px`;
    }
    return [{ line, length, label, index }];
  });
  svgLayer.style.zIndex = '0';
  for (const n of nodes) n.style.zIndex = '1';
  return {
    update(clock) {
      for (const [i, n] of nodes.entries())
        rise(n, entered(clock, 0.1 + i * 0.1, 0.5 + i * 0.1), ctx.u(18));
      for (const { line, length, label, index } of edges) {
        line.setAttribute(
          'stroke-dashoffset',
          String(length * (1 - easeOutCubic(entered(clock, ...edgeEntrance(index))))),
        );
        if (label) fade(label, entered(clock, ...edgeLabelEntrance(index)));
      }
    },
    report: () => [
      ...nodes.map((n) => ({ role: 'text' as const, rect: rectOf(n), overflow: overflows(n) })),
      ...edges.flatMap(({ label }) =>
        label ? [{ role: 'text' as const, rect: rectOf(label), overflow: overflows(label) }] : [],
      ),
    ],
    target: () => {
      const changed = v.nodes.findIndex((n) => n.changed);
      return changed >= 0 ? rectOf(nodes[changed]!) : undefined;
    },
  };
}
