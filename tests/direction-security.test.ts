import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexEvidence, resolveConfig } from '@covi/core';
import {
  buildTimeline,
  layoutScenes,
  pacingFor,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { directionProblems } from '../packages/video/src/direction/refs.ts';
import {
  DIRECTION_LIMITS,
  DirectionSchema,
  LabelSchema,
} from '../packages/video/src/direction/schema.ts';
import { directionSources } from '../packages/video/src/direction/sources.ts';
import { canUseBrowser } from './helpers/env.ts';

/*
 * A direction file is untrusted: an agent writes it, and the repository it read can steer the
 * agent. These tests are the acceptance check of spec §14: oversized lists, script-like strings,
 * URLs, unknown evidence ids, and made-up numbers are rejected, and a label that passes
 * validation reaches the page only as text.
 */

const rejected = (value: unknown) => !DirectionSchema.safeParse(value).success;
const withLabel = (text: string) => ({
  shots: [{ scene: 's1', elements: [{ id: 'note', kind: 'label', text }] }],
});
const withNode = (label: string) => ({
  shots: [{ scene: 's1', elements: [{ id: 'node', kind: 'node', label }] }],
});

describe('a hostile direction file', () => {
  it('cannot grow past its bounds, and is not refused at them', () => {
    const shot = (i: number) => ({ scene: `s${i}`, elements: [{ id: 'v', kind: 'visual' }] });
    const shots = (n: number) => ({ shots: Array.from({ length: n }, (_, i) => shot(i)) });
    expect(rejected(shots(DIRECTION_LIMITS.shots))).toBe(false);
    expect(rejected(shots(DIRECTION_LIMITS.shots + 1))).toBe(true);
    const elements = (n: number) => ({
      shots: [
        {
          scene: 's1',
          elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: 'visual' })),
        },
      ],
    });
    expect(rejected(elements(DIRECTION_LIMITS.elementsPerShot))).toBe(false);
    expect(rejected(elements(DIRECTION_LIMITS.elementsPerShot + 1))).toBe(true);
    const beats = (n: number) => ({
      shots: [
        {
          scene: 's1',
          elements: [{ id: 'v', kind: 'visual' }],
          beats: Array.from({ length: n }, () => ({ verb: 'reveal', element: 'v' })),
        },
      ],
    });
    expect(rejected(beats(DIRECTION_LIMITS.beatsPerShot))).toBe(false);
    expect(rejected(beats(DIRECTION_LIMITS.beatsPerShot + 1))).toBe(true);
    const cited = (n: number) => ({
      shots: [
        {
          scene: 's1',
          elements: [
            {
              id: 'n',
              kind: 'node',
              label: 'Reader',
              evidence: Array.from({ length: n }, (_, i) => `diff-hunk:a.js:${i + 1}`),
            },
          ],
        },
      ],
    });
    expect(rejected(cited(DIRECTION_LIMITS.evidencePerElement))).toBe(false);
    expect(rejected(cited(DIRECTION_LIMITS.evidencePerElement + 1))).toBe(true);
    expect(rejected(withLabel('x'.repeat(DIRECTION_LIMITS.labelChars)))).toBe(false);
    expect(rejected(withLabel('x'.repeat(DIRECTION_LIMITS.labelChars + 1)))).toBe(true);
  });

  it('cannot smuggle markup, script, or links through a label or a node', () => {
    for (const text of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      'x onerror=alert(1)',
      '"><svg onload=alert(1)>',
      'https://evil.example/x',
      'www.evil.example',
      '{{constructor}}',
      'a`b`',
      // Full-width letters and colons pass the allowlist (CJK labels use them); NFKC folds them.
      'ｗｗｗ.evil.example',
      'ｈｔｔｐｓ：//x',
      'ｊａｖａｓｃｒｉｐｔ：alert',
      // Invisible characters that letters and marks would let in, splitting what the checks seek.
      'https:\u034f//evil.example',
      'https:\ufe0f//evil.example',
      'w\u034fww.evil.example',
      '\u3164\u3164\u3164',
      // Ideographic full stops, which address parsing reads as dots.
      'www。evil。example',
      // Bidi controls, which reorder what is drawn.
      'abc\u202edef',
      'safe\u2067txt.exe\u2069',
    ]) {
      expect(rejected(withLabel(text)), text).toBe(true);
      expect(rejected(withNode(text)), text).toBe(true);
    }
    expect(rejected(withLabel('「요청」이 큼！'))).toBe(false);
    expect(rejected(withLabel('Stale data: refetch'))).toBe(false);
    expect(rejected(withNode('タイム・アウト。'))).toBe(false);
  });

  it('cannot make up numbers: no digits in labels, no value on a metric', () => {
    expect(rejected(withLabel('Ten times faster'))).toBe(false);
    for (const text of ['10x faster', '-85%', '1,024 bytes', '٣ reads', 'Step ²', '１０ times'])
      expect(rejected(withLabel(text)), text).toBe(true);
    expect(
      rejected({
        shots: [
          {
            scene: 's1',
            elements: [{ id: 'm', kind: 'metric', evidence: 'metric:terminal-1:bytes', value: 42 }],
          },
        ],
      }),
    ).toBe(true);
    // The metric case is refused by its kind alone; a value is refused on a drawn kind too.
    expect(
      rejected({
        shots: [{ scene: 's1', elements: [{ id: 'n', kind: 'node', label: 'Reads', value: 42 }] }],
      }),
    ).toBe(true);
  });

  it('cannot pollute prototypes through ids or keys', () => {
    // As JSON.parse reads it: `__proto__` is an own key there, not the prototype.
    const parse = (text: string) => DirectionSchema.safeParse(JSON.parse(text));
    const named = parse(
      '{"shots":[{"scene":"constructor","elements":[{"id":"constructor","kind":"visual"}],' +
        '"beats":[{"verb":"reveal","element":"constructor"}]}]}',
    );
    expect(named.success).toBe(true);
    const shot = named.data!.shots[0]!;
    expect(shot.scene).toBe('constructor');
    expect(shot.elements[0]).toEqual({ id: 'constructor', kind: 'visual' });
    expect(Object.getPrototypeOf(shot)).toBe(Object.prototype);
    for (const id of ['__proto__', 'prototype-', '__defineGetter__']) {
      const text = `{"shots":[{"scene":"s1","elements":[{"id":${JSON.stringify(id)},"kind":"visual"}]}]}`;
      expect(parse(text).success, id).toBe(id === 'prototype-');
    }
    for (const text of [
      '{"shots":[],"__proto__":{"polluted":true}}',
      '{"shots":[{"scene":"s1","elements":[{"id":"v","kind":"visual"}],"__proto__":{"polluted":true}}]}',
      '{"shots":[{"scene":"s1","elements":[{"id":"v","kind":"visual","__proto__":{"polluted":true}}]}]}',
      '{"shots":[],"constructor":{"prototype":{"polluted":true}}}',
    ])
      expect(parse(text).success, text).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('cannot hand the renderer styles, markup, or addresses through any key', () => {
    for (const extra of [{ css: 'x' }, { html: '<b>' }, { url: 'https://x' }, { selector: '#a' }])
      expect(
        rejected({ shots: [{ scene: 's1', elements: [{ id: 'v', kind: 'visual', ...extra }] }] }),
      ).toBe(true);
  });
});

