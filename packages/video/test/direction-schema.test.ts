import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DIRECTION_LIMITS,
  type DirectionInput,
  DirectionSchema,
  LabelSchema,
  readDirectionFile,
} from '../src/direction/schema.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const shot = (extra: Record<string, unknown> = {}) => ({
  scene: 's3',
  elements: [{ id: 'visual', kind: 'visual' }],
  ...extra,
});
const valid: DirectionInput = {
  schemaVersion: 1,
  shots: [
    {
      scene: 's3',
      enter: 'pan',
      layout: 'row',
      elements: [
        { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:12', side: 'head' },
        { id: 'out', kind: 'output', evidence: 'terminal:1', side: 'base' },
        { id: 'page', kind: 'capture', evidence: 'screenshot:home-after' },
        { id: 'reader', kind: 'node', label: 'Reader worker', evidence: ['diff-hunk:src/r.js:3'] },
        { id: 'warn', kind: 'label', text: 'Timed out', tone: 'warning' },
      ],
      beats: [
        { verb: 'place', element: 'req' },
        { verb: 'reveal', element: 'warn', style: 'pop', at: 'only ten kilobytes' },
        { verb: 'camera', move: 'zoom', to: 'req', zoom: 1.6, at: 'ten kilobytes' },
      ],
    },
  ],
};
const issues = (value: unknown) => {
  const parsed = DirectionSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
};

describe('the direction schema', () => {
  it('accepts every B2 element and verb, and fills its defaults', () => {
    const parsed = DirectionSchema.parse(valid);
    expect(parsed.draft).toBe(false);
    expect(DirectionSchema.parse({ shots: [shot()] })).toEqual({
      schemaVersion: 1,
      draft: false,
      shots: [{ scene: 's3', elements: [{ id: 'visual', kind: 'visual' }], beats: [] }],
    });
  });

  it('rejects unknown keys everywhere: no CSS, HTML, URLs, or code for the renderer', () => {
    expect(issues({ ...valid, style: 'x' })).not.toEqual([]);
    expect(issues({ shots: [shot({ css: 'color: red' })] })).not.toEqual([]);
    for (const key of ['html', 'src', 'href', 'style', 'onClick', 'script', 'value'])
      expect(
        issues({
          shots: [shot({ elements: [{ id: 'a', kind: 'label', text: 'Hi', [key]: 'x' }] })],
        }),
        key,
      ).not.toEqual([]);
    expect(
      issues({
        shots: [shot({ beats: [{ verb: 'camera', move: 'zoom', to: 'visual', easing: 'x' }] })],
      }),
    ).not.toEqual([]);
  });

  it('rejects kinds and verbs this PR does not draw', () => {
    for (const kind of ['metric', 'morph', 'packet', 'pile', 'html', 'iframe'])
      expect(issues({ shots: [shot({ elements: [{ id: 'a', kind }] })] }), kind).not.toEqual([]);
    for (const verb of ['morph', 'count', 'flow', 'eval'])
      expect(issues({ shots: [shot({ beats: [{ verb, element: 'visual' }] })] }), verb).not.toEqual(
        [],
      );
    // `place` means "from the shot's start": a phrase would mean nothing on it.
    expect(
      issues({ shots: [shot({ beats: [{ verb: 'place', element: 'visual', at: 'x' }] })] }),
    ).not.toEqual([]);
  });

  it('bounds every list at its limit', () => {
    const shots = (n: number) => Array.from({ length: n }, (_, i) => shot({ scene: `s${i + 1}` }));
    expect(issues({ shots: shots(DIRECTION_LIMITS.shots) })).toEqual([]);
    expect(issues({ shots: shots(DIRECTION_LIMITS.shots + 1) })).not.toEqual([]);
    const labels = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `l${i}`, kind: 'label', text: 'Hi' }));
    expect(
      issues({ shots: [shot({ elements: labels(DIRECTION_LIMITS.elementsPerShot) })] }),
    ).toEqual([]);
    expect(
      issues({ shots: [shot({ elements: labels(DIRECTION_LIMITS.elementsPerShot + 1) })] }),
    ).not.toEqual([]);
    expect(issues({ shots: [shot({ elements: [] })] })).not.toEqual([]);
    const beats = (n: number) =>
      Array.from({ length: n }, () => ({ verb: 'reveal', element: 'visual' }));
    expect(issues({ shots: [shot({ beats: beats(DIRECTION_LIMITS.beatsPerShot) })] })).toEqual([]);
    expect(
      issues({ shots: [shot({ beats: beats(DIRECTION_LIMITS.beatsPerShot + 1) })] }),
    ).not.toEqual([]);
    const node = (n: number) => ({
      id: 'n',
      kind: 'node',
      label: 'Reader',
      evidence: Array.from({ length: n }, (_, i) => `diff-hunk:a.js:${i + 1}`),
    });
    expect(issues({ shots: [shot({ elements: [node(4)] })] })).toEqual([]);
    expect(issues({ shots: [shot({ elements: [node(5)] })] })).not.toEqual([]);
  });

  it('bounds ids, phrases, zoom, and line ranges', () => {
    for (const id of ['a', 'req-1', 'a'.repeat(DIRECTION_LIMITS.idChars)])
      expect(issues({ shots: [shot({ elements: [{ id, kind: 'visual' }] })] }), id).toEqual([]);
    for (const id of ['', '1a', 'A', 'a_b', 'a'.repeat(DIRECTION_LIMITS.idChars + 1), '<b>'])
      expect(issues({ shots: [shot({ elements: [{ id, kind: 'visual' }] })] }), id).not.toEqual([]);
    const at = (phrase: string) =>
      issues({ shots: [shot({ beats: [{ verb: 'reveal', element: 'visual', at: phrase }] })] });
    expect(at('x'.repeat(DIRECTION_LIMITS.phraseChars))).toEqual([]);
    expect(at('x'.repeat(DIRECTION_LIMITS.phraseChars + 1))).not.toEqual([]);
    expect(at('   ')).not.toEqual([]);
    const zoom = (z: number) =>
      issues({
        shots: [shot({ beats: [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: z }] })],
      });
    expect(zoom(1)).toEqual([]);
    expect(zoom(2.5)).toEqual([]);
    expect(zoom(0.99)).not.toEqual([]);
    expect(zoom(2.51)).not.toEqual([]);
    const lines = (l: unknown) =>
      issues({
        shots: [
          shot({ elements: [{ id: 'c', kind: 'code', evidence: 'diff-hunk:a.js:1', lines: l }] }),
        ],
      });
    expect(lines([1, 40])).toEqual([]);
    expect(lines([1, 41])).not.toEqual([]);
    expect(lines([5, 4])).not.toEqual([]);
    expect(lines([0, 3])).not.toEqual([]);
    expect(lines([1.5, 3])).not.toEqual([]);
    expect(lines([1])).not.toEqual([]);
    expect(issues({ shots: [shot({ scene: 'S3' })] })).not.toEqual([]);
    expect(issues({ shots: [shot({ scene: 'a'.repeat(65) })] })).not.toEqual([]);
  });
});

