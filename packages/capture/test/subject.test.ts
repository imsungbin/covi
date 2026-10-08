import {
  type DemoShot,
  demoPath,
  emptySubject,
  mergeSubject,
  mergeSubjectWithOutcomes,
  type Rect,
  SUBJECT_LIMITS,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import type { ViewportName } from '../src/browser.ts';
import type { PageScan, ScannedElement } from '../src/elements.ts';
import {
  focusShots,
  type SubjectCaptures,
  type SubjectFlowRun,
  type SubjectPage,
  subjectFocus,
  subjectImages,
  subjectObservation,
} from '../src/subject.ts';

const REV = '000000000001';
const el = (selector: string, key: string, box: Rect): ScannedElement => ({
  selector,
  key,
  role: 'button',
  label: key,
  box,
});
const scan = (elements: ScannedElement[], scroll = { x: 0, y: 0 }, path = '/'): PageScan => ({
  path,
  scroll,
  elements,
});

// Mobile renders at device scale 2: CSS boxes double in image pixels.
const PAGE: SubjectPage = {
  id: 'home-mobile',
  title: 'Items',
  viewport: 'mobile',
  // The crop starts 400 image px down the full capture.
  window: { x: 0, y: 400, width: 780, height: 1688 },
  scan: scan([
    el('#top', 'top', { x: 10, y: 0, width: 30, height: 40 }),
    el('#half', 'half', { x: 10, y: 175, width: 30, height: 40 }),
    el('#edge', 'edge', { x: 10, y: 190, width: 30, height: 40 }),
    el('#load', 'load', { x: 10, y: 250, width: 30, height: 40 }),
  ]),
};
const FRAME = {
  image: demoPath.flowFrame('flow-load-items', 1, 'head'),
  scan: scan([el('#load', 'load', { x: 10, y: 250, width: 30, height: 40 })], { x: 0, y: 100 }),
};
const LOAD: SubjectFlowRun = {
  flow: { name: 'Load items', path: '/', steps: [{ click: '#load', note: 'Load' }, { wait: 300 }] },
  viewport: 'mobile',
  labels: ['Load', undefined],
  passed: true,
  secret: false,
  frames: [FRAME],
};
const CAPTURES: SubjectCaptures = {
  revision: REV,
  pages: [PAGE],
  flows: [LOAD],
  requests: [
    {
      name: 'Users',
      method: 'get',
      path: '/api/users?x=1',
      after: { status: 200, body: '[]' },
      changed: true,
    },
  ],
  commands: [
    {
      name: 'Help',
      command: 'node cli.js --help',
      after: { exitCode: 0, output: 'ok' },
      changed: false,
    },
  ],
};

describe('subject observations', () => {
  it('turns what a run saw at head into an observation, never a command line', () => {
    const observation = subjectObservation(CAPTURES, emptySubject());
    // Frames first: the page load, merged last, has the final word on where things are.
    expect(
      observation.screens.map((s) => [s.viewport, s.size, s.title, s.elements.at(-1)!.box]),
    ).toEqual([
      ['mobile', { width: 390, height: 844 }, undefined, { x: 20, y: 500, width: 60, height: 80 }],
      ['mobile', { width: 390, height: 844 }, 'Items', { x: 20, y: 500, width: 60, height: 80 }],
    ]);
    expect(observation.flows).toEqual([
      {
        name: 'Load items',
        path: '/',
        viewport: 'mobile',
        steps: [
          { action: { click: '#load', note: 'Load' }, label: 'Load' },
          { action: { wait: 300 } },
        ],
        passed: true,
      },
    ]);
    expect(observation.commands).toEqual([
      { kind: 'cli', name: 'Help', exitCode: 0 },
      { kind: 'http', name: 'Users', method: 'GET', path: '/api/users?x=1', status: 200 },
    ]);
    expect(JSON.stringify(observation)).not.toContain('node cli.js');
  });

  it('takes nothing a dropped flow saw: no labels, no elements from its frames', () => {
    const typed = (image: string) => ({
      image,
      scan: scan([el('#typed', 'hunter2', { x: 0, y: 0, width: 10, height: 10 })], undefined, '/x'),
    });
    const dropped: SubjectFlowRun[] = [
      { ...LOAD, flow: { ...LOAD.flow, name: 'Failed' }, passed: false, frames: [typed('a.png')] },
      { ...LOAD, flow: { ...LOAD.flow, name: 'Secret' }, secret: true, frames: [typed('b.png')] },
      // Nothing flagged it while it ran, but its step names a password field.
      {
        ...LOAD,
        flow: { name: 'Sign in', path: '/', steps: [{ fill: '#password', text: 'x' }] },
        labels: ['hunter2'],
        frames: [typed('c.png')],
      },
      // A field this run saw marked secret, typed into by a selector that does not say so.
      {
        ...LOAD,
        flow: { name: 'Pin', path: '/', steps: [{ fill: '#code', text: '1234' }] },
        labels: ['hunter2'],
        frames: [
          {
            image: 'd.png',
            scan: scan([{ ...el('#code', 'code', PAGE.window), secret: true }], undefined, '/x'),
          },
        ],
      },
      // Not one Covi would replay: it leaves the app.
      {
        ...LOAD,
        flow: { name: 'Away', path: '/', steps: [{ goto: 'https://elsewhere.example/' }] },
        labels: ['hunter2'],
        frames: [typed('e.png')],
      },
    ];
    const observation = subjectObservation(
      { ...CAPTURES, pages: [], flows: dropped },
      emptySubject(),
    );
    expect(observation.screens).toEqual([]);
    expect(observation.flows.map((f) => [f.name, f.steps.map((s) => s.label)])).toEqual([
      ['Failed', [undefined, undefined]],
      ['Secret', [undefined, undefined]],
      ['Sign in', [undefined]],
      ['Pin', [undefined]],
      ['Away', [undefined]],
    ]);
    expect(JSON.stringify(observation)).not.toContain('hunter2');
    // The merge still hears about each, so a run can say why it was not remembered.
    expect(observation.flows.map((f) => [f.passed, f.secret])).toEqual([
      [false, undefined],
      [true, true],
      [true, undefined],
      [true, undefined],
      [true, undefined],
    ]);
  });

  it('judges flows by the secret fields the model already knows, as the merge will', () => {
    const code = { selector: '#code', key: 'code', box: { x: 0, y: 0, width: 10, height: 10 } };
    const size = { width: 390, height: 844 };
    // An earlier run saw `#code` as a one-time code field.
    const model = mergeSubject(
      emptySubject(),
      {
        revision: '000000000000',
        screens: [{ path: '/x', viewport: 'mobile', size, elements: [{ ...code, secret: true }] }],
        flows: [],
        commands: [],
      },
      { expireAfter: 20 },
    );
    const frame = (image: string, elements: ScannedElement[]) => ({
      image,
      scan: scan(elements, undefined, '/x'),
    });
    const pin: SubjectFlowRun = {
      ...LOAD,
      flow: { name: 'Pin', path: '/x', steps: [{ fill: '#code', text: '1234' }] },
      labels: ['hunter2'],
      frames: [frame('a.png', [el('#typed', 'hunter2', code.box)])],
    };
    // A failed flow's frame shows `#code` as ordinary; the merge never takes that frame, so it
    // must not clear the mark here either.
    const failed: SubjectFlowRun = {
      ...LOAD,
      flow: { ...LOAD.flow, name: 'Failed' },
      passed: false,
      frames: [frame('b.png', [el('#code', 'code', code.box)])],
    };
    const captures = { ...CAPTURES, pages: [], flows: [pin, failed] };
    const observation = subjectObservation(captures, model);
    expect(observation.screens).toEqual([]);
    expect(JSON.stringify(observation)).not.toContain('hunter2');
    const merged = mergeSubjectWithOutcomes(model, observation, { expireAfter: 20 });
    expect(merged.flows.map((f) => f.outcome)).toEqual(['secret', 'failed']);
    // Without that earlier run, the same flow is kept, with what its frames saw.
    const fresh = subjectObservation(captures, emptySubject());
    expect(fresh.screens.map((s) => s.elements.map((e) => e.selector))).toEqual([['#typed']]);
    expect(fresh.flows[0]!.steps[0]!.label).toBe('hunter2');
  });

  it('indexes where each element is in each head image, at its viewport', () => {
    const model = mergeSubject(emptySubject(), subjectObservation(CAPTURES, emptySubject()), {
      expireAfter: 20,
    });
    const elsewhere = { image: 'x.png', scan: scan([], undefined, '/elsewhere') };
    const flows = [{ ...LOAD, frames: [FRAME, elsewhere] }];
    expect(subjectImages(model, { pages: [PAGE], flows })).toEqual([
      {
        path: demoPath.pageCrop('home-mobile', 'after'),
        screen: 'home',
        viewport: 'mobile',
        // `top` is above the crop and `half` mostly outside it; `edge` is 75% in, so it is cut.
        elements: [
          { key: 'edge', x: 20, y: 0, width: 60, height: 60 },
          { key: 'load', x: 20, y: 100, width: 60, height: 80 },
        ],
      },
      {
        path: demoPath.flowFrame('flow-load-items', 1, 'head'),
        screen: 'home',
        viewport: 'mobile',
        // Scrolled by 100 CSS px: 200 image px up.
        elements: [{ key: 'load', x: 20, y: 300, width: 60, height: 80 }],
      },
    ]);
  });

  it('places boxes at desktop scale, after a horizontal scroll and a crop that starts mid-page', () => {
    const desktop: SubjectPage = {
      id: 'home-desktop',
      viewport: 'desktop',
      window: { x: 0, y: 1000, width: 1280, height: 800 },
      scan: scan([el('#load', 'load', { x: 300, y: 1100, width: 80, height: 40 })]),
    };
    const frame = {
      image: demoPath.flowFrame('flow-load-items', 2, 'head'),
      scan: scan([el('#load', 'load', { x: 300, y: 1100, width: 80, height: 40 })], {
        x: 200,
        y: 900,
      }),
    };
    const run = { ...LOAD, viewport: 'desktop' as const, frames: [frame] };
    const captures = { ...CAPTURES, pages: [desktop], flows: [run] };
    const model = mergeSubject(emptySubject(), subjectObservation(captures, emptySubject()), {
      expireAfter: 20,
    });
    expect(subjectImages(model, captures).map((i) => [i.path, i.viewport, i.elements])).toEqual([
      [
        demoPath.pageCrop('home-desktop', 'after'),
        'desktop',
        [{ key: 'load', x: 300, y: 100, width: 80, height: 40 }],
      ],
      [frame.image, 'desktop', [{ key: 'load', x: 100, y: 200, width: 80, height: 40 }]],
    ]);
    // Only head crops are named: a page's base crop is never indexed.
    expect(JSON.stringify(subjectImages(model, captures))).not.toContain(
      demoPath.pageCrop('home-desktop', 'before'),
    );
  });

  it('caps the index at images it keeps, not at images it skipped', () => {
    const model = mergeSubject(emptySubject(), subjectObservation(CAPTURES, emptySubject()), {
      expireAfter: 20,
    });
    const unknown = Array.from({ length: SUBJECT_LIMITS.images }, (_, i) => ({
      image: `u${i}.png`,
      scan: scan([], undefined, '/elsewhere'),
    }));
    const known = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...FRAME, image: `k${i}.png` }));
    const index = (frames: SubjectFlowRun['frames']) =>
      subjectImages(model, { pages: [], flows: [{ ...LOAD, frames }] }).map((i) => i.path);
    expect(index([...unknown, ...known(1)])).toEqual(['k0.png']);
    expect(index(known(SUBJECT_LIMITS.images + 1))).toHaveLength(SUBJECT_LIMITS.images);
  });

  describe('focus from the model', () => {
    const before = mergeSubject(
      emptySubject(),
      {
        revision: REV,
        screens: [
          {
            path: '/',
            viewport: 'desktop',
            size: { width: 1280, height: 800 },
            elements: [
              { selector: '#load', key: 'load', box: { x: 0, y: 0, width: 10, height: 10 } },
            ],
          },
        ],
        flows: [],
        commands: [],
      },
      { expireAfter: 20 },
    );
    const page = (elements: ScannedElement[], viewport: ViewportName = 'desktop'): SubjectPage => ({
      id: `home-${viewport}`,
      viewport,
      scan: scan(elements),
      window: { x: 0, y: 0, width: 1280, height: 800 },
    });
    const size = { width: 1280, height: 800 };
    const load = el('#load', 'load', { x: 40, y: 40, width: 60, height: 30 });
    const retry = el('#retry', 'retry', { x: 120, y: 40, width: 60, height: 30 });

    it('focuses a page capture on what is new since the model last saw the screen', () => {
      expect(subjectFocus(before, page([load, retry]), size)).toEqual({
        x: 108,
        y: 28,
        width: 84,
        height: 54,
      });
      // Never seen at this viewport, nothing new, a redesign, or too large a region: no focus.
      expect(subjectFocus(before, page([load, retry], 'mobile'), size)).toBeUndefined();
      expect(subjectFocus(before, page([load]), size)).toBeUndefined();
      const redesign = [1, 2, 3, 4].map((i) =>
        el(`#n${i}`, `n${i}`, { x: i * 10, y: 0, width: 5, height: 5 }),
      );
      expect(subjectFocus(before, page([load, ...redesign]), size)).toBeUndefined();
      const hero = el('#hero', 'hero', { x: 0, y: 0, width: 1280, height: 700 });
      expect(subjectFocus(before, page([load, hero]), size)).toBeUndefined();
      expect(subjectFocus(emptySubject(), page([load, retry]), size)).toBeUndefined();
    });

    it('counts an element as known only at the viewports it was seen at', () => {
      const menu = el('#menu', 'menu', { x: 300, y: 10, width: 40, height: 40 });
      const screen = (viewport: ViewportName, elements: ScannedElement[]) => ({
        path: '/',
        viewport,
        size: { width: 390, height: 844 },
        elements,
      });
      const both = mergeSubject(
        emptySubject(),
        {
          revision: REV,
          screens: [screen('desktop', [load, menu]), screen('mobile', [load])],
          flows: [],
          commands: [],
        },
        { expireAfter: 20 },
      );
      const mobile: SubjectPage = {
        id: 'home-mobile',
        viewport: 'mobile',
        scan: scan([load, menu]),
        window: { x: 0, y: 0, width: 780, height: 1688 },
      };
      // The menu was on desktop only: on mobile it is new. Scale 2, padded by 24 image px.
      expect(subjectFocus(both, mobile, { width: 780, height: 1688 })).toEqual({
        x: 576,
        y: 0,
        width: 128,
        height: 124,
      });
      expect(subjectFocus(both, page([load, menu]), size)).toBeUndefined();
    });

    it('focuses only head-only page shots, as an app.url run takes them', () => {
      const image = { path: demoPath.pageCrop('home-desktop', 'after'), ...size };
      const shot = (extra: Partial<DemoShot> = {}): DemoShot => ({
        id: 'home-desktop',
        kind: 'page',
        name: '/',
        viewport: 'desktop',
        after: image,
        ...extra,
      });
      const pages = [page([load, retry])];
      // The app ran at head only: no base image, so no pixel diff could locate the change.
      const headOnly = shot();
      expect(focusShots(before, pages, [headOnly])).toEqual(['home-desktop']);
      expect(headOnly.focus).toEqual({ x: 108, y: 28, width: 84, height: 54 });
      // Base and head were compared: a diff, or the lack of one, is the answer, not the model.
      const base = { path: demoPath.pageCrop('home-desktop', 'before'), ...size };
      const compared = shot({ before: base, diff: { changedRatio: 0 } });
      // Each on its own also counts: a base image, or a diff.
      const withBase = shot({ before: base });
      const diffed = shot({ diff: { changedRatio: 0 } });
      const located = shot({
        diff: { changedRatio: 0.1 },
        focus: { x: 1, y: 1, width: 5, height: 5 },
      });
      const step = shot({ kind: 'flow-step', id: 'flow-load-items-s1' });
      const other = shot({ id: 'pricing-desktop' });
      const skipped = [compared, withBase, diffed, located, step, other];
      expect(focusShots(before, pages, skipped)).toEqual([]);
      for (const s of [compared, withBase, diffed]) expect(s.focus).toBeUndefined();
      expect(located.focus).toEqual({ x: 1, y: 1, width: 5, height: 5 });
      expect(step.focus).toBeUndefined();
      expect(other.focus).toBeUndefined();
    });
  });
});
