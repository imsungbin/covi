import { describe, expect, it } from 'vitest';
import {
  densityChecks,
  emptyFrameCheck,
  monotonyCheck,
  textSizeCheck,
  transitionVarietyCheck,
} from '../src/density.ts';
import { layoutSampleFrames } from '../src/render/renderer.ts';
import {
  CARD_FILL,
  CODE_FALLBACK,
  cardHeight,
  codeCeiling,
  codeFont,
  TEXT_FLOOR,
} from '../src/runtime/sizing.ts';
import { settledAt, settledFrame, settledSpan } from '../src/timeline/cues.ts';
import type {
  LayoutItem,
  LayoutReport,
  SceneTransition,
  Timeline,
  TimelineScene,
  TimelineVisual,
  TransitionKind,
} from '../src/timeline/types.ts';

const code: TimelineVisual = {
  kind: 'code',
  path: 'a.js',
  lines: [{ type: 'add', text: 'x' }],
  highlight: [],
};
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const terminal: TimelineVisual = {
  kind: 'terminal',
  command: 'node scripts/measure.js',
  before: 'chunks: 4',
  output: 'chunks: 1',
};

function scene(
  id: string,
  start: number,
  end: number,
  visual: TimelineVisual,
  transition?: SceneTransition,
): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual,
    expression: 'explaining',
    narrator: true,
    ...(transition ? { transition } : {}),
  };
}

/** A timeline of these scenes at 30 fps, `width` × `height`. */
function video(width: number, height: number, scenes: TimelineScene[]): Timeline {
  return {
    width,
    height,
    fps: 30,
    frames: Math.ceil(scenes.at(-1)!.end * 30),
    transition: 0.45,
    orientation: width > height ? 'landscape' : width < height ? 'vertical' : 'square',
    scenes,
  } as Timeline;
}

describe('type and card sizes', () => {
  it('grow code to the ceiling when it fits, and below the floor only when it must', () => {
    expect(TEXT_FLOOR).toEqual({ code: 24, body: 28 });
    expect(codeCeiling('landscape')).toBe(44);
    expect(codeCeiling('square')).toBe(44);
    expect(codeCeiling('vertical')).toBe(48);
    expect(codeFont(100, 'landscape', 1)).toBe(44);
    expect(codeFont(100, 'vertical', 2)).toBe(96);
    expect(codeFont(30, 'landscape', 1)).toBe(30);
    expect(codeFont(10, 'landscape', 1)).toBe(CODE_FALLBACK);
  });

  it('grow a short card until it fills 60% of the region, never past the region', () => {
    const region = { x: 0, y: 0, width: 1000, height: 500 };
    expect(CARD_FILL).toBe(0.6);
    expect(cardHeight(region, 1000, 100)).toBeCloseTo(300, 9);
    expect(cardHeight(region, 1000, 420)).toBe(420);
    // Half as wide, it would need 600 to cover 60%: the region has 500.
    expect(cardHeight(region, 500, 100)).toBe(500);
    expect(cardHeight(region, 1000, 900)).toBe(500);
  });
});

