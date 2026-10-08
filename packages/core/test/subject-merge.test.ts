import { describe, expect, it } from 'vitest';
import {
  type ObservedScreen,
  SUBJECT_LIMITS,
  type SubjectFlowObservation,
  type SubjectObservation,
  SubjectSchema,
} from '../src/model/subject.ts';
import { emptySubject, fillsSecret, hasObservations, mergeSubject } from '../src/subject/merge.ts';

const rev = (n: number) => String(n).padStart(12, '0');
const at = (
  n: number,
  parts: Partial<Omit<SubjectObservation, 'revision'>>,
): SubjectObservation => ({
  revision: rev(n),
  screens: [],
  flows: [],
  commands: [],
  ...parts,
});
const SIZES = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};
const home = (
  elements: ObservedScreen['elements'],
  viewport: ObservedScreen['viewport'] = 'desktop',
): ObservedScreen => ({ path: '/', title: 'Items', viewport, size: SIZES[viewport], elements });
const page = (path: string, elements: ObservedScreen['elements'] = []): ObservedScreen => ({
  path,
  viewport: 'desktop',
  size: SIZES.desktop,
  elements,
});
const load = {
  selector: '#load',
  key: 'load',
  role: 'button',
  label: 'Load',
  box: { x: 40, y: 120, width: 60, height: 30 },
};
const flow: SubjectFlowObservation = {
  name: 'Load items',
  path: '/',
  viewport: 'desktop',
  steps: [
    { action: { click: '#load', note: 'Load the items' }, label: 'Load the items' },
    { action: { wait: 300 } },
  ],
  passed: true,
};
const OPTS = { expireAfter: 3 };

