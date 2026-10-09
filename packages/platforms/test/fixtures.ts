import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike } from '../src/types.ts';

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** A saved response body under `test/fixtures/`. */
  fixture?: string;
  json?: unknown;
}

/**
 * Serves saved platform responses by exact `METHOD URL`. Any other request fails the test, so
 * nothing reaches the network. A list of replies is served in order, the last one repeating.
 * `replace` fills placeholders in saved bodies (ledgers and anchor markers made by the test).
 */
export function fixtureFetch(
  routes: Record<string, Reply | Reply[]>,
  replace: Record<string, string> = {},
) {
  const calls: Array<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    /** How the caller asked fetch to treat a redirect; the fake never follows one. */
    redirect?: RequestInit['redirect'];
  }> = [];
  const queues = new Map(
    Object.entries(routes).map(([key, reply]) => [
      key,
      Array.isArray(reply) ? [...reply] : [reply],
    ]),
  );
  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({
      method,
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init.redirect,
    });
    const queue = queues.get(`${method} ${url}`);
    if (!queue?.length) throw new Error(`Unexpected request: ${method} ${url}`);
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    let text = reply.fixture
      ? readFileSync(join(import.meta.dirname, 'fixtures', reply.fixture), 'utf8')
      : JSON.stringify(reply.json ?? {});
    for (const [from, to] of Object.entries(replace)) text = text.replaceAll(from, to);
    return new Response(text, {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  return { fetch, calls };
}
