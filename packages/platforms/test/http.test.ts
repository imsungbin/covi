import { describe, expect, it } from 'vitest';
import {
  ApiClient,
  BudgetExhaustedError,
  PlatformHttpError,
  RateLimitedError,
  RequestBudget,
} from '../src/http.ts';
import { fixtureFetch } from './fixtures.ts';

const client = (
  fetch: ReturnType<typeof fixtureFetch>['fetch'],
  options: {
    max?: number;
    base?: string;
    maxBytes?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) =>
  new ApiClient({
    platform: 'GitHub',
    base: options.base ?? 'https://api.github.com',
    headers: { authorization: 'Bearer t' },
    fetch,
    budget: new RequestBudget(options.max ?? 20),
    maxBytes: options.maxBytes,
    sleep: options.sleep,
  });

describe('ApiClient', () => {
  it('follows Link pages on the API origin only, never sending the token elsewhere', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/repos/acme/shop/issues/7/comments?per_page=100': {
        json: [{ id: 1 }],
        headers: {
          link: '<https://api.github.com/repositories/9/issues/7/comments?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/9/issues/7/comments?per_page=100&page=3>; rel="last"',
        },
      },
      'GET https://api.github.com/repositories/9/issues/7/comments?per_page=100&page=2': {
        json: [{ id: 2 }],
        headers: { link: '<https://evil.example/steal?page=3>; rel="next"' },
      },
    });
    expect(
      await client(api.fetch).getAll('/repos/acme/shop/issues/7/comments?per_page=100'),
    ).toEqual([{ id: 1 }, { id: 2 }]);
    expect(api.calls.map((c) => new URL(c.url).origin)).toEqual([
      'https://api.github.com',
      'https://api.github.com',
    ]);
    expect(api.calls.every((c) => c.headers.authorization === 'Bearer t')).toBe(true);
    expect(() => client(api.fetch).url('https://evil.example/x')).toThrow(
      /Refusing to send a token/,
    );
    expect(() => client(api.fetch).url('http://api.github.com/x')).toThrow(
      /Refusing to send a token/,
    );

    // An Enterprise base keeps its path: a next page outside /api/v3 is not followed either.
    const ghes = fixtureFetch({
      'GET https://ghe.example/api/v3/repos/a/b/pulls': {
        json: [1],
        headers: { link: '<https://ghe.example/other/pulls?page=2>; rel="next"' },
      },
    });
    const enterprise = client(ghes.fetch, { base: 'https://ghe.example/api/v3' });
    expect(await enterprise.getAll('/repos/a/b/pulls')).toEqual([1]);
    expect(ghes.calls).toHaveLength(1);
    expect(() => enterprise.url('/../other/x')).toThrow(/Refusing to send a token/);
  });

  it('waits out a short secondary rate limit once, and stops at a primary one with its reset time', async () => {
    const waits: number[] = [];
    const api = fixtureFetch({
      'GET https://api.github.com/x': [
        { status: 403, headers: { 'retry-after': '2' }, json: { message: 'secondary rate limit' } },
        { json: { ok: true } },
      ],
      'GET https://api.github.com/y': {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
        json: { message: 'API rate limit exceeded' },
      },
      'GET https://api.github.com/z': { status: 429, headers: { 'retry-after': '3600' }, json: {} },
      'GET https://api.github.com/again': {
        status: 429,
        headers: { 'retry-after': '1' },
        json: {},
      },
    });
    const c = client(api.fetch, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect((await c.get('/x')).data).toEqual({ ok: true });
    expect(waits).toEqual([2000]);
    await expect(c.get('/y')).rejects.toMatchObject({
      name: 'RateLimitedError',
      resetAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(c.get('/z')).rejects.toBeInstanceOf(RateLimitedError);
    expect(waits).toEqual([2000]);
    // A limit that is still there after the wait is not waited out again.
    await expect(c.get('/again')).rejects.toBeInstanceOf(RateLimitedError);
    expect(waits).toEqual([2000, 1000]);
    expect(api.calls.filter((call) => call.url.endsWith('/again'))).toHaveLength(2);
  });

  it('stops at the request budget, and turns other failures into readable errors', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/a': { json: [] },
      'GET https://api.github.com/missing': { status: 404, json: { message: 'Not Found' } },
      'GET https://api.github.com/forbidden': { status: 403, json: { message: 'Forbidden' } },
    });
    const one = client(api.fetch, { max: 1 });
    await one.get('/a');
    await expect(one.get('/a')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(api.calls).toHaveLength(1);
    await expect(client(api.fetch).get('/missing')).rejects.toMatchObject({
      name: 'PlatformHttpError',
      status: 404,
    });
    await expect(client(api.fetch).get('/missing')).rejects.toBeInstanceOf(PlatformHttpError);
    // A 403 without rate-limit headers is a refusal, not a limit.
    await expect(client(api.fetch).get('/forbidden')).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a response larger than its size bound', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/big': { json: [{ body: 'x'.repeat(500) }] },
      'GET https://api.github.com/small': { json: [{ body: 'x' }] },
      'GET https://api.github.com/declared': {
        json: [],
        headers: { 'content-length': '1000000' },
      },
    });
    const bounded = client(api.fetch, { maxBytes: 100 });
    await expect(bounded.get('/big')).rejects.toThrow(/more than 100 bytes/);
    await expect(bounded.get('/declared')).rejects.toThrow(/more than 100 bytes/);
    expect((await bounded.get('/small')).data).toEqual([{ body: 'x' }]);
  });
});