describe('a direction citing evidence the run does not have', () => {
  it('is refused, element by element, before anything renders', () => {
    const evidence = indexEvidence({ items: [] });
    const direction = DirectionSchema.parse({
      shots: [
        {
          scene: 's1',
          elements: [
            { id: 'a', kind: 'code', evidence: 'diff-hunk:../../etc/passwd:1' },
            { id: 'b', kind: 'capture', evidence: 'screenshot:../../secret' },
            { id: 'c', kind: 'output', evidence: 'terminal:999' },
            { id: 'd', kind: 'node', label: 'Made up', evidence: ['metric:x:y'] },
          ],
        },
      ],
    });
    const found = directionProblems(
      direction,
      [{ id: 's1', narration: 'One line.' }],
      evidence,
      directionSources({ evidence }),
    );
    expect(found).toHaveLength(4);
    for (const line of found) expect(line).toMatch(/which the run's evidence does not have/);
  });

  it('cannot reach the terminal through the ids and phrases its problems echo', () => {
    const evidence = indexEvidence({ items: [] });
    // An ANSI clear-screen and a right-to-left override, then an id at the schema's length limit.
    const hostile = `diff-hunk:\u001b[2J\u202e${'x'.repeat(380)}`;
    const direction = DirectionSchema.parse({
      shots: [
        { scene: 'constructor', elements: [{ id: 'v', kind: 'visual' }] },
        {
          scene: 's1',
          elements: [
            { id: 'a', kind: 'code', evidence: hostile },
            { id: 'b', kind: 'node', label: 'Reader', evidence: ['\u001b]8;;https://evil\u0007'] },
          ],
          beats: [{ verb: 'reveal', element: 'a', at: 'One \u001b[31mline\u2028.' }],
        },
      ],
    });
    const found = directionProblems(
      direction,
      [{ id: 's1', narration: 'One line.' }],
      evidence,
      directionSources({ evidence }),
    );
    // Looked up by value: the "constructor" every object has is no scene.
    expect(found[0]).toBe(
      'shot 1 (scene constructor): the storyboard has no scene "constructor" (it has: s1)',
    );
    expect(found).toHaveLength(4);
    for (const line of found) {
      expect(line).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(line.length).toBeLessThan(300);
    }
    expect(found[1]).toContain('"diff-hunk:\\u001b[2J\\u202exxx');
    expect(found[1]).toContain('x…"');
    expect(found[2]).toContain('"\\u001b]8;;https://evil\\u0007"');
    expect(found[3]).toContain('quotes "One \\u001b[31mline\\u2028."');
  });
});

describe.skipIf(!(await canUseBrowser()))('text from a direction, on the page', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('is drawn as text: no element, no script, exactly the characters it holds', async () => {
    // One label passes validation with characters markup would read (& ’ ( ) /). The others are
    // put straight into a timeline, as if they had slipped past the schema, and a code line from
    // the diff carries markup too.
    const passing = LabelSchema.parse('Tom & Jerry (it’s &amp / fine)');
    const smuggled = '<img src=x onerror="window.__pwned=1">';
    const script = '</script><script>window.__pwned=2</script>';
    const line = '<b onmouseover="window.__pwned=3">bold</b>';
    const dir = mkdtempSync(join(tmpdir(), 'covi-direction-security-'));
    dirs.push(dir);
    const spec = resolveVideoSpec(resolveConfig([]).config, {
      mode: 'custom',
      width: 640,
      height: 360,
    });
    const scenes = StoryboardSchema.parse({
      title: 'Security',
      template: 'bug-fix',
      scenes: [
        { id: 's1', beat: 'a', narration: 'One line.', visual: { kind: 'callout', title: 'A' } },
        {
          id: 's2',
          beat: 'b',
          narration: 'Another line here.',
          visual: { kind: 'callout', title: 'B' },
        },
      ],
    }).scenes;
    const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
    const slot = (x: number) => ({ x, y: 80, width: 140, height: 120 });
    const staging: SceneStaging[] = [
      {
        stop: { x: 0, y: 0 },
        direction: {
          whole: true,
          elements: [{ id: 'visual', kind: 'visual', rect: slot(40) }],
          beats: [],
        },
      },
      {
        stop: { x: 800, y: 0 },
        direction: {
          whole: false,
          elements: [
            { id: 'a', kind: 'label', rect: slot(20), text: passing, tone: 'neutral' },
            { id: 'b', kind: 'node', rect: slot(170), label: smuggled },
            { id: 'c', kind: 'label', rect: slot(320), text: script, tone: 'warning' },
            {
              id: 'd',
              kind: 'code',
              rect: slot(470),
              visual: {
                kind: 'code',
                path: 'x.js',
                lines: [{ type: 'add', text: line }],
                highlight: [],
              },
            },
          ],
          beats: [],
        },
      },
    ];
    const timeline = buildTimeline({
      title: 'Security',
      scenes,
      layout,
      spec,
      image: () => ({ src: '', width: 1, height: 1 }),
      staging,
    });
    const composition = join(dir, 'composition');
    await writeComposition(composition, timeline, new Map());
    // The timeline is inlined as JSON with every `<` escaped: it cannot close its script element.
    const html = readFileSync(join(composition, 'index.html'), 'utf8');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</script><script>window');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`file://${join(composition, 'index.html')}`);
      await page.waitForFunction('window.covi !== undefined');
      await page.evaluate('window.covi.ready');
      const s2 = timeline.scenes.find((s) => s.id === 's2')!;
      const seen = (await page.evaluate(
        `(() => {
           window.covi.seek(${Math.round((s2.start + 1) * timeline.fps)});
           const labels = [...document.querySelectorAll('[data-element] .nlabel')];
           return {
             pwned: window.__pwned ?? null,
             scripts: document.querySelectorAll('script').length,
             injected: document.querySelectorAll('[data-element] img, [data-element] script, [data-element] b').length,
             texts: labels.map((n) => n.textContent),
             children: labels.map((n) => n.children.length),
             code: document.querySelector('[data-element="d"] .ln .txt').textContent,
           };
         })()`,
      )) as {
        pwned: unknown;
        scripts: number;
        injected: number;
        texts: string[];
        children: number[];
        code: string;
      };
      expect(seen).toEqual({
        pwned: null,
        scripts: 2,
        injected: 0,
        texts: [passing, smuggled, script],
        children: [0, 0, 0],
        code: line,
      });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