describe('settled frames', () => {
  const t = video(1920, 1080, [
    scene('s1', 0, 4, code),
    scene('s2', 3.5, 8, callout, { kind: 'push', seconds: 0.5 }),
    scene('s3', 8, 10, callout, { kind: 'cut', seconds: 0 }),
    scene('covi:outro', 9.55, 12, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
  ]);

  it('start once the entrance and the choreography are done, and end where the next scene enters', () => {
    expect(settledSpan(t, 0)).toEqual([settledAt(code, 4), 3.5]);
    const [from, to] = settledSpan(t, 1)!;
    expect(from).toBeCloseTo(3.5 + 0.6, 9);
    expect(to).toBe(8);
    expect(settledSpan(t, 2)).toEqual([8.6, 9.55]);
    expect(settledSpan(t, 9)).toBeUndefined();
    expect(settledFrame(t, 1)).toBe(123);
    expect(settledFrame(t, 2)).toBe(258);
  });

  it('fall back to the moment a scene starts to leave when it is too short to settle', () => {
    const short = video(1920, 1080, [
      scene('s1', 0, 4, callout),
      scene('s2', 3.5, 6, terminal, { kind: 'push', seconds: 0.5 }),
      scene('s3', 5.55, 9, callout, { kind: 'fade', seconds: 0.45 }),
    ]);
    // The after run prints 2.25 s in; s2 has 2.05 s before s3 fades in.
    expect(settledAt(terminal, 2.5)).toBeCloseTo(2.25, 9);
    const [from, to] = settledSpan(short, 1)!;
    expect(from).toBeCloseTo(5.55, 9);
    expect(to).toBeCloseTo(5.55, 9);
    // The last frame before s3 enters, still inside s2.
    expect(settledFrame(short, 1)).toBe(166);
  });

  it('are sampled for every story scene, beside 35% and 70% of every scene', () => {
    const frames = layoutSampleFrames(t);
    for (const i of [0, 1, 2]) expect(frames).toContain(settledFrame(t, i));
    // The outro is Covi's own card: sampled at 35% and 70% only.
    expect(frames).not.toContain(settledFrame(t, 3));
    expect(frames).toContain(Math.round((3.5 + 4.5 * 0.35) * 30));
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });
});

const findings: TimelineVisual = {
  kind: 'findings',
  findings: [{ title: 'F', certainty: 'risk', severity: 'low' }],
};

/** A code scene, a findings scene that pushes in, and the outro, at `width` × `height`. */
const story = (width = 1920, height = 1080) =>
  video(width, height, [
    scene('s1', 0, 4, code),
    scene('s2', 3.5, 8, findings, { kind: 'push', seconds: 0.5 }),
    scene('covi:outro', 7.55, 10, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
  ]);
const at = (t: Timeline, id: string) =>
  settledFrame(
    t,
    t.scenes.findIndex((s) => s.id === id),
  )!;
const report = (frame: number, scene: string, items: LayoutItem[]): LayoutReport => ({
  frame,
  scene,
  items,
  imagesLoaded: true,
});
/** A band across the landscape media region at 1080p (1728 × 662 from 96, 206), `height` tall. */
const band = (height: number) => ({ x: 96, y: 206 + (662 - height) / 2, width: 1728, height });
const codeAt = (font: number, rect = band(420)): LayoutItem => ({
  role: 'media',
  rect,
  font,
  text: 'code',
});
const bodyAt = (font: number): LayoutItem => ({
  role: 'text',
  rect: band(420),
  font,
  text: 'body',
});

describe('the text-size check', () => {
  it('passes code at 24 px and body text at 28 px at 1080p, and names smaller text', () => {
    const t = story();
    const ok = textSizeCheck(t, [
      report(at(t, 's1'), 's1', [codeAt(24)]),
      report(at(t, 's2'), 's2', [bodyAt(28)]),
    ]);
    expect(ok).toMatchObject({ id: 'text-size', status: 'pass' });
    const small = textSizeCheck(t, [
      report(at(t, 's1'), 's1', [codeAt(19)]),
      report(at(t, 's2'), 's2', [bodyAt(23)]),
    ]);
    expect(small.status).toBe('warn');
    expect(small.message).toMatch(/code at 19 px in s1/);
    expect(small.message).toMatch(/body at 23 px in s2/);
  });

  it('allows only the rounding of drawn boxes under the floor', () => {
    const t = story();
    const near = textSizeCheck(t, [report(at(t, 's1'), 's1', [codeAt(23.8)])]);
    expect(near.status).toBe('warn');
    // Named as drawn, so the message never claims text at its floor is too small.
    expect(near.message).toMatch(/code at 23\.8 px in s1/);
    expect(textSizeCheck(t, [report(at(t, 's1'), 's1', [codeAt(23.95)])]).status).toBe('pass');
  });

  it('measures against the frame’s short side', () => {
    // At 4K a design unit is 2 px; at 360 × 640 it is a third of one.
    const k4 = story(3840, 2160);
    expect(textSizeCheck(k4, [report(at(k4, 's1'), 's1', [codeAt(40)])]).status).toBe('warn');
    expect(textSizeCheck(k4, [report(at(k4, 's1'), 's1', [codeAt(48)])]).status).toBe('pass');
    const phone = story(360, 640);
    expect(textSizeCheck(phone, [report(at(phone, 's1'), 's1', [codeAt(8)])]).status).toBe('pass');
    expect(textSizeCheck(phone, [report(at(phone, 's1'), 's1', [codeAt(7)])]).status).toBe('warn');
  });

  it('reads settled frames of story scenes only, and never holds chips or paths to a floor', () => {
    const t = story();
    const tiny = codeAt(6);
    const check = textSizeCheck(t, [
      // Still entering; s1 settles 0.535 s in, a sliver after frame 16.
      report(3, 's1', [tiny]),
      report(16, 's1', [tiny]),
      report(at(t, 's1'), 's1', [
        { ...tiny, text: 'meta' },
        { role: 'media', rect: tiny.rect },
      ]),
      report(280, 'covi:outro', [tiny]),
    ]);
    expect(check.status).toBe('pass');
  });

  it('reads a scene too short to settle at the moment it starts to leave', () => {
    const t = video(1920, 1080, [
      scene('s1', 0, 4, callout),
      scene('s2', 3.5, 6, terminal, { kind: 'push', seconds: 0.5 }),
      scene('s3', 5.55, 9, callout, { kind: 'fade', seconds: 0.45 }),
    ]);
    const check = textSizeCheck(t, [report(166, 's2', [codeAt(10)])]);
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(/in s2/);
  });
});

describe('the empty-frame check', () => {
  it('warns when a card scene’s content covers under 40% of the media region', () => {
    const t = story();
    const thin = emptyFrameCheck(t, [report(at(t, 's1'), 's1', [codeAt(44, band(180))])]);
    expect(thin).toMatchObject({ id: 'empty-frame', status: 'warn' });
    expect(thin.message).toMatch(/s1 \(27\.1%\)/);
    const full = emptyFrameCheck(t, [report(at(t, 's1'), 's1', [codeAt(44, band(400))])]);
    expect(full.status).toBe('pass');
    // Just under 40% (264.6 of 662): named under its floor, never at it.
    const near = emptyFrameCheck(t, [report(at(t, 's1'), 's1', [codeAt(44, band(264.6))])]);
    expect(near.status).toBe('warn');
    expect(near.message).toMatch(/s1 \(39\.9%\); at least 40% of the media region/);
  });

  it('counts only content inside the media region, at the fullest settled frame', () => {
    const t = story();
    const heading: LayoutItem = {
      role: 'text',
      rect: { x: 96, y: 74, width: 900, height: 110 },
      font: 42,
      text: 'body',
    };
    // The header's heading sits above the region: it does not stretch the content's box.
    const withHeading = emptyFrameCheck(t, [
      report(at(t, 's1'), 's1', [heading, codeAt(44, band(180))]),
    ]);
    expect(withHeading.status).toBe('warn');
    // One settled frame where the content fills the frame is enough (90 is 3 s in, still settled).
    const later = emptyFrameCheck(t, [
      report(at(t, 's1'), 's1', [codeAt(44, band(180))]),
      report(90, 's1', [codeAt(44, band(420))]),
    ]);
    expect(later.status).toBe('pass');
  });

  it('leaves captures and the title and summary cards to their own layout', () => {
    const t = video(1920, 1080, [
      scene('s1', 0, 4, {
        kind: 'screenshot',
        image: { src: 'a.png', width: 390, height: 844 },
        device: 'mobile',
      }),
      scene(
        's2',
        3.5,
        8,
        { kind: 'summary', verdict: 'looks-good', headline: 'H', points: [] },
        { kind: 'push', seconds: 0.5 },
      ),
    ]);
    // A phone capture in a landscape frame is narrow by its aspect ratio, not by choice.
    const narrow: LayoutItem = { role: 'media', rect: { x: 807, y: 206, width: 306, height: 662 } };
    const check = emptyFrameCheck(t, [
      report(at(t, 's1'), 's1', [narrow]),
      report(at(t, 's2'), 's2', [narrow]),
    ]);
    expect(check.status).toBe('pass');
  });
});

describe('the monotony check', () => {
  const summary: TimelineVisual = {
    kind: 'summary',
    verdict: 'looks-good',
    headline: 'H',
    points: [],
  };
  /** Story scenes of these visuals, three seconds each, then the outro. */
  const kinds = (...visuals: TimelineVisual[]) =>
    ({
      scenes: [
        ...visuals.map((v, i) => scene(`s${i + 1}`, i * 3, i * 3 + 3, v)),
        scene('covi:outro', visuals.length * 3, visuals.length * 3 + 2, { kind: 'outro' }),
      ],
    }) as Pick<Timeline, 'scenes'>;

  it('warns at three scenes of one kind in a row, naming them', () => {
    const check = monotonyCheck(kinds(code, code, code, callout));
    expect(check).toMatchObject({ id: 'monotony', status: 'warn' });
    expect(check.message).toMatch(/3 code scenes in a row \(s1–s3\)/);
  });

  it('passes two of a kind with something else between them', () => {
    expect(monotonyCheck(kinds(code, code, callout, code, code)).status).toBe('pass');
    expect(monotonyCheck(kinds(callout, summary, summary)).status).toBe('pass');
  });

  it('compares visual kinds exactly', () => {
    expect(monotonyCheck(kinds(code, terminal, code, terminal)).status).toBe('pass');
  });
});

describe('the transition-variety check', () => {
  /** A first scene, then one entering with each kind (none: a timeline from before kinds). */
  const entering = (...list: Array<TransitionKind | undefined>) =>
    ({
      scenes: [
        scene('s0', 0, 3, callout),
        ...list.map((kind, i) =>
          scene(
            `s${i + 1}`,
            (i + 1) * 3,
            (i + 1) * 3 + 3,
            callout,
            kind ? { kind, seconds: 0.45 } : undefined,
          ),
        ),
        scene('covi:outro', 30, 32, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
      ],
    }) as Pick<Timeline, 'scenes'>;

  it('warns when one kind covers more than 60% of four or more story transitions', () => {
    const check = transitionVarietyCheck(entering('fade', 'fade', 'fade', 'push'));
    expect(check).toMatchObject({ id: 'transition-variety', status: 'warn' });
    expect(check.message).toMatch(/3 of 4 story transitions are fade \(75%\)/);
  });

  it('passes at 60%, and below four transitions', () => {
    expect(transitionVarietyCheck(entering('fade', 'fade', 'fade', 'push', 'cut')).status).toBe(
      'pass',
    );
    const few = transitionVarietyCheck(entering('fade', 'fade', 'fade'));
    expect(few.status).toBe('pass');
    // The outro's fade is not a story transition: three, not four.
    expect(few.message).toMatch(/^3 story transition/);
  });

  it('counts a scene without a kind as a fade', () => {
    expect(transitionVarietyCheck(entering(undefined, undefined, 'push', 'cut')).status).toBe(
      'pass',
    );
    expect(transitionVarietyCheck(entering(undefined, undefined, undefined, 'push')).status).toBe(
      'warn',
    );
  });
});

describe('the density checks', () => {
  it('run in order, and pass quietly on reports that measured nothing', () => {
    const t = story();
    const ids = densityChecks(t, []).map((c) => c.id);
    expect(ids).toEqual(['text-size', 'empty-frame', 'monotony', 'transition-variety']);
    // Layouts from before fonts were reported, or sampled at no settled frame.
    const old = densityChecks(t, [
      report(3, 's1', [{ role: 'media', rect: band(180) }]),
      report(at(t, 's2'), 's2', [{ role: 'text', rect: band(420) }]),
    ]);
    expect(old.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(old[0]!.message).toMatch(/No code or body text was measured/);
  });
});
