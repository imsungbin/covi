import { describe, expect, it } from 'vitest';
import {
  parseSubjectRef,
  SUBJECT_LIMITS,
  SubjectRefSchema,
  SubjectSchema,
  SubjectScreenSchema,
  SubjectSnapshotSchema,
  screenKeyOf,
  screenPath,
  subjectKey,
  uniqueKey,
} from '../src/model/subject.ts';
import { DEMO_PATHS, SUBJECT_PATHS } from '../src/run/paths.ts';

const REV = '000000000001';

const ELEMENT = {
  key: 'load',
  selector: '#load',
  role: 'button',
  label: 'Load',
  boxes: { desktop: { x: 40, y: 120, width: 60, height: 30, seen: REV } },
  seen: REV,
};

const MODEL = {
  schemaVersion: 1,
  revisions: [REV],
  screens: [
    {
      key: 'home',
      path: '/',
      title: 'Items',
      viewports: [{ name: 'desktop', width: 1280, height: 800 }],
      elements: [ELEMENT],
      seen: REV,
    },
  ],
  flows: [
    {
      key: 'load-items',
      name: 'Load items',
      path: '/',
      viewport: 'desktop',
      steps: [{ action: { click: '#load', note: 'Load the items' }, label: 'Load the items' }],
      passed: REV,
    },
  ],
  commands: [{ key: 'help', kind: 'cli', name: 'Help', exitCode: 0, seen: REV }],
};

