import { describe, expect, it } from 'vitest';
import {
  describeMetric,
  metricSlug,
  metricValue,
  pairMetrics,
  readJsonMetrics,
  readMetrics,
} from '../src/evidence/metrics.ts';
import { METRIC_LIMITS } from '../src/model/evidence.ts';

const values = (text: string) => readMetrics(text).map((m) => [m.name, m.value, m.unit]);

describe('reading metrics from output', () => {
  it('reads lines that are a name and a number, with a unit', () => {
    expect(readMetrics('request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1')).toEqual([
      { name: 'request-bytes', label: 'request bytes', value: 70406 },
      { name: 'chunks', label: 'chunks', value: 4 },
      { name: 'reader-steps', label: 'reader steps', value: 28 },
      { name: 'timeouts', label: 'timeouts', value: 1 },
    ]);
    expect(
      values('Duration = 1.25 s\n- Memory: 12.5 MB\n* coverage: 87.5%\nLatency (p95): 120ms'),
    ).toEqual([
      ['duration', 1.25, 's'],
      ['memory', 12.5, 'MB'],
      ['coverage', 87.5, '%'],
      ['latency-p95', 120, 'ms'],
    ]);
  });

  it('reads thousands separators, signs, and rounds to six decimals', () => {
    expect(
      values(
        'a: 70,406\nb: 1_000_000\nc: 12 345\nd: -12\ne: −3.5\nf: +7\ng: 0.1234567\nh: -0.0000001',
      ),
    ).toEqual([
      ['a', 70406, undefined],
      ['b', 1000000, undefined],
      ['c', 12345, undefined],
      ['d', -12, undefined],
      ['e', -3.5, undefined],
      ['f', 7, undefined],
      ['g', 0.123457, undefined],
      ['h', 0, undefined],
    ]);
    // One kind of separator throughout.
    expect(values('x: 1,000_000')).toEqual([]);
    expect(metricValue('70,406')).toBe(70406);
  });

  it('takes only a whole printed number as a value', () => {
    expect(metricValue('−3.5')).toBe(-3.5);
    for (const text of ['', ' ', ' 12', '1,5', '1,000_000', '0x10', '0b11', '1e3', '12.', '.5'])
      expect(metricValue(text), text).toBeUndefined();
  });

  it('reads key=value pairs inside a line', () => {
    expect(values('GET /api 200 status=200 duration=12ms bytes=1,024 (cache=0%)')).toEqual([
      ['status', 200, undefined],
      ['duration', 12, 'ms'],
      ['bytes', 1024, undefined],
      ['cache', 0, '%'],
    ]);
    // A query string is not a list of measurements.
    expect(values('fetched /api/users?page=2&limit=10')).toEqual([]);
    expect(values('a=1,234,b=5')).toEqual([
      ['a', 1234, undefined],
      ['b', 5, undefined],
    ]);
  });

  it('stays silent on numbers that are not measurements', () => {
    for (const text of [
      'node v22.18.0',
      'version: 2.4.0',
      'started at 12:30:45',
      'time: 12:30',
      'date: 2026-10-09',
      'Listening on http://localhost:3000',
      'Progress: [3/10]',
      'ok 1 - builds the request',
      '# pass 5',
      'Done in 1.2s',
      'speed: 12 req/s',
      'x: 1,5',
      'x: 1.234,56',
      'big: 1234567890123456',
      'tiny: 1e-7',
      'timeouts: 1 (retried)',
      // An address or a place in a file: a colon that names a number has a space after it.
      'Server listening on localhost:3000',
      'Listening at 0.0.0.0:8080',
      'Connected to redis at 127.0.0.1:6379',
      'src/app.ts:42',
      'README.md:3',
      // A decimal comma or a list is not a grouped number.
      'size=1,5',
      'x=1.234,56',
      'ids=1,2,3',
      'coords=12,34',
      // Identifiers differ between runs without measuring anything.
      'pid=4242',
      'PID: 4242',
      'port: 3000',
      'request id: 99',
      'requestId=99',
      // A number next to a credential is the credential, never a measurement.
      'password: 12345678',
      'api key: 123456',
      'otp=482913',
      'apiKey=123456',
      'PIN: 1234',
      'SSN: 123456789',
      'secret count: 3',
      'Your passcode = 9911',
      // Longer than a line Covi reads.
      'a=1 '.repeat(Math.ceil(METRIC_LIMITS.lineChars / 4) + 1),
    ])
      expect(values(text), text).toEqual([]);
  });

  it('reads a measurement whose name only starts with an identifier word', () => {
    expect(values('build time: 12.3 s\nline coverage: 87.5%')).toEqual([
      ['build-time', 12.3, 's'],
      ['line-coverage', 87.5, '%'],
    ]);
  });

  it('stays silent on credentials however they are spelled, in lines and JSON keys', () => {
    for (const name of [
      'passphrase',
      'cvv',
      'credential',
      'credentials',
      // Run-together and short spellings.
      'apikey',
      'authtoken',
      'accesstoken',
      'secretkey',
      'csrftoken',
      'sessionid',
      'passwd',
      'pwd',
      'pw',
      'cvc',
      'totp',
      // Phrases, by their words in order.
      'verification code',
      'auth code',
      'one-time code',
      // Words the ASCII word split drops, and compounds.
      '비밀번호',
      '새 암호',
      'パスワード',
      '密码',
      '口令',
      'Passwort',
      'Kennwort',
      'Benutzerpasswort',
      'ｐａｓｓｗｏｒｄ',
    ]) {
      expect(values(`${name}: 48291357`), name).toEqual([]);
      expect(values(`${name.replace(/ /g, '_')}=48291357`), name).toEqual([]);
      expect(readJsonMetrics(JSON.stringify({ [name]: 48291357 })), name).toEqual([]);
    }
    expect(
      readJsonMetrics(
        JSON.stringify({
          passwd: 12345678,
          user: { pwd: 1234 },
          apikey: 42,
          verificationCode: 482913,
          auth: { code: 7 },
          비밀번호: 1234,
          total: 3,
        }),
      ).map((m) => m.name),
    ).toEqual(['total']);
    // Words that only contain a credential's letters, or a code that is no credential, still read.
    expect(values('cache keys: 12\npower: 3 W\nexit code: 1\ncompassion: 2')).toEqual([
      ['cache-keys', 12, undefined],
      ['power', 3, 'W'],
      ['exit-code', 1, undefined],
      ['compassion', 2, undefined],
    ]);
  });

  it('reads keys counted, and a name where key is not the last word', () => {
    expect(values('cache keys: 12\nkey count: 3')).toEqual([
      ['cache-keys', 12, undefined],
      ['key-count', 3, undefined],
    ]);
    // The same words in a JSON body: a field named after a credential is not read.
    expect(
      readJsonMetrics('{"auth":{"token":123456,"apiKey":42},"cacheKeys":12}').map((m) => m.name),
    ).toEqual(['cache-keys']);
  });

  it('strips terminal colors before reading', () => {
    expect(values('\u001b[32mchunks:\u001b[0m \u001b[1m4\u001b[22m')).toEqual([
      ['chunks', 4, undefined],
    ]);
  });

  it('reads numeric fields of a JSON object, by path, four levels deep, never inside arrays', () => {
    const json = JSON.stringify({
      total: 120,
      request: { bytes: 9907, chunks: 1, ok: true, name: 'x' },
      items: [{ id: 1 }, { id: 2 }],
      a: { b: { c: { d: 4, e: { f: 5 } } } },
    });
    expect(readMetrics(json)).toEqual([
      { name: 'total', label: 'total', value: 120 },
      { name: 'request-bytes', label: 'request.bytes', value: 9907 },
      { name: 'request-chunks', label: 'request.chunks', value: 1 },
      { name: 'a-b-c-d', label: 'a.b.c.d', value: 4 },
    ]);
    expect(readJsonMetrics(json)).toEqual(readMetrics(json));
    // A response body that is not a JSON object gives nothing, whatever its lines say.
    expect(readJsonMetrics('total: 12')).toEqual([]);
    expect(readJsonMetrics('[{"total": 12}]')).toEqual([]);
    expect(readJsonMetrics('{"total": 12,')).toEqual([]);
    expect(
      readJsonMetrics(JSON.stringify({ total: 12, pad: 'x'.repeat(METRIC_LIMITS.textChars) })),
    ).toEqual([]);
  });

  it('names a JSON key by its words, and drops ids and keys that hide text', () => {
    const json = {
      requestBytes: 9907,
      userId: 7,
      id: 1,
      order: { orderID: 3 },
      total: 3,
      tiny: 1e-7,
    };
    expect(readJsonMetrics(JSON.stringify(json))).toEqual([
      { name: 'request-bytes', label: 'requestBytes', value: 9907 },
      { name: 'total', label: 'total', value: 3 },
      { name: 'tiny', label: 'tiny', value: 0 },
    ]);
    // People and models read a key: one that moves the cursor or turns text around is skipped.
    const hidden = {
      '\u001b[2J\u001b]0;pwned\u0007x': 5,
      '\u202etotal': 6,
      'a\u200b': { b: 1 },
      ok: 2,
    };
    expect(readJsonMetrics(JSON.stringify(hidden))).toEqual([
      { name: 'ok', label: 'ok', value: 2 },
    ]);
  });

  it('names a second reading of the same name -2, and a label in another script value', () => {
    expect(values('bytes: 1\nbytes: 2\n요청 바이트: 3\n처리 시간: 4')).toEqual([
      ['bytes', 1, undefined],
      ['bytes-2', 2, undefined],
      ['value', 3, undefined],
      ['value-2', 4, undefined],
    ]);
    expect(readMetrics('요청 바이트: 3')[0]!.label).toBe('요청 바이트');
    expect(metricSlug('Café Grösse (ms)')).toBe('cafe-grosse-ms');
    expect(metricSlug('x'.repeat(50))).toHaveLength(METRIC_LIMITS.nameChars);
  });

  it('cuts a long label between characters, never inside one', () => {
    // Sixty letters, the last outside the basic plane: a cut at 60 code units would halve it.
    const name = `${'a'.repeat(59)}𝒜`;
    expect(readMetrics(`${name}: 1`)[0]!.label).toBe('a'.repeat(59));
    expect(readJsonMetrics(JSON.stringify({ [name]: 1 }))[0]!.label).toBe('a'.repeat(59));
  });

  it('reads at most 50 metrics from one text', () => {
    const many = Array.from({ length: 200 }, (_, i) => `m${i}: ${i}`).join('\n');
    const read = readMetrics(many);
    expect(read).toHaveLength(METRIC_LIMITS.perSource);
    expect(read.at(-1)!.name).toBe('m49');
  });

  it('reads lines up to the longest, and never a line the text limit cuts in half', () => {
    const longest = `${'x'.repeat(METRIC_LIMITS.lineChars - 4)} a=1`;
    expect(longest).toHaveLength(METRIC_LIMITS.lineChars);
    expect(values(longest)).toEqual([['a', 1, undefined]]);
    expect(values(`x${longest}`)).toEqual([]);
    // The limit falls inside 70406: reading "70" would be wrong.
    const cut = `a: 1\n${' '.repeat(METRIC_LIMITS.textChars - 11)}\nb: 70406`;
    expect(cut.indexOf('b: 70406') + 'b: 70'.length).toBe(METRIC_LIMITS.textChars);
    expect(values(cut)).toEqual([['a', 1, undefined]]);
  });
});