describe('mergeSubject', () => {
  it('upserts screens and elements by path and selector, keeping keys stable', () => {
    let model = mergeSubject(emptySubject(), at(1, { screens: [home([load])] }), OPTS);
    expect(model.screens).toEqual([
      expect.objectContaining({
        key: 'home',
        path: '/',
        title: 'Items',
        viewports: [{ name: 'desktop', width: 1280, height: 800 }],
      }),
    ]);
    expect(model.screens[0]!.elements).toEqual([
      {
        key: 'load',
        selector: '#load',
        role: 'button',
        label: 'Load',
        boxes: { desktop: { x: 40, y: 120, width: 60, height: 30, seen: rev(1) } },
        seen: rev(1),
      },
    ]);
    // Same selector, new label and key hint: still the same element, so its key stays.
    model = mergeSubject(
      model,
      at(2, {
        screens: [{ ...home([{ ...load, key: 'fetch', label: 'Fetch' }]), path: '/?tab=2#top' }],
      }),
      OPTS,
    );
    expect(model.screens).toHaveLength(1);
    expect(model.screens[0]!.elements.map((e) => [e.key, e.label, e.seen])).toEqual([
      ['load', 'Fetch', rev(2)],
    ]);
  });

  it('keeps the box and size of each viewport, and only updates the one it saw', () => {
    let model = mergeSubject(
      emptySubject(),
      at(1, {
        screens: [
          home([load]),
          home([{ ...load, box: { x: 20, y: 300, width: 120, height: 60 } }], 'mobile'),
        ],
      }),
      OPTS,
    );
    model = mergeSubject(
      model,
      at(2, {
        screens: [
          {
            ...home([{ ...load, box: { x: 50.4, y: 130.6, width: 60, height: 30 } }]),
            size: { width: 1440, height: 900 },
          },
        ],
      }),
      OPTS,
    );
    expect(model.screens[0]!.viewports).toEqual([
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]);
    expect(model.screens[0]!.elements[0]!.boxes).toEqual({
      desktop: { x: 50, y: 131, width: 60, height: 30, seen: rev(2) },
      mobile: { x: 20, y: 300, width: 120, height: 60, seen: rev(1) },
    });
  });

  it('names a new entry after its own key, with a suffix when another has it', () => {
    const model = mergeSubject(
      emptySubject(),
      at(1, { screens: [home([load, { ...load, selector: 'role=button[name="Load"]' }, load])] }),
      OPTS,
    );
    expect(model.screens[0]!.elements.map((e) => [e.key, e.selector])).toEqual([
      ['load', '#load'],
      ['load-2', 'role=button[name="Load"]'],
    ]);
    // Paths that make the same key are still different screens.
    const two = mergeSubject(emptySubject(), at(1, { screens: [home([]), page('/home')] }), OPTS);
    expect(two.screens.map((s) => [s.key, s.path])).toEqual([
      ['home', '/'],
      ['home-2', '/home'],
    ]);
  });

  it('cleans page text and drops what it cannot keep, without failing the merge', () => {
    const model = mergeSubject(
      emptySubject(),
      at(1, {
        screens: [
          {
            ...home([
              { ...load, label: ' Load\n\u001b[31mnow‮ ', role: 'Button!' },
              { ...load, selector: '#bad\nselector', key: 'bad' },
              { ...load, selector: `#${'x'.repeat(SUBJECT_LIMITS.selector)}`, key: 'long' },
              {
                ...load,
                selector: '#nan',
                key: 'nan',
                box: { x: Number.NaN, y: -5, width: 0, height: 1e9 },
              },
            ]),
            title: ' ',
          },
          page(`/${'p'.repeat(SUBJECT_LIMITS.path)}`),
          page('http://['),
        ],
      }),
      OPTS,
    );
    expect(model.screens.map((s) => s.path)).toEqual(['/']);
    expect(model.screens[0]!.title).toBeUndefined();
    expect(model.screens[0]!.elements).toEqual([
      expect.objectContaining({ key: 'load', label: 'Load [31mnow' }),
      expect.objectContaining({
        key: 'nan',
        boxes: { desktop: { x: 0, y: 0, width: 1, height: 100_000, seen: rev(1) } },
      }),
    ]);
    expect(model.screens[0]!.elements[0]!.role).toBeUndefined();
  });

  it('forgets what it has not seen in expireAfter revisions, counting revisions, not runs', () => {
    let model = mergeSubject(
      emptySubject(),
      at(1, { screens: [home([load]), page('/pricing')] }),
      OPTS,
    );
    // Running again at the same revision ages nothing.
    for (let i = 0; i < 5; i++) model = mergeSubject(model, at(1, { screens: [home([])] }), OPTS);
    expect(model.revisions).toEqual([rev(1)]);
    model = mergeSubject(model, at(2, { screens: [home([])] }), OPTS);
    model = mergeSubject(model, at(3, { screens: [home([])] }), OPTS);
    // Three revisions are kept (3, 2, 1): pricing and the Load button, seen at 1, stay.
    expect(model.screens.map((s) => s.key)).toEqual(['home', 'pricing']);
    expect(model.screens[0]!.elements.map((e) => e.key)).toEqual(['load']);
    model = mergeSubject(model, at(4, { screens: [home([])] }), OPTS);
    expect(model.revisions).toEqual([rev(4), rev(3), rev(2)]);
    expect(model.screens.map((s) => s.key)).toEqual(['home']);
    expect(model.screens[0]!.elements).toEqual([]);
  });

  it('forgets a box its viewport has not seen in expireAfter revisions', () => {
    let model = mergeSubject(emptySubject(), at(1, { screens: [home([load], 'mobile')] }), OPTS);
    for (const n of [2, 3, 4])
      model = mergeSubject(model, at(n, { screens: [home([load])] }), OPTS);
    expect(Object.keys(model.screens[0]!.elements[0]!.boxes)).toEqual(['desktop']);
  });

  it('keeps the last passing version of a flow when it fails at head', () => {
    let model = mergeSubject(emptySubject(), at(1, { flows: [flow] }), OPTS);
    expect(model.flows).toEqual([
      {
        key: 'load-items',
        name: 'Load items',
        path: '/',
        viewport: 'desktop',
        steps: flow.steps,
        passed: rev(1),
      },
    ]);
    model = mergeSubject(
      model,
      at(2, { flows: [{ ...flow, steps: [{ action: { click: '#gone' } }], passed: false }] }),
      OPTS,
    );
    expect(model.flows[0]).toMatchObject({ steps: flow.steps, passed: rev(1) });
    // A flow that never passed is not kept at all.
    expect(
      mergeSubject(emptySubject(), at(1, { flows: [{ ...flow, passed: false }] }), OPTS).flows,
    ).toEqual([]);
  });

  it('never keeps a flow that fills a secret field, or one that leaves the app', () => {
    const typed = (fill: string, note?: string, text = 'hunter2'): SubjectFlowObservation => ({
      ...flow,
      steps: [{ action: { fill, text, ...(note ? { note } : {}) } }],
    });
    for (const secret of [
      typed('#password'),
      typed('input[name=otp]'),
      typed('#field', 'Type the card number'),
      { ...flow, secret: true },
    ])
      expect(mergeSubject(emptySubject(), at(1, { flows: [secret] }), OPTS).flows).toEqual([]);
    expect(fillsSecret({ fill: '#comment', text: 'Hi' })).toBe(false);
    for (const goto of ['https://evil.example/', '//evil.example/', '/\\evil.example'])
      expect(
        mergeSubject(
          emptySubject(),
          at(1, { flows: [{ ...flow, steps: [{ action: { goto } }] }] }),
          OPTS,
        ).flows,
      ).toEqual([]);
    // Typing into an ordinary field is kept: replaying the flow needs the text.
    const comment = mergeSubject(
      emptySubject(),
      at(1, { flows: [typed('#comment', undefined, 'Looks good')] }),
      OPTS,
    );
    expect(comment.flows[0]!.steps[0]!.action).toEqual({ fill: '#comment', text: 'Looks good' });
  });

  it('records CLI and HTTP scenarios without their command lines or query strings', () => {
    const model = mergeSubject(
      emptySubject(),
      at(1, {
        commands: [
          { kind: 'cli', name: 'Help', exitCode: 0, ...({ run: 'node cli.js --help' } as object) },
          { kind: 'http', name: 'Users', method: 'get', path: '/api/users?token=abc', status: 200 },
        ],
      }),
      OPTS,
    );
    expect(model.commands).toEqual([
      { key: 'help', kind: 'cli', name: 'Help', exitCode: 0, seen: rev(1) },
      {
        key: 'users',
        kind: 'http',
        name: 'Users',
        method: 'GET',
        path: '/api/users',
        status: 200,
        seen: rev(1),
      },
    ]);
    expect(JSON.stringify(model)).not.toContain('node cli.js');
  });

  it('stays within its bounds, keeping what it saw most recently', () => {
    const many = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({
        ...load,
        selector: `#${prefix}${i}`,
        key: `${prefix}${i}`,
      }));
    let model = mergeSubject(emptySubject(), at(1, { screens: [home(many(40, 'old'))] }), {
      expireAfter: 20,
    });
    model = mergeSubject(model, at(2, { screens: [home(many(40, 'new'))] }), { expireAfter: 20 });
    const keys = model.screens[0]!.elements.map((e) => e.key);
    expect(keys).toHaveLength(SUBJECT_LIMITS.elements);
    expect(keys.filter((k) => k.startsWith('new'))).toHaveLength(40);
    const screens = Array.from({ length: SUBJECT_LIMITS.screens + 5 }, (_, i) => page(`/s${i}`));
    expect(
      mergeSubject(emptySubject(), at(3, { screens }), { expireAfter: 20 }).screens,
    ).toHaveLength(SUBJECT_LIMITS.screens);
    const long = 'x'.repeat(290);
    const heavy = Array.from({ length: SUBJECT_LIMITS.screens }, (_, s) =>
      page(
        `/h${s}`,
        Array.from({ length: SUBJECT_LIMITS.elements }, (_, e) => ({
          ...load,
          selector: `#${long}${e}`,
          key: `e${e}`,
          label: long.slice(0, 120),
        })),
      ),
    );
    const bounded = mergeSubject(emptySubject(), at(4, { screens: heavy }), { expireAfter: 20 });
    expect(bounded.screens.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(`${JSON.stringify(bounded, null, 2)}\n`)).toBeLessThanOrEqual(
      SUBJECT_LIMITS.bytes,
    );
    expect(SubjectSchema.parse(bounded)).toEqual(bounded);
  });

  it('writes the same model for the same observations, sorted by key', () => {
    const observation = at(1, {
      screens: [page('/b', [{ ...load, selector: '#z', key: 'z' }, load]), home([])],
      flows: [{ ...flow, name: 'Zed' }, flow],
    });
    const a = mergeSubject(emptySubject(), observation, OPTS);
    expect(a.screens.map((s) => s.key)).toEqual(['b', 'home']);
    expect(a.screens[0]!.elements.map((e) => e.key)).toEqual(['load', 'z']);
    expect(a.flows.map((f) => f.key)).toEqual(['load-items', 'zed']);
    expect(JSON.stringify(mergeSubject(emptySubject(), structuredClone(observation), OPTS))).toBe(
      JSON.stringify(a),
    );
  });

  it('leaves the model untouched when a run saw nothing', () => {
    const model = mergeSubject(emptySubject(), at(1, { screens: [home([load])] }), OPTS);
    const nothing = at(2, {});
    expect(hasObservations(nothing)).toBe(false);
    expect(mergeSubject(model, nothing, OPTS)).toBe(model);
  });
});