describe('subject keys and references', () => {
  it('names screens and elements the way references write them', () => {
    expect(subjectKey('Start trial', 'element')).toBe('start-trial');
    expect(subjectKey('  ¿¡!! ', 'element')).toBe('element');
    expect(subjectKey(`${'a'.repeat(39)} b`, 'x')).toBe('a'.repeat(39));
    expect(uniqueKey('load', new Set(['load', 'load-2']))).toBe('load-3');
    expect(uniqueKey('load', new Set(['other']))).toBe('load');
    expect(screenPath('/pricing/?plan=team#faq')).toBe('/pricing');
    expect(screenPath('https://evil.example/x')).toBe('/x');
    expect(screenPath('/')).toBe('/');
    expect(screenKeyOf('/')).toBe('home');
    expect(screenKeyOf('/settings/billing')).toBe('settings-billing');
    expect(parseSubjectRef('subject:home#load')).toEqual({ screen: 'home', element: 'load' });
    for (const bad of ['subject:Home#load', 'home#load', 'subject:home', 'subject:home#a#b'])
      expect(parseSubjectRef(bad), bad).toBeUndefined();
    expect(DEMO_PATHS.subject).toBe('demo/subject.json');
    expect(SUBJECT_PATHS).toEqual({
      repo: '.covi/subject/subject.json',
      runs: 'subject.json',
      lock: '.subject.lock',
    });
  });

  it('gives a screen a path the model accepts, or none at all', () => {
    expect(screenPath('http://localhost:3000//admin')).toBe('/admin');
    expect(screenPath('/.//admin')).toBe('/admin');
    expect(screenPath('/a//b//')).toBe('/a/b');
    expect(screenPath('/\\evil.example/x')).toBe('/x');
    expect(screenPath(`/${'a'.repeat(SUBJECT_LIMITS.path)}`)).toBeUndefined();
    expect(screenPath('http://[')).toBeUndefined();
    for (const url of ['http://h//admin', '/.//admin', '/\\evil.example/x', '/a//b//', '/']) {
      const path = screenPath(url)!;
      const screen = { key: screenKeyOf(path), path, viewports: [], elements: [], seen: REV };
      expect(SubjectScreenSchema.safeParse(screen).success, url).toBe(true);
    }
  });

  it('checks a reference written in a storyboard', () => {
    expect(SubjectRefSchema.parse('subject:checkout#place-order')).toBe(
      'subject:checkout#place-order',
    );
    for (const bad of ['subject:checkout', 'subject:Checkout#a', 'subject:-a#b', 'checkout#a', ''])
      expect(SubjectRefSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe('SubjectSchema', () => {
  it('reads a model Covi wrote', () => {
    expect(SubjectSchema.parse(MODEL)).toEqual(MODEL);
  });

  it('refuses anything that could run, leave the app, or write to a terminal', () => {
    const screen = MODEL.screens[0]!;
    const flow = MODEL.flows[0]!;
    const bad = {
      'a command line': { ...MODEL, commands: [{ ...MODEL.commands[0], run: 'rm -rf /' }] },
      'a goto off the app': {
        ...MODEL,
        flows: [{ ...flow, steps: [{ action: { goto: 'https://evil.example/' } }] }],
      },
      'a goto through a backslash': {
        ...MODEL,
        flows: [{ ...flow, steps: [{ action: { goto: '/\\evil.example/' } }] }],
      },
      'a protocol-relative path': { ...MODEL, flows: [{ ...flow, path: '//evil.example/' }] },
      'a path through a backslash': { ...MODEL, flows: [{ ...flow, path: '/\\evil.example' }] },
      'a terminal escape': { ...MODEL, screens: [{ ...screen, title: 'Items\u001b[31m' }] },
      'a line separator': { ...MODEL, screens: [{ ...screen, title: 'Items\u2028Admin' }] },
      'a bidi override': {
        ...MODEL,
        screens: [{ ...screen, elements: [{ ...ELEMENT, label: 'Load\u202e' }] }],
      },
      'a bidi isolate': { ...MODEL, flows: [{ ...flow, name: 'Load\u2066items' }] },
      'a step selector longer than an element selector may be': {
        ...MODEL,
        flows: [
          { ...flow, steps: [{ action: { click: `#${'a'.repeat(SUBJECT_LIMITS.selector)}` } }] },
        ],
      },
      'a two-line selector': {
        ...MODEL,
        screens: [{ ...screen, elements: [{ ...ELEMENT, selector: '#a\n#b' }] }],
      },
      'an unknown viewport': {
        ...MODEL,
        screens: [
          { ...screen, elements: [{ ...ELEMENT, boxes: { watch: ELEMENT.boxes.desktop } }] },
        ],
      },
      'a viewport without its size': {
        ...MODEL,
        screens: [{ ...screen, viewports: [{ name: 'desktop' }] }],
      },
      'a newer version': { ...MODEL, schemaVersion: 2 },
    };
    for (const [what, model] of Object.entries(bad))
      expect(SubjectSchema.safeParse(model).success, what).toBe(false);
  });

  it('caps a step selector like an element selector, and typed text like any other value', () => {
    const flow = MODEL.flows[0]!;
    const typed = { fill: `#${'a'.repeat(SUBJECT_LIMITS.selector - 1)}`, text: 'a'.repeat(500) };
    const model = { ...MODEL, flows: [{ ...flow, steps: [{ action: typed }] }] };
    expect(SubjectSchema.safeParse(model).success).toBe(true);
  });

  it('is bounded: keys are unique and lists capped', () => {
    const screen = MODEL.screens[0]!;
    const twice = { ...MODEL, screens: [{ ...screen, elements: [ELEMENT, ELEMENT] }] };
    expect(SubjectSchema.safeParse(twice).error?.issues[0]?.message).toBe(
      'duplicate element key "load"',
    );
    const desktop = screen.viewports[0]!;
    const sameViewport = {
      ...MODEL,
      screens: [{ ...screen, viewports: [desktop, { ...desktop, width: 1440 }] }],
    };
    expect(SubjectSchema.safeParse(sameViewport).error?.issues[0]?.message).toBe(
      'duplicate viewport "desktop"',
    );
    const many = {
      ...MODEL,
      screens: [
        {
          ...screen,
          elements: Array.from({ length: SUBJECT_LIMITS.elements + 1 }, (_, i) => ({
            ...ELEMENT,
            key: `e${i}`,
            selector: `#e${i}`,
          })),
        },
      ],
    };
    expect(SubjectSchema.safeParse(many).success).toBe(false);
  });

  it('keeps a run snapshot: the model and where elements are in each head image', () => {
    const snapshot = {
      schemaVersion: 1,
      store: 'repo',
      revision: REV,
      model: MODEL,
      images: [
        {
          path: 'demo/screenshots/home-desktop-after.png',
          screen: 'home',
          viewport: 'desktop',
          elements: [{ key: 'load', x: 40, y: 120, width: 60, height: 30 }],
        },
      ],
    };
    expect(SubjectSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(SubjectSnapshotSchema.safeParse({ ...snapshot, store: 'off' }).success).toBe(false);
    const image = snapshot.images[0]!;
    for (const path of [
      '../outside.png',
      'demo/../../x.png',
      '/etc/passwd',
      'C:/x.png',
      'demo\\x.png',
    ])
      expect(
        SubjectSnapshotSchema.safeParse({ ...snapshot, images: [{ ...image, path }] }).success,
        path,
      ).toBe(false);
    const crowded = {
      ...image,
      elements: Array.from({ length: SUBJECT_LIMITS.elements + 1 }, (_, i) => ({
        ...image.elements[0]!,
        key: `e${i}`,
      })),
    };
    expect(SubjectSnapshotSchema.safeParse({ ...snapshot, images: [crowded] }).success).toBe(false);
    crowded.elements.pop();
    expect(SubjectSnapshotSchema.safeParse({ ...snapshot, images: [crowded] }).success).toBe(true);
  });
});
