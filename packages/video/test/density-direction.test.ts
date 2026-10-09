import { describe, expect, it } from 'vitest';
import {
  emptyFrameCheck,
  leadKind,
  monotonyCheck,
  textSizeCheck,
  transitionVarietyCheck,
} from '../src/density.ts';
import { contactSheetFrames, layoutSampleFrames } from '../src/render/renderer.ts';
import {
  entranceSeconds,
  restFrame,
  settledAt,
  settledFrame,
  settledSpan,
  shotSettledAt,
} from '../src/timeline/cues.ts';
import type {
  DirectionBeat,
  DirectionElement,
  LayoutItem,
  LayoutReport,
  SceneDirection,
  Timeline,
  TimelineScene,
  TimelineVisual,
  TransitionKind,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const codeVisual: Extract<TimelineVisual, { kind: 'code' }> = {
  kind: 'code',
  path: 'a.js',
  lines: [{ type: 'add', text: 'x' }],
  highlight: [],
};
const output: DirectionElement = {
  id: 'o',
  kind: 'output',
  rect,
  visual: { kind: 'terminal', command: 'node measure.js', output: 'request bytes: 9000' },
};
const label: DirectionElement = { id: 'l', kind: 'label', rect, text: 'Late', tone: 'warning' };
const screenshot: Extract<TimelineVisual, { kind: 'screenshot' }> = {
  kind: 'screenshot',
  image: { src: 'a.png', width: 1, height: 1 },
  device: 'desktop',
};
const capture: DirectionElement = { id: 'p', kind: 'capture', rect, visual: screenshot };
const shot = (...elements: DirectionElement[]): SceneDirection => ({
  whole: false,
  elements,
  beats: [],
});
const scene = (
  id: string,
  start: number,
  visual: TimelineVisual,
  extra: Partial<TimelineScene> = {},
): TimelineScene => ({
  id,
  beat: id,
  eyebrow: id,
  start,
  end: start + 4,
  visual,
  expression: 'explaining',
  narrator: true,
  ...extra,
});

describe('lead kinds with direction', () => {
  it('lead with the shot’s first element, counted as the visual it looks like', () => {
    expect(leadKind(scene('a', 0, callout))).toBe('callout');
    const whole = {
      whole: true,
      elements: [{ id: 'visual', kind: 'visual' as const, rect }],
      beats: [],
    };
    expect(leadKind(scene('a', 0, codeVisual, { direction: whole }))).toBe('code');
    const lead = (e: DirectionElement) => leadKind(scene('a', 0, callout, { direction: shot(e) }));
    expect(lead({ id: 'c', kind: 'code', rect, visual: codeVisual })).toBe('code');
    expect(lead(output)).toBe('terminal');
    expect(lead(capture)).toBe('screenshot');
    expect(lead({ id: 'n', kind: 'node', rect, label: 'Reader' })).toBe('diagram');
    expect(lead(label)).toBe('callout');
  });

  it('let a shot break a run of one kind, or continue it', () => {
    const code = (id: string, start: number, extra: Partial<TimelineScene> = {}) =>
      scene(id, start, codeVisual, extra);
    // Three code scenes, the middle one leading with its output: no run of three.
    expect(
      monotonyCheck({
        scenes: [code('a', 0), code('b', 4, { direction: shot(output) }), code('c', 8)],
      }).status,
    ).toBe('pass');
    // A callout, then two shots leading with labels: three callouts in a row.
    expect(
      monotonyCheck({
        scenes: [
          scene('a', 0, callout),
          code('b', 4, { direction: shot(label) }),
          code('c', 8, { direction: shot(label) }),
        ],
      }).status,
    ).toBe('warn');
  });
});

describe('runs of one kind', () => {
  const outro = (start: number) => scene('covi:outro', start, { kind: 'outro' });
  /** Story scenes leading with these elements (or their visual), four seconds apart. */
  const leading = (...leads: Array<DirectionElement | TimelineVisual>) =>
    leads.map((lead, i) =>
      'rect' in lead
        ? scene(`s${i + 1}`, 4 * i, codeVisual, { direction: shot(lead) })
        : scene(`s${i + 1}`, 4 * i, lead),
    );

  it('are found at the story’s end, before the outro', () => {
    const story = leading(callout, codeVisual, codeVisual, codeVisual);
    const check = monotonyCheck({ scenes: [...story, outro(16)] });
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(/^3 code scenes in a row \(s2–s4\): at most 2/);
  });

  it('are named one by one, the first three of them', () => {
    const story = leading(
      codeVisual,
      codeVisual,
      codeVisual,
      label,
      label,
      label,
      output,
      output,
      output,
      output,
      codeVisual,
      codeVisual,
      codeVisual,
    );
    const check = monotonyCheck({ scenes: [...story, outro(52)] });
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(
      /^3 code scenes in a row \(s1–s3\); 3 callout scenes in a row \(s4–s6\); 4 terminal scenes in a row \(s7–s10\); …: at most 2/,
    );
    const two = monotonyCheck({ scenes: [...story.slice(0, 6), outro(24)] });
    expect(two.message).toMatch(
      /^3 code scenes in a row \(s1–s3\); 3 callout scenes in a row \(s4–s6\): at most 2/,
    );
  });
});

describe('transition variety on the canvas', () => {
  const moves = (...kinds: TransitionKind[]) => ({
    scenes: [
      scene('s0', 0, callout),
      ...kinds.map((kind, i) =>
        scene(`s${i + 1}`, 4 * (i + 1), callout, { transition: { kind, seconds: 0.7 } }),
      ),
    ],
  });
  it('counts pans and zooms like any other entrance', () => {
    expect(transitionVarietyCheck(moves('pan', 'pan', 'pan', 'push')).status).toBe('warn');
    expect(transitionVarietyCheck(moves('pan', 'push', 'pan', 'zoom')).status).toBe('pass');
  });
});

describe('the settled frame of a directed scene', () => {
  it('comes after its beats, so a camera move inside the stop is not measured mid-way', () => {
    const timeline = (s: TimelineScene) => ({ scenes: [s], transition: 0.45 });
    const plain = scene('a', 0, callout);
    const directed = scene('a', 0, callout, {
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect }],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual', t: 1.5, seconds: 0.8 }],
      },
    });
    expect(settledSpan(timeline(plain), 0)![0]).toBeCloseTo(settledAt(callout, 4), 9);
    expect(shotSettledAt(directed)).toBeCloseTo(2.3, 9);
    expect(settledSpan(timeline(directed), 0)![0]).toBeCloseTo(2.3, 9);
  });
});

