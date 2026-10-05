import { blendPoses, type FoxOptions, foxPose, foxSvg, wordmarkParts } from '@covi/brand';
import { outroSettle } from '../../timeline/cues.ts';
import type { Rect, TimelineVisual } from '../../timeline/types.ts';
import { clamp, easeInOutCubic, easeOutCubic, lerp, rise, seg, spring } from '../anim.ts';
import { el, fitText, SVG_NS, svg } from '../dom.ts';
import { type Component, type ComponentContext, overflows, rectOf } from './types.ts';

type V = Extract<TimelineVisual, { kind: 'outro' }>;

const VERDICT_TONE = {
  'looks-good': 'success',
  'needs-attention': 'accent',
  'needs-changes': 'danger',
} as const;

/** The stacked logo's proportions (packages/brand/src/logo.ts): the fox box is 1.364 words wide. */
const FOX_PER_WORD = 1.364;
/** Room between the fox's box and the top of the ▶, as a share of the box (as in the logo). */
const LOCKUP_GAP = 0.02;
/** How long the fox takes to cross from the card before to its place over the word. */
const GLIDE = 0.6;

/** 0 → about 1.1 → 1: the ▶ pops in about its center. */
const pop = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2);

const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  width: lerp(a.width, b.width, k),
  height: lerp(a.height, b.height, k),
});

/**
 * Covi's outro: the stacked logo comes together and signs off. The fox from the summary card
 * glides to center stage, its face easing from the verdict back to its calm smile (a card
 * without a large fox has the fox settle in instead). It glances down while "covi" writes itself
 * in letter by letter, and looks back up as the card settles: the ▶ over the i lands with the
 * sonic logo, and the tail gives one flick. The verdict and the sign-off line sit under the logo.
 * Every value is a function of the frame; the settle moment comes from `outroSettle`, where the
 * music lands too.
 */
