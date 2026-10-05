import { type Expression, foxPose, foxSvg } from '@covi/brand';
import type { TimelineVisual } from '../../timeline/types.ts';
import { clamp, easeOutBack, easeOutCubic, lerp, rise, seg, spring } from '../anim.ts';
import { el, fitText } from '../dom.ts';
import { type Component, type ComponentContext, overflows, rectOf } from './types.ts';

type V<K extends TimelineVisual['kind']> = Extract<TimelineVisual, { kind: K }>;

export function title(v: V<'title'>, ctx: ComponentContext, expression: Expression): Component {
  const box = ctx.regions.full;
  const vertical = ctx.timeline.orientation === 'vertical';
  const wrap = el('div', 'title-wrap', ctx.root);
  Object.assign(wrap.style, {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  const foxSize = Math.min(box.width, box.height) * (vertical ? 0.42 : 0.4);
  const fox = ctx.timeline.mascot ? el('div', '', wrap) : undefined;
  if (fox) Object.assign(fox.style, { width: `${foxSize}px`, height: `${foxSize}px` });
  const eyebrow = v.eyebrow ? el('span', 'chip soft', wrap, v.eyebrow) : undefined;
  if (eyebrow) eyebrow.style.fontSize = `${ctx.u(vertical ? 26 : 22)}px`;
  const heading = el('div', 'title-text', wrap, v.title);
  const maxHeight = box.height * (vertical ? 0.3 : 0.28);
  heading.style.maxWidth = `${box.width * (vertical ? 1 : 0.86)}px`;
  fitText(heading, {
    max: ctx.u(vertical ? 86 : 78),
    min: ctx.u(34),
    maxHeight,
    maxWidth: box.width,
  });
  const sub = v.subtitle ? el('div', 'title-sub', wrap, v.subtitle) : undefined;
  if (sub) sub.style.fontSize = `${ctx.u(vertical ? 32 : 28)}px`;
  const meta = el('div', 'title-meta', wrap);
  const chips = v.meta.map((m) => {
    const c = el('span', 'chip muted mono', meta, m);
    c.style.fontSize = `${ctx.u(vertical ? 22 : 19)}px`;
    return c;
  });
  return {
    header: false,
    update({ t, frame, fox: state }) {
      if (fox) {
        const s = spring(t, 1.6, 5.5);
        fox.style.transform = `scale(${lerp(0.82, 1, clamp(s, 0, 1.08)).toFixed(4)})`;
        fox.style.opacity = String(easeOutCubic(seg(t, 0, 0.35)).toFixed(3));
        const pose = foxPose({
          expression,
          t,
          time: frame / ctx.timeline.fps,
          mouth: state.mouth,
          blink: state.blink,
          gaze: { x: 0, y: 0 },
          pointing: false,
          seed: ctx.timeline.seed,
        });
        fox.innerHTML = foxSvg({
          ...pose.fox,
          size: foxSize,
          props: expression !== 'explaining',
        });
      }
      if (eyebrow) rise(eyebrow, seg(t, 0.15, 0.55), ctx.u(14));
      rise(heading, seg(t, 0.25, 0.75), ctx.u(22));
      if (sub) rise(sub, seg(t, 0.4, 0.9), ctx.u(16));
      for (const [i, c] of chips.entries())
        rise(c, seg(t, 0.5 + i * 0.08, 0.9 + i * 0.08), ctx.u(12));
    },
    report: () => [{ role: 'text', rect: rectOf(heading), overflow: overflows(heading) }],
  };
}

const VERDICT = {
  'looks-good': { label: 'Looks good', tone: 'success' as const, expression: 'success' as const },
  'needs-attention': {
    label: 'Needs attention',
    tone: 'accent' as const,
    expression: 'reviewing' as const,
  },
  'needs-changes': {
    label: 'Needs changes',
    tone: 'danger' as const,
    expression: 'warning' as const,
  },
};

export function summary(v: V<'summary'>, ctx: ComponentContext): Component {
  const box = ctx.regions.full;
  const theme = ctx.timeline.theme;
  const vertical = ctx.timeline.orientation !== 'landscape';
  const verdict = VERDICT[v.verdict];
  const color = theme[verdict.tone];
  const foxSize = ctx.timeline.mascot
    ? vertical
      ? Math.min(box.width * 0.4, box.height * 0.27)
      : Math.min(box.height * 0.6, box.width * 0.25)
    : 0;
  const gap = ctx.u(vertical ? 40 : 64);
  const foxBox = el('div', '', ctx.root);
  const panel = el('div', 'card', ctx.root);
  const panelWidth = vertical ? box.width : box.width - foxSize - gap;
  Object.assign(panel.style, {
    position: 'absolute',
    width: `${panelWidth}px`,
    padding: `${ctx.u(vertical ? 48 : 44)}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: `${ctx.u(26)}px`,
  });
  const badge = el('span', 'chip', panel, verdict.label);
  Object.assign(badge.style, {
    alignSelf: 'flex-start',
    background: `${color}22`,
    color,
    fontSize: `${ctx.u(vertical ? 28 : 24)}px`,
  });
  const headline = el('div', 'title-text', panel, v.headline);
  fitText(headline, {
    max: ctx.u(vertical ? 56 : 50),
    min: ctx.u(28),
    maxHeight: ctx.u(vertical ? 220 : 150),
    maxWidth: panelWidth - ctx.u(96),
  });
  const list = el('div', 'summary-points', panel);
  const points = v.points.map((p) => {
    const row = el('div', 'summary-point', list);
    const tick = el('span', 'tick', row, '✓');
    const size = ctx.u(vertical ? 40 : 34);
    Object.assign(tick.style, {
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${size * 0.55}px`,
    });
    el('span', '', row, p).style.fontSize = `${ctx.u(vertical ? 32 : 27)}px`;
    return row;
  });
  const statValues: Array<{ node: HTMLElement; value: number; prefix: string }> = [];
  if (v.stats) {
    const stats = el('div', '', panel);
    Object.assign(stats.style, {
      display: 'flex',
      gap: `${ctx.u(56)}px`,
      marginTop: `${ctx.u(12)}px`,
      paddingTop: `${ctx.u(26)}px`,
      borderTop: `1px solid ${theme.line}`,
    });
    for (const [label, value, prefix, tone] of [
      ['files', v.stats.files, '', theme.text],
      ['added', v.stats.additions, '+', theme.success],
      ['removed', v.stats.deletions, '−', theme.danger],
    ] as const) {
      const s = el('div', 'stat', stats);
      const val = el('div', 'v mono', s, `${prefix}${value}`);
      Object.assign(val.style, { fontSize: `${ctx.u(vertical ? 54 : 46)}px`, color: tone });
      el('div', 'k', s, label).style.fontSize = `${ctx.u(18)}px`;
      statValues.push({ node: val, value, prefix });
    }
  }
  // Center the fox + panel group in the available region.
  const panelHeight = Math.min(
    panel.offsetHeight,
    vertical ? box.height - foxSize - gap : box.height,
  );
  panel.style.maxHeight = `${panelHeight}px`;
  if (vertical) {
    const top = box.y + Math.max(0, (box.height - (foxSize + gap + panelHeight)) / 2);
    Object.assign(foxBox.style, {
      left: `${box.x + (box.width - foxSize) / 2}px`,
      top: `${top}px`,
    });
    Object.assign(panel.style, { left: `${box.x}px`, top: `${top + foxSize + gap}px` });
  } else {
    const groupWidth = foxSize + gap + panelWidth;
    const left = box.x + (box.width - groupWidth) / 2;
    Object.assign(foxBox.style, {
      left: `${left}px`,
      top: `${box.y + (box.height - foxSize) / 2}px`,
    });
    Object.assign(panel.style, {
      left: `${left + foxSize + gap}px`,
      top: `${box.y + (box.height - panelHeight) / 2}px`,
    });
  }
  Object.assign(foxBox.style, {
    position: 'absolute',
    width: `${foxSize}px`,
    height: `${foxSize}px`,
  });
  return {
    header: false,
    update({ t, frame, fox: state }) {
      if (ctx.timeline.mascot) {
        const s = easeOutBack(seg(t, 0, 0.6));
        foxBox.style.transform = `scale(${lerp(0.7, 1, s).toFixed(4)})`;
        foxBox.style.opacity = String(easeOutCubic(seg(t, 0, 0.3)).toFixed(3));
        const pose = foxPose({
          expression: verdict.expression,
          t,
          time: frame / ctx.timeline.fps,
          mouth: state.mouth,
          blink: state.blink,
          gaze: { x: 0, y: 0 },
          pointing: false,
          seed: ctx.timeline.seed,
        });
        foxBox.innerHTML = foxSvg({ ...pose.fox, size: foxSize });
      }
      rise(panel, seg(t, 0.1, 0.6), ctx.u(26));
      rise(badge, seg(t, 0.3, 0.7), ctx.u(10));
      rise(headline, seg(t, 0.35, 0.8), ctx.u(14));
      for (const [i, p] of points.entries())
        rise(p, seg(t, 0.6 + i * 0.15, 1 + i * 0.15), ctx.u(12));
      const count = easeOutCubic(seg(t, 0.6, 1.6));
      for (const s of statValues) s.node.textContent = `${s.prefix}${Math.round(s.value * count)}`;
    },
    report: () => [{ role: 'text', rect: rectOf(panel), overflow: overflows(panel) }],
  };
}