describe('labels', () => {
  const ok = (text: string) => LabelSchema.safeParse(text).success;

  it('take letters of any script, spaces, and a little punctuation, trimmed', () => {
    for (const text of [
      'Slow path',
      'Tom & Jerry (it’s fine)',
      'e—mail · ok?',
      'Before: slow',
      'Stale data: refetch',
      'Bad data : retry',
      'metadata:',
      'café / naïve',
      '요청이 너무 큼',
      'タイムアウト',
      '超时',
      'a'.repeat(32),
    ])
      expect(ok(text), text).toBe(true);
    expect(LabelSchema.parse('  Slow path  ')).toBe('Slow path');
  });

  it('take the punctuation Korean, Japanese, and Chinese labels are written with', () => {
    for (const text of [
      '「요청」이 큼！',
      '完了。',
      'タイム・アウト',
      '読み込み、遅い',
      '『終了』（済）',
      '本当？はい：遅い',
      '为什么？',
    ])
      expect(ok(text), text).toBe(true);
  });

  it('refuse digits, markup, links, schemes, and control characters', () => {
    for (const text of [
      '',
      '   ',
      'a'.repeat(33),
      '10x faster',
      'v1',
      '٣ items',
      'x²',
      '<script>alert(1)</script>',
      'javascript:alert(document)',
      'javascript: alert(document)',
      'JavaScript : void',
      'vbscript:msgbox',
      'data:text/html',
      'data:text/html,x',
      'x onerror=alert',
      'see https://evil.example',
      'ftp://host',
      'www.evil.example',
      'see www.evil.example',
      '{{template}}',
      '"quoted"',
      'a;b',
      'a_b',
      'tab\there',
      'new\nline',
      'nul\u0000',
    ])
      expect(ok(text), JSON.stringify(text)).toBe(false);
  });

  it('refuse full-width spellings of links, schemes, and digits', () => {
    for (const text of [
      'ｗｗｗ.evil.example',
      'ｈｔｔｐｓ：//x',
      'ｊａｖａｓｃｒｉｐｔ：x',
      'ｄａｔａ：text/html',
      '１０ times',
    ])
      expect(ok(text), text).toBe(false);
  });

  it('refuse invisible characters, which could split a link or draw nothing', () => {
    for (const text of [
      'https:\u034f//evil.example',
      'https:\ufe0f//evil.example',
      'w\u034fww.evil.example',
      'www\u180b.evil.example',
      'a\u{e0100}b',
      '\u3164\u3164\u3164',
      '\u115f\u1160',
      'a\uffa0b',
      'a\u17b4b',
      'a\u200bb',
      'a\ufeffb',
      'abc\u202edef',
      '\u2066www.evil.example\u2069',
    ])
      expect(ok(text), JSON.stringify(text)).toBe(false);
  });

  it('refuse links spelled with ideographic full stops', () => {
    for (const text of ['www。evil。example', 'www｡evil｡example', 'www．evil．example'])
      expect(ok(text), text).toBe(false);
    expect(ok('完了。次へ')).toBe(true);
  });
});

