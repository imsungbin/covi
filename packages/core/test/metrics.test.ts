import { describe, expect, it } from 'vitest';
import {
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

  it('reads key=value pairs inside a line', () => {
    expect(values('GET /api 200 status=200 duration=12ms bytes=1,024 (cache=0%)')).toEqual([
      ['status', 200, undefined],
      ['duration', 12, 'ms'],
      ['bytes', 1024, undefined],
      ['cache', 0, '%'],
    ]);
    // A query string is not a list of measurements.
    expect(values('fetched /api/users?page=2&limit=10')).toEqual([]);
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
      // Longer than a line Covi reads.
      'a=1 '.repeat(Math.ceil(METRIC_LIMITS.lineChars / 4) + 1),
    ])
      expect(values(text), text).toEqual([]);
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

  it('reads at most 50 metrics from one text', () => {
    const many = Array.from({ length: 200 }, (_, i) => `m${i}: ${i}`).join('\n');
    const read = readMetrics(many);
    expect(read).toHaveLength(METRIC_LIMITS.perSource);
    expect(read.at(-1)!.name).toBe('m49');
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
});