export function outro(v: V, ctx: ComponentContext): Component {
  const tl = ctx.timeline;
  const theme = tl.theme;
  const u = ctx.u;
  const vertical = tl.orientation === 'vertical';
  const short = Math.min(tl.width, tl.height);
  const settle = outroSettle();
  const labels = tl.labels;

  // The fox box, then the word in the stacked logo's proportions. Without the mascot the word
  // alone carries the card, so it is drawn larger.
  const foxSize = tl.mascot ? short * (vertical ? 0.6 : 0.4) : 0;
  const wordWidth = tl.mascot ? foxSize / FOX_PER_WORD : short * (vertical ? 0.6 : 0.42);
  const parts = wordmarkParts();
  const scale = wordWidth / parts.width;
  const wordHeight = (parts.bottom - parts.top) * scale;
  const gap = foxSize * LOCKUP_GAP;

  const wrap = el('div', 'outro', ctx.root);
  const fox = tl.mascot ? el('div', 'outro-fox', wrap) : undefined;
  const word = svg('svg', {
    viewBox: `0 ${parts.top} ${parts.width} ${parts.bottom - parts.top}`,
    width: wordWidth,
    height: wordHeight,
    overflow: 'visible',
    role: 'img',
    class: 'outro-word',
  });
  const name = document.createElementNS(SVG_NS, 'title');
  name.textContent = 'Covi';
  word.appendChild(name);
  wrap.appendChild(word);
  const letters = parts.letters.map((l) => {
    const g = svg('g', {}, word);
    svg('path', { d: l.d, fill: theme.text, transform: `translate(${l.x} 0)` }, g);
    return g;
  });
  const play = svg('g', {}, word);
  svg(
    'path',
    {
      d: `M${parts.play.points.map(([x, y]) => `${x} ${y}`).join(' L')} Z`,
      fill: theme.primary,
      stroke: theme.primary,
      'stroke-width': parts.play.stroke,
      'stroke-linejoin': 'round',
    },
    play,
  );

  // The verdict and the sign-off, on one line under the logo.
  const row = el('div', 'outro-row', wrap);
  const chip = v.verdict
    ? el('span', 'chip', row, labels?.verdict[v.verdict] ?? v.verdict)
    : undefined;
  if (chip && v.verdict) {
    const color = theme[VERDICT_TONE[v.verdict]];
    Object.assign(chip.style, { background: `${color}22`, color });
  }
  const line = el('span', 'outro-line', row, labels?.signOff ?? 'Reviewed with Covi');
  const font = u(vertical ? 32 : 26);
  if (chip) chip.style.fontSize = `${font}px`;
  // Long sign-offs shrink to fit the frame instead of running past it, in every language.
  const room = tl.width - 2 * u(vertical ? 72 : 96);
  fitText(line, { max: font, min: u(18), maxWidth: room - (chip ? chip.offsetWidth + u(20) : 0) });

  // The lockup and the row, centered together: the fox's box centered over the word, as in the
  // stacked logo.
  const rowGap = u(vertical ? 76 : 54);
  const total = foxSize + gap + wordHeight + rowGap + row.offsetHeight;
  const top = (tl.height - total) / 2;
  const cx = tl.width / 2;
  const home: Rect = { x: cx - foxSize / 2, y: top, width: foxSize, height: foxSize };
  const wordTop = top + foxSize + gap;
  Object.assign(word.style, { left: `${cx - wordWidth / 2}px`, top: `${wordTop}px` });
  Object.assign(row.style, {
    left: `${cx - row.offsetWidth / 2}px`,
    top: `${wordTop + wordHeight + rowGap}px`,
  });

  const from = ctx.previousFox;
  const letterRise = parts.xHeight * 0.32;
  const [playX, playY] = parts.play.center;
  const blinkAt = settle + 0.85;
  const place = (box: Rect) =>
    Object.assign(fox!.style, {
      left: `${box.x.toFixed(2)}px`,
      top: `${box.y.toFixed(2)}px`,
      width: `${box.width.toFixed(2)}px`,
      height: `${box.height.toFixed(2)}px`,
    });
  if (fox) place(home);

  return {
    header: false,
    entrance: false,
    update({ t, frame, fox: state }) {
      if (fox) {
        const time = frame / tl.fps;
        // A glance down at the name as it is written, then back to the viewer as the card settles.
        const down = easeInOutCubic(seg(t, 0.4, 0.58)) * (1 - easeInOutCubic(seg(t, 0.78, 0.98)));
        // One flick of the tail on the landing that dies away, and one unhurried blink after it.
        // The video's own blinks fade out with the handoff, so the fox meets the viewer's eyes
        // on the landing.
        const since = t - settle;
        const flick =
          since > 0 ? 0.6 * Math.sin(2 * Math.PI * 1.5 * since) * Math.exp(-3.4 * since) : 0;
        const d = t - blinkAt;
        const handed = from ? easeInOutCubic(seg(t, 0.04, 0.5)) : 1;
        const blink = Math.max(
          state.blink * (1 - handed),
          d >= 0 && d < 0.2 ? Math.sin((d / 0.2) * Math.PI) : 0,
        );
        const calm = foxPose({
          expression: 'neutral',
          t,
          time,
          mouth: 0,
          blink,
          gaze: { x: 0, y: 0 },
          pointing: false,
          seed: tl.seed,
        });
        let pose: FoxOptions = calm.fox;
        let box = home;
        if (from) {
          // The fox the card before drew carries on: it glides here from where it sat, its face
          // easing from that card's expression back to the calm one.
          const k = easeInOutCubic(seg(t, 0, GLIDE));
          box = lerpRect(from.fox.rect, home, k);
          const before = from.fox.pose({ t: time - from.sceneStart, frame, fox: state });
          pose = blendPoses({ fox: before, active: [] }, calm, handed).fox;
          fox.style.opacity = '1';
          fox.style.transform = 'none';
        } else {
          // Nothing to take over: the fox settles in about its feet.
          const s = clamp(spring(t - 0.05, 1.5, 6.2), 0, 1.05);
          fox.style.opacity = easeOutCubic(seg(t, 0.05, 0.4)).toFixed(3);
          fox.style.transform = `scale(${lerp(0.88, 1, s).toFixed(4)})`;
        }
        place(box);
        fox.innerHTML = foxSvg({
          ...pose,
          look: { x: lerp(pose.look?.x ?? 0, 0, down), y: lerp(pose.look?.y ?? 0, 0.72, down) },
          nod: (pose.nod ?? 0) + 1.4 * down,
          wag: clamp((pose.wag ?? 0) + flick, -1, 1),
          blink,
          size: box.width,
          theme: theme.name,
        });
      }
      // "covi" writes itself in, letter by letter, each rising a third of its x-height.
      letters.forEach((g, i) => {
        const p = easeOutCubic(seg(t, 0.34 + i * 0.06, 0.7 + i * 0.06));
        g.setAttribute('opacity', p.toFixed(3));
        g.setAttribute('transform', `translate(0 ${((1 - p) * letterRise).toFixed(1)})`);
      });
      // The ▶ lands with the logo: full size on the settle moment, a little over, then still.
      const k = pop(seg(t, settle - 0.12, settle + 0.2));
      play.setAttribute('opacity', clamp(k * 3).toFixed(3));
      play.setAttribute(
        'transform',
        `translate(${playX} ${playY}) scale(${k.toFixed(4)}) translate(${-playX} ${-playY})`,
      );
      rise(row, seg(t, 0.58, 0.98), u(14));
    },
    // The row sizes to its text, so it cannot overflow itself: it is too long when it is wider
    // than the room the frame's margins leave.
    report: () => [
      {
        role: 'text',
        rect: rectOf(row),
        overflow: row.offsetWidth > room + 1 || overflows(line),
      },
    ],
  };
}