describe('reading video/direction.json', () => {
  const place = () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-direction-'));
    dirs.push(dir);
    return join(dir, 'direction.json');
  };
  const file = (content: string) => {
    const path = place();
    writeFileSync(path, content);
    return path;
  };

  it('reads nothing when the run has no direction', async () => {
    expect(
      await readDirectionFile(join(tmpdir(), 'covi-missing', 'direction.json')),
    ).toBeUndefined();
  });

  it('parses a valid file', async () => {
    expect(await readDirectionFile(file(JSON.stringify(valid)))).toMatchObject({
      schemaVersion: 1,
      shots: [{ scene: 's3', enter: 'pan' }],
    });
  });

  it('refuses a file over the size limit before parsing it, and invalid JSON', async () => {
    const big = file(`{"shots":[],"pad":"${'x'.repeat(DIRECTION_LIMITS.fileBytes)}"}`);
    await expect(readDirectionFile(big)).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/at most 262144 bytes/),
    });
    await expect(readDirectionFile(file('{ nope'))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/not valid JSON/),
    });
  });

  it('reads a file of exactly the size limit, and refuses one byte more', async () => {
    const text = JSON.stringify({ shots: [shot()] });
    const exact = file(text.padEnd(DIRECTION_LIMITS.fileBytes, ' '));
    expect(await readDirectionFile(exact)).toMatchObject({ shots: [{ scene: 's3' }] });
    const over = file(text.padEnd(DIRECTION_LIMITS.fileBytes + 1, ' '));
    await expect(readDirectionFile(over)).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/is 262145 bytes; a direction may be at most 262144 bytes/),
    });
  });

  it('refuses what is not a regular file instead of reading it without end', async () => {
    const notFile = { exitCode: 2, message: expect.stringMatching(/is not a regular file/) };
    const dir = place();
    mkdirSync(dir);
    await expect(readDirectionFile(dir)).rejects.toMatchObject(notFile);
    if (process.platform === 'win32') return;
    // A device and a FIFO both report size 0: one reads forever, the other blocks on open.
    const zero = place();
    symlinkSync('/dev/zero', zero);
    await expect(readDirectionFile(zero)).rejects.toMatchObject(notFile);
    const fifo = place();
    execFileSync('mkfifo', [fifo]);
    await expect(readDirectionFile(fifo)).rejects.toMatchObject(notFile);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'says a file it may not read cannot be read, not that it is invalid JSON',
    async () => {
      const locked = file(JSON.stringify(valid));
      chmodSync(locked, 0o000);
      await expect(readDirectionFile(locked)).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringMatching(/video\/direction\.json cannot be read: .*EACCES/),
      });
    },
  );

  it('never echoes the file raw: escapes and cuts what errors quote', async () => {
    const ansi = '\u001b]0;pwned\u0007\u001b[2J';
    const keyed = file(JSON.stringify({ shots: [], [`${ansi}${'k'.repeat(100_000)}`]: 1 }));
    const keyError = (await readDirectionFile(keyed).catch((e: Error) => e)) as Error;
    expect(keyError.message).toMatch(/unknown key\(s\): \\u001b\]0;pwned/);
    // Its lines are joined with newlines; nothing else of the C0 or C1 controls remains.
    expect(keyError.message).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(keyError.message.length).toBeLessThan(300);
    // V8 quotes the start of input it cannot parse.
    const garbled = file(`${ansi} not json`);
    const jsonError = (await readDirectionFile(garbled).catch((e: Error) => e)) as Error;
    expect(jsonError.message).toMatch(/not valid JSON/);
    expect(jsonError.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it('lists every schema problem at once', async () => {
    const broken = {
      shots: [
        shot({ scene: 'S1' }),
        shot({ elements: [{ id: 'x', kind: 'label', text: '10 times' }] }),
        shot({ beats: [{ verb: 'camera', move: 'spin', to: 'visual' }] }),
      ],
    };
    const error = await readDirectionFile(file(JSON.stringify(broken))).catch((e: Error) => e);
    expect(error).toMatchObject({ exitCode: 2 });
    const message = (error as Error).message;
    expect(message).toMatch(/video\/direction\.json is invalid/);
    expect(message).toMatch(/shots\.0\.scene/);
    expect(message).toMatch(/shots\.1\.elements\.0\.text/);
    expect(message).toMatch(/shots\.2\.beats\.0\.move/);
  });
});