describe('entrance lengths', () => {
  it('are none for the first scene, else the scene’s own or the timeline’s', () => {
    const t = {
      transition: 0.45,
      scenes: [
        scene('a', 0, callout, { transition: { kind: 'push', seconds: 0.5 } }),
        scene('b', 3.5, callout, { transition: { kind: 'pan', seconds: 0.7 } }),
        scene('c', 7, callout),
      ],
    };
    expect([0, 1, 2, 3].map((i) => entranceSeconds(t, i))).toEqual([0, 0.7, 0.45, 0]);
  });
});

/** A visual shown whole, with these beats. */
const beaten = (...beats: DirectionBeat[]): SceneDirection => ({
  whole: true,
  elements: [{ id: 'visual', kind: 'visual', rect }],
  beats,
});
const zoomAt = (t: number): DirectionBeat => ({
  verb: 'camera',
  move: 'zoom',
  to: 'visual',
  zoom: 1.25,
  t,
  seconds: 0.8,
});
const revealAt = (t: number): DirectionBeat => ({
  verb: 'reveal',
  element: 'visual',
  style: 'pop',
  t,
  seconds: 0.5,
});

/** These story scenes, then the outro, at 1920 × 1080 and 30 fps. */
function video(...scenes: TimelineScene[]): Timeline {
  const end = scenes.at(-1)!.end;
  const all = [
    ...scenes,
    scene(
      'covi:outro',
      end - 0.45,
      { kind: 'outro' },
      { transition: { kind: 'fade', seconds: 0.45 } },
    ),
  ];
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    frames: Math.ceil(all.at(-1)!.end * 30),
    transition: 0.45,
    orientation: 'landscape',
    scenes: all,
  } as Timeline;
}

describe('the frame before a camera beat', () => {
  const t = video(
    scene('s1', 0, codeVisual, { direction: beaten(zoomAt(1.5)) }),
    scene('s2', 3.5, codeVisual, {
      transition: { kind: 'push', seconds: 0.5 },
      direction: beaten(zoomAt(0.3)),
    }),
    scene('s3', 7, codeVisual, {
      transition: { kind: 'pan', seconds: 0.5 },
      direction: beaten(revealAt(0.8), zoomAt(1.5)),
    }),
    scene('s4', 10.5, codeVisual, {
      transition: { kind: 'pan', seconds: 0.5 },
      direction: beaten(revealAt(1.2), zoomAt(1.5)),
    }),
    scene('s5', 14, codeVisual, { transition: { kind: 'pan', seconds: 0.5 } }),
    scene('s6', 17.5, codeVisual, {
      transition: { kind: 'push', seconds: 0.5 },
      direction: beaten(),
    }),
  );

  it('is the last frame before the stop’s first camera beat, once the scene is in place', () => {
    // 1.5 s in is frame 45: the one before it.
    expect(restFrame(t, 0)).toBe(44);
    // Its beat starts 0.3 s in, while the scene still enters: never at rest before it.
    expect(restFrame(t, 1)).toBeUndefined();
    // A reveal done before the beat starts; one still under way when it does.
    expect(restFrame(t, 2)).toBe(Math.ceil((7 + 1.5) * 30) - 1);
    expect(restFrame(t, 3)).toBeUndefined();
    // No direction, no camera beat, or no scene.
    expect(restFrame(t, 4)).toBeUndefined();
    expect(restFrame(t, 5)).toBeUndefined();
    expect(restFrame(t, 9)).toBeUndefined();
  });

  it('is before the next scene enters', () => {
    const late = video(
      scene('s1', 0, codeVisual, { direction: beaten(zoomAt(3.8)) }),
      scene('s2', 3.5, callout, { transition: { kind: 'push', seconds: 0.5 } }),
    );
    // s2 enters from 3.5 s, before the beat: the last frame before it is 104.
    expect(restFrame(late, 0)).toBe(104);
    expect(settledFrame(late, 0)).toBe(104);
  });

  it('is sampled for layout', () => {
    const frames = layoutSampleFrames(t);
    expect(frames).toContain(44);
    expect(frames).toContain(restFrame(t, 2));
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });
});

