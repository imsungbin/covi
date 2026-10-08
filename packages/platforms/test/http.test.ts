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

  it('follows a redirect only once and only under the API base, never handing the token on', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/repos/acme/old/pulls': {
        status: 301,
        headers: { location: '/repositories/9/pulls' },
      },
      'GET https://api.github.com/repositories/9/pulls': { json: [1] },
      'GET https://api.github.com/moved': {
        status: 302,
        headers: { location: 'https://evil.example/steal' },
      },
      'GET https://api.github.com/loop': { status: 302, headers: { location: '/loop2' } },
      'GET https://api.github.com/loop2': { status: 302, headers: { location: '/loop' } },
    });
    const c = client(api.fetch);
    expect((await c.get('/repos/acme/old/pulls')).data).toEqual([1]);
    await expect(c.get('/moved')).rejects.toMatchObject({ name: 'PlatformHttpError', status: 302 });
    await expect(c.get('/loop')).rejects.toMatchObject({ status: 302 });
    expect(api.calls.map((call) => call.url)).toEqual([
      'https://api.github.com/repos/acme/old/pulls',
      'https://api.github.com/repositories/9/pulls',
      'https://api.github.com/moved',
      'https://api.github.com/loop',
      'https://api.github.com/loop2',
    ]);
    // fetch itself must not follow: it would forward a custom token header (GitLab's) anywhere.
    expect(api.calls.every((call) => call.redirect === 'manual')).toBe(true);
  });

  it('refuses a URL with userinfo, and names only the path when a redirect carries one', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/moved': {
        status: 301,
        headers: { location: 'https://user:secret@api.github.com/repositories/9' },
      },
    });
    const c = client(api.fetch);
    const error = await c.get('/moved').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlatformHttpError);
    expect(error).toMatchObject({ status: 301, message: 'GitHub answered HTTP 301 for /moved' });
    expect(api.calls).toHaveLength(1);
    expect(() => c.url('https://user:secret@api.github.com/x')).toThrow(/Refusing to send a token/);
    expect(() => c.url('https://user:secret@api.github.com/x')).not.toThrow(/secret/);
  });

  it('stops a Link cycle at the page limit', async () => {
    const page = 'https://api.github.com/repos/a/b/pulls?page=1';
    const api = fixtureFetch({
      [`GET ${page}`]: { json: [1], headers: { link: `<${page}>; rel="next"` } },
    });
    expect(await client(api.fetch).getAll('/repos/a/b/pulls?page=1')).toHaveLength(10);
    expect(api.calls).toHaveLength(10);
    expect(await client(api.fetch).getAll('/repos/a/b/pulls?page=1', 3)).toEqual([1, 1, 1]);
    expect(api.calls).toHaveLength(13);
  });

  it('says when the page limit left pages unread', async () => {
    const page = 'https://api.github.com/repos/a/b/pulls?page=1';
    const api = fixtureFetch({
      [`GET ${page}`]: { json: [1], headers: { link: `<${page}>; rel="next"` } },
      'GET https://api.github.com/one': { json: [1] },
    });
    expect(await client(api.fetch).getPages('/repos/a/b/pulls?page=1', 2)).toEqual({
      items: [1, 1],
      truncated: true,
    });
    expect(await client(api.fetch).getPages('/one')).toEqual({ items: [1], truncated: false });
  });

  it('reads a newest-first list from its oldest end, within the page limit', async () => {
    const base = 'https://api.github.com/repos/a/b/commits?per_page=2';
    const link = (rels: Record<string, number>) =>
      Object.entries(rels)
        .map(([rel, n]) => `<${base}&page=${n}>; rel="${rel}"`)
        .join(', ');
    const api = fixtureFetch({
      [`GET ${base}`]: { json: [10, 9], headers: { link: link({ next: 2, last: 5 }) } },
      [`GET ${base}&page=5`]: { json: [2, 1], headers: { link: link({ prev: 4, first: 1 }) } },
      [`GET ${base}&page=4`]: { json: [4, 3], headers: { link: link({ prev: 3, next: 5 }) } },
      [`GET ${base}&page=3`]: { json: [6, 5], headers: { link: link({ prev: 2, next: 4 }) } },
      [`GET ${base}&page=2`]: { json: [8, 7], headers: { link: link({ prev: 1, next: 3 }) } },
    });
    // Three pages: the newest (for its link to the last), then the two oldest.
    expect(await client(api.fetch).getOldestFirst('/repos/a/b/commits?per_page=2', 3)).toEqual({
      items: [1, 2, 3, 4, 9, 10],
      truncated: true,
    });
    // Enough pages: everything, oldest first, the first page read once.
    expect(await client(api.fetch).getOldestFirst('/repos/a/b/commits?per_page=2', 5)).toEqual({
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      truncated: false,
    });
    const single = fixtureFetch({ [`GET ${base}`]: { json: [2, 1] } });
    expect(await client(single.fetch).getOldestFirst('/repos/a/b/commits?per_page=2')).toEqual({
      items: [1, 2],
      truncated: false,
    });
    expect(single.calls).toHaveLength(1);
  });

  it('names the request, not the token, when a body is empty or not JSON', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/empty': { fixture: 'empty.txt' },
      'GET https://api.github.com/cut?token=secret': { fixture: 'github/truncated.txt' },
    });
    const c = client(api.fetch);
    await expect(c.get('/empty')).rejects.toThrow('GitHub sent a body that is not JSON for /empty');
    const error = await c.get('/cut?token=secret').catch((e: Error) => e);
    expect(String(error)).toMatch(/not JSON for \/cut$/);
    expect(String(error)).not.toContain('secret');
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
