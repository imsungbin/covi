import { describe, expect, it } from 'vitest';
import {
  type ObservedScreen,
  SUBJECT_LIMITS,
  type SubjectFlowObservation,
  type SubjectObservation,
  SubjectSchema,
} from '../src/model/subject.ts';
import {
  actsOnSecret,
  emptySubject,
  flowKept,
  hasObservations,
  mergeSubject,
  mergeSubjectWithOutcomes,
  secretSelectors,
} from '../src/subject/merge.ts';

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
        viewports: [{ name: 'desktop', width: 1280, height: 800, since: rev(1) }],
      }),
    ]);
    expect(model.screens[0]!.elements).toEqual([
      {
        key: 'load',
        selector: '#load',
        role: 'button',
        label: 'Load',
        boxes: { desktop: { x: 40, y: 120, width: 60, height: 30, seen: rev(1), since: rev(1) } },
        seen: rev(1),
      },
    ]);
    // Same selector, new label and key hint: still the same element, so its key stays, and its
    // stamp too: one revision old is younger than half the window.
    model = mergeSubject(
      model,
      at(2, {
        screens: [{ ...home([{ ...load, key: 'fetch', label: 'Fetch' }]), path: '/?tab=2#top' }],
      }),
      OPTS,
    );
    expect(model.screens).toHaveLength(1);
    expect(model.screens[0]!.elements.map((e) => [e.key, e.label, e.seen])).toEqual([
      ['load', 'Fetch', rev(1)],
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
      { name: 'desktop', width: 1440, height: 900, since: rev(1) },
      { name: 'mobile', width: 390, height: 844, since: rev(1) },
    ]);
    expect(model.screens[0]!.elements[0]!.boxes).toEqual({
      desktop: { x: 50, y: 131, width: 60, height: 30, seen: rev(1), since: rev(1) },
      mobile: { x: 20, y: 300, width: 120, height: 60, seen: rev(1), since: rev(1) },
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
        boxes: {
          desktop: { x: 0, y: 0, width: 1, height: 100_000, seen: rev(1), since: rev(1) },
        },
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

  it('writes the same bytes at the next commit when nothing changed', () => {
    const file = (model: unknown) => `${JSON.stringify(model, null, 2)}\n`;
    const observed = (n: number) =>
      at(n, {
        screens: [home([load]), home([load], 'mobile')],
        flows: [flow],
        commands: [{ kind: 'cli', name: 'Help', exitCode: 0 }],
      });
    const first = mergeSubject(emptySubject(), observed(1), { expireAfter: 20 });
    let model = first;
    // Stamps younger than half the window stay, and a run that changes nothing records nothing.
    for (let n = 2; n <= 6; n++) model = mergeSubject(model, observed(n), { expireAfter: 20 });
    expect(file(model)).toBe(file(first));
    // A real change is written, and records its revision; what did not change keeps its stamp.
    const moved = { ...load, box: { ...load.box, y: 140 } };
    model = mergeSubject(
      model,
      { ...observed(7), screens: [home([moved]), home([load], 'mobile')] },
      { expireAfter: 20 },
    );
    expect(model.revisions).toEqual([rev(7), rev(1)]);
    expect(model.screens[0]!.elements[0]!.boxes.desktop).toMatchObject({ y: 140 });
    expect(model.flows[0]!.passed).toBe(rev(1));
  });

  it('refreshes a stamp once it is half the window old, so what is still seen never expires', () => {
    const opts = { expireAfter: 4 };
    const pricing = page('/pricing', [{ ...load, selector: '#buy', key: 'buy' }]);
    let model = mergeSubject(emptySubject(), at(1, { screens: [home([load]), pricing] }), opts);
    // Each commit moves the Load button, so each records its revision.
    const moved = (n: number) => home([{ ...load, box: { ...load.box, y: 100 + n } }]);
    model = mergeSubject(model, at(2, { screens: [moved(2), pricing] }), opts);
    expect(model.screens.find((s) => s.key === 'pricing')!.seen).toBe(rev(1));
    model = mergeSubject(model, at(3, { screens: [moved(3), pricing] }), opts);
    // Two of four revisions old: refreshed.
    expect(model.screens.find((s) => s.key === 'pricing')!.seen).toBe(rev(3));
    for (const n of [4, 5, 6, 7])
      model = mergeSubject(model, at(n, { screens: [moved(n), pricing] }), opts);
    expect(model.revisions).toEqual([rev(7), rev(6), rev(5), rev(4)]);
    expect(model.screens.map((s) => s.key)).toEqual(['home', 'pricing']);
    expect(model.screens[1]!.elements.map((e) => e.key)).toEqual(['buy']);
  });

  it('keeps aging an element a screen no longer shows until it is forgotten', () => {
    const retry = { ...load, selector: '#retry', key: 'retry' };
    let model = mergeSubject(emptySubject(), at(1, { screens: [home([load, retry])] }), OPTS);
    // Nothing else changes, yet each run that sees the screen without the button counts.
    for (const n of [2, 3]) {
      model = mergeSubject(model, at(n, { screens: [home([load])] }), OPTS);
      expect(model.screens[0]!.elements.map((e) => e.key)).toEqual(['load', 'retry']);
    }
    model = mergeSubject(model, at(4, { screens: [home([load])] }), OPTS);
    expect(model.screens[0]!.elements.map((e) => e.key)).toEqual(['load']);
    // Only the viewport that lost it counts: another viewport not showing it changes nothing.
    const mobileOnly = mergeSubject(
      emptySubject(),
      at(1, { screens: [home([load, retry]), home([load], 'mobile')] }),
      OPTS,
    );
    expect(mergeSubject(mobileOnly, at(2, { screens: [home([load], 'mobile')] }), OPTS)).toBe(
      mobileOnly,
    );
  });

  it('forgets a flow and a scenario not seen in expireAfter revisions', () => {
    let model = mergeSubject(
      emptySubject(),
      at(1, { flows: [flow], commands: [{ kind: 'http', name: 'Users', status: 200 }] }),
      OPTS,
    );
    const moved = (n: number) => home([{ ...load, box: { ...load.box, y: n } }]);
    for (const n of [2, 3]) model = mergeSubject(model, at(n, { screens: [moved(n)] }), OPTS);
    expect(model.flows.map((f) => f.key)).toEqual(['load-items']);
    expect(model.commands.map((c) => c.key)).toEqual(['users']);
    model = mergeSubject(model, at(4, { screens: [moved(4)] }), OPTS);
    expect(model.flows).toEqual([]);
    expect(model.commands).toEqual([]);
  });

  it('forgets a replayed flow that keeps failing, even when nothing else changes', () => {
    let model = mergeSubject(emptySubject(), at(1, { flows: [flow] }), OPTS);
    const failing = { ...flow, passed: false };
    for (const n of [2, 3]) {
      model = mergeSubject(model, at(n, { flows: [failing] }), OPTS);
      expect(model.flows.map((f) => f.passed)).toEqual([rev(1)]);
    }
    model = mergeSubject(model, at(4, { flows: [failing] }), OPTS);
    expect(model.flows).toEqual([]);
    // A flow the model never kept failing is no news.
    const other = mergeSubject(emptySubject(), at(1, { screens: [home([load])] }), OPTS);
    expect(mergeSubject(other, at(2, { flows: [failing] }), OPTS)).toBe(other);
  });

  it('records when each box and viewport was first seen, and keeps it', () => {
    let model = mergeSubject(emptySubject(), at(1, { screens: [home([load])] }), OPTS);
    const moved = { ...load, box: { ...load.box, y: 200 } };
    model = mergeSubject(model, at(2, { screens: [home([moved]), home([load], 'mobile')] }), OPTS);
    const screen = model.screens[0]!;
    expect(screen.viewports.map((v) => [v.name, v.since])).toEqual([
      ['desktop', rev(1)],
      ['mobile', rev(2)],
    ]);
    expect(screen.elements[0]!.boxes.desktop).toMatchObject({ y: 200, since: rev(1) });
    expect(screen.elements[0]!.boxes.mobile).toMatchObject({ since: rev(2) });
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
    expect(actsOnSecret({ fill: '#comment', text: 'Hi' })).toBe(false);
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

  it('tells a secret field by the words of its selector or note, not by substrings', () => {
    const fill = (selector: string, note?: string) => ({
      fill: selector,
      text: 'x',
      ...(note ? { note } : {}),
    });
    for (const selector of [
      '#password',
      'input[name=otp]',
      '#pinCode',
      '#user_pin',
      '#pwd',
      '#passwd',
      '#cc-number',
      '#cc-csc',
      '#cc-exp',
      '#ccExpMonth',
      '#security-code',
      '#verification-code',
      '#mfa-code',
      '#totp',
      '#twoFactor2faCode',
      '#apiKey',
      '#apikey',
      '#cardNum',
      '#cardnumber',
      '#ccnum',
      '#ccNum',
      '#creditcard',
      '#oneTimeCode',
      '#creditCard',
      '#card',
      'input[name=card]',
      '[data-testid=account-token]',
      '#ssn',
    ])
      expect(actsOnSecret(fill(selector)), selector).toBe(true);
    expect(actsOnSecret(fill('#field', 'Type the card number'))).toBe(true);
    expect(actsOnSecret(fill('#field', 'Enter the PIN'))).toBe(true);
    for (const selector of [
      '#passenger-name',
      '#compass',
      '#bypass-note',
      '#footprint',
      'input[name=classname]',
      '#discard-reason',
      '#tokenizer-input',
      '#pricing-card-title',
      '#comment',
      '#spinner',
      '#opinion',
      '#cardinal',
      '#numeric-card-count',
    ])
      expect(actsOnSecret(fill(selector)), selector).toBe(false);
    expect(actsOnSecret(fill('#field', 'Describe the pricing card'))).toBe(false);
    expect(actsOnSecret({ click: '#password' })).toBe(false);
    // An element the page marked secret is secret whatever its selector says.
    expect(actsOnSecret(fill('#f-17'), new Set(['#f-17']))).toBe(true);
  });

  it('tells a secret field a step presses keys in or chooses from, as well as one it fills', () => {
    for (const step of [
      { press: 'Digit1', selector: '#otp' },
      { press: 'Enter', selector: 'input[name=password]' },
      { select: '#cc-exp-month', value: '01' },
      { select: '[data-testid=card-pin]', value: '1' },
    ])
      expect(actsOnSecret(step), JSON.stringify(step)).toBe(true);
    expect(actsOnSecret({ press: 'Enter', selector: '#f-9' }, new Set(['#f-9']))).toBe(true);
    expect(actsOnSecret({ select: '#f-9', value: '1' }, new Set(['#f-9']))).toBe(true);
    for (const step of [
      { press: 'Enter', selector: '#search' },
      { press: 'Enter' },
      { select: '#size', value: 'M' },
      { hover: '#password' },
      { check: '#otp' },
    ])
      expect(actsOnSecret(step), JSON.stringify(step)).toBe(false);
    const presses: SubjectFlowObservation = {
      ...flow,
      steps: [{ action: { press: 'Digit1', selector: '#otp' } }],
    };
    expect(mergeSubject(emptySubject(), at(1, { flows: [presses] }), OPTS).flows).toEqual([]);
  });

  it('never keeps a flow that types into a field the page marked secret', () => {
    const typesIntoCode: SubjectFlowObservation = {
      ...flow,
      steps: [{ action: { fill: '#f-17', text: '123456' } }],
    };
    const seenSecret = { ...load, selector: '#f-17', key: 'f', secret: true };
    // Marked in this run's own observation...
    const now = mergeSubjectWithOutcomes(
      emptySubject(),
      at(1, { screens: [home([seenSecret])], flows: [typesIntoCode] }),
      OPTS,
    );
    expect(now.model.flows).toEqual([]);
    expect(now.flows).toEqual([{ name: 'Load items', outcome: 'secret' }]);
    // ...or in the model from an earlier run.
    const later = mergeSubject(now.model, at(2, { flows: [typesIntoCode] }), OPTS);
    expect(later.flows).toEqual([]);
    expect(
      mergeSubject(emptySubject(), at(1, { flows: [typesIntoCode] }), OPTS).flows,
    ).toHaveLength(1);
  });

  it("names the secret fields a flow is judged by, once a run's screens are merged", () => {
    const seenSecret = { ...load, selector: '#f-17', key: 'f', secret: true };
    const model = mergeSubject(emptySubject(), at(1, { screens: [home([seenSecret])] }), OPTS);
    expect([...secretSelectors(model)]).toEqual(['#f-17']);
    // A screen that shows the field as ordinary clears it, as the merge would; other screens do not.
    expect([...secretSelectors(model, [home([{ ...seenSecret, secret: undefined }])])]).toEqual([]);
    expect([...secretSelectors(model, [page('/other', [load])])]).toEqual(['#f-17']);
    expect([...secretSelectors(emptySubject(), [home([seenSecret])])]).toEqual(['#f-17']);
    // Asking never changes the model.
    expect(model.screens[0]!.elements[0]!.secret).toBe(true);
  });

  it('says why each flow is or is not remembered, without its values', () => {
    const steps = (n: number) =>
      Array.from({ length: n }, () => ({ action: { click: '#load' } as const }));
    const cases: Array<[SubjectFlowObservation, string]> = [
      [flow, 'kept'],
      [{ ...flow, name: 'Broken', passed: false }, 'failed'],
      [
        { ...flow, name: 'Login', steps: [{ action: { fill: '#password', text: 'hunter2' } }] },
        'secret',
      ],
      [
        { ...flow, name: 'Notes', steps: [{ action: { fill: '#notes', text: 'one\ntwo' } }] },
        'invalid',
      ],
      [{ ...flow, name: 'Long', steps: steps(SUBJECT_LIMITS.steps + 1) }, 'invalid'],
      [
        { ...flow, name: 'Away', steps: [{ action: { goto: 'https://evil.example/' } }] },
        'invalid',
      ],
      [{ ...flow, name: '\n' }, 'invalid'],
    ];
    for (const [observed, outcome] of cases)
      expect(flowKept(observed), observed.name).toBe(outcome);
    const merged = mergeSubjectWithOutcomes(
      emptySubject(),
      at(1, { flows: cases.map(([f]) => f) }),
      OPTS,
    );
    expect(merged.flows).toEqual([
      { name: 'Load items', outcome: 'kept' },
      { name: 'Broken', outcome: 'failed' },
      { name: 'Login', outcome: 'secret' },
      { name: 'Notes', outcome: 'invalid' },
      { name: 'Long', outcome: 'invalid' },
      { name: 'Away', outcome: 'invalid' },
      { outcome: 'invalid' },
    ]);
    expect(merged.model.flows.map((f) => f.name)).toEqual(['Load items']);
    expect(JSON.stringify(merged.flows)).not.toContain('hunter2');
  });

  it('falls back to the default expiry when expireAfter is not a number', () => {
    const model = mergeSubject(emptySubject(), at(1, { screens: [home([load])] }), OPTS);
    for (const expireAfter of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = mergeSubject(model, at(2, { screens: [home([])] }), { expireAfter });
      expect(next.revisions).toEqual([rev(2), rev(1)]);
      expect(next.screens[0]!.elements.map((e) => e.key)).toEqual(['load']);
    }
  });

  it('cuts long text without splitting a character made of two code units', () => {
    const fox = '\u{1F98A}';
    const model = mergeSubject(
      emptySubject(),
      at(1, { screens: [home([{ ...load, label: fox.repeat(SUBJECT_LIMITS.label) }])] }),
      OPTS,
    );
    // The cut at 119 code units falls inside the 60th fox, which goes whole.
    const label = model.screens[0]!.elements[0]!.label!;
    expect(label.isWellFormed()).toBe(true);
    expect(label).toBe(`${fox.repeat((SUBJECT_LIMITS.label - 2) / 2)}…`);
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