describe('density read at rest and after the camera beat', () => {
  const t = video(
    scene('s1', 0, codeVisual, { direction: beaten(zoomAt(1.5)) }),
    scene('s2', 3.5, callout, { transition: { kind: 'push', seconds: 0.5 } }),
  );
  const report = (frame: number, items: LayoutItem[]): LayoutReport => ({
    frame,
    scene: 's1',
    items,
    imagesLoaded: true,
  });
  /** A band across the landscape media region at 1080p (1728 × 662 from 96, 206). */
  const band = (height: number) => ({ x: 96, y: 206 + (662 - height) / 2, width: 1728, height });
  const codeAt = (font: number, height = 420): LayoutItem => ({
    role: 'media',
    rect: band(height),
    font,
    text: 'code',
  });
  const frames = () => ({ rest: restFrame(t, 0)!, settled: settledFrame(t, 0)! });

  it('names the smallest text, which the zoom magnified once settled', () => {
    const { rest, settled } = frames();
    // Settled once the beat has ended, 2.3 s in.
    expect(settled).toBe(69);
    // 20 px at rest reads 25 px at 1.25×: the viewer read 20 px first.
    const check = textSizeCheck(t, [report(rest, [codeAt(20)]), report(settled, [codeAt(25)])]);
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(/code at 20 px in s1/);
    expect(textSizeCheck(t, [report(settled, [codeAt(25)])]).status).toBe('pass');
    // Under way, the beat is not read: the rest frame and the settled frame are.
    const moving = textSizeCheck(t, [
      report(rest + 5, [codeAt(10)]),
      report(settled, [codeAt(25)]),
    ]);
    expect(moving.status).toBe('pass');
  });

  it('keeps the fullest frame for the empty-frame check', () => {
    const { rest, settled } = frames();
    const check = emptyFrameCheck(t, [
      report(rest, [codeAt(24, 180)]),
      report(settled, [codeAt(30, 420)]),
    ]);
    expect(check.status).toBe('pass');
    const thin = emptyFrameCheck(t, [
      report(rest, [codeAt(24, 180)]),
      report(settled, [codeAt(30, 200)]),
    ]);
    expect(thin.status).toBe('warn');
  });
});

describe('the empty-frame check on shots', () => {
  it('judges a scene by what its shot leads with', () => {
    const t = video(
      // A code scene whose shot leads with a capture: an image keeps its own aspect ratio.
      scene('s1', 0, codeVisual, { direction: shot(capture) }),
      // A capture scene whose shot leads with a label: a card, held to the frame.
      scene('s2', 3.5, screenshot, {
        transition: { kind: 'push', seconds: 0.5 },
        direction: shot(label),
      }),
    );
    const thin: LayoutItem = { role: 'media', rect: { x: 807, y: 206, width: 306, height: 200 } };
    const check = emptyFrameCheck(t, [
      { frame: settledFrame(t, 0)!, scene: 's1', items: [thin], imagesLoaded: true },
      { frame: settledFrame(t, 1)!, scene: 's2', items: [thin], imagesLoaded: true },
    ]);
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(/in s2 \(/);
    expect(check.message).not.toMatch(/s1/);
  });
});

describe('contact sheet frames', () => {
  it('take each move’s middle from the same entrance lengths', () => {
    const t = video(
      scene('s1', 0, codeVisual),
      scene('s2', 3.5, callout, { transition: { kind: 'pan', seconds: 0.7 } }),
      scene('s3', 7, callout),
    );
    const frames = contactSheetFrames(t);
    expect(frames).toContain(Math.round((3.5 + 0.35) * 30));
    expect(frames).toContain(Math.round((7 + 0.225) * 30));
  });
});