describe('pairing base and head', () => {
  it('pairs readings by name, keeping head’s order, then what only base printed', () => {
    const base = readMetrics('request bytes: 70406\nchunks: 4\nretries: 2');
    const head = readMetrics('chunks: 1\nrequest bytes: 9907\ncache hits: 12');
    expect(pairMetrics(base, head)).toEqual([
      { name: 'chunks', label: 'chunks', base: 4, head: 1 },
      { name: 'request-bytes', label: 'request bytes', base: 70406, head: 9907 },
      { name: 'cache-hits', label: 'cache hits', head: 12 },
      { name: 'retries', label: 'retries', base: 2 },
    ]);
  });

  it('never pairs values in different units', () => {
    expect(pairMetrics(readMetrics('time: 1.2 s'), readMetrics('time: 800 ms'))).toEqual([
      { name: 'time', label: 'time', unit: 'ms', head: 800 },
    ]);
  });

  it('pairs at most 50 metrics', () => {
    const head = readMetrics(Array.from({ length: 50 }, (_, i) => `h${i}: ${i}`).join('\n'));
    expect(pairMetrics(readMetrics('base only: 1'), head)).toHaveLength(METRIC_LIMITS.perSource);
  });

  it('describes a metric as people read it', () => {
    expect(
      describeMetric({
        label: 'request bytes',
        metric: { name: 'request-bytes', base: 70406, head: 9907 },
      }),
    ).toBe('request bytes: 70406 → 9907');
    expect(
      describeMetric({ label: 'coverage', metric: { name: 'coverage', unit: '%', head: 87 } }),
    ).toBe('coverage: 87 %');
    expect(describeMetric({ label: 'node cli.js --help' })).toBe('node cli.js --help');
  });

  it('describes any label printably: what a terminal acts on is spelled as an escape', () => {
    expect(describeMetric({ label: 'node \u001b[2Jcli.js\n--help \u202e' })).toBe(
      'node \\u001b[2Jcli.js\\u000a--help \\u202e',
    );
  });
});
