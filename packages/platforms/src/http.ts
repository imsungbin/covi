import type { FetchLike } from './types.ts';

export type PlatformName = 'GitHub' | 'GitLab';

/** Stops a long collection before it spends the token's whole rate limit. */
export class RequestBudget {
  readonly max: number;
  used = 0;

  constructor(max: number) {
    this.max = max;
  }

  take(): void {
    if (this.used >= this.max) throw new BudgetExhaustedError(this.max);
    this.used++;
  }
}

export class BudgetExhaustedError extends Error {
  constructor(max: number) {
    super(`stopped after ${max} API requests (raise --max-requests to collect more)`);
    this.name = 'BudgetExhaustedError';
  }
}

export class RateLimitedError extends Error {
  readonly resetAt?: string;

  constructor(platform: PlatformName, resetAt?: string) {
    super(`${platform} rate limit reached${resetAt ? `; it resets at ${resetAt}` : ''}`);
    this.name = 'RateLimitedError';
    this.resetAt = resetAt;
  }
}

export class PlatformHttpError extends Error {
  readonly status: number;

  constructor(platform: PlatformName, status: number, path: string) {
    super(`${platform} answered HTTP ${status} for ${path}`);
    this.name = 'PlatformHttpError';
    this.status = status;
  }
}

export interface ApiOptions {
  platform: PlatformName;
  /** The API base URL. Every request, next pages included, must stay under it. */
  base: string;
  headers: Record<string, string>;
  fetch?: FetchLike;
  budget: RequestBudget;
  /** The largest response body read; platform data is untrusted, so nothing larger is parsed. */
  maxBytes?: number;
  /** Waits out a short rate limit; tests pass a recorder. */
  sleep?: (ms: number) => Promise<void>;
}

/** The longest `retry-after` worth waiting for inside one command. */
const MAX_WAIT_MS = 60_000;

/** A page of 100 comments at GitHub's 65,536-character limit fits; anything bigger is refused. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read-only REST calls: pagination that stays on the API origin, rate limits, and a budget. */
export class ApiClient {
  private readonly options: ApiOptions;
  private readonly base: URL;

  constructor(options: ApiOptions) {
    this.options = options;
    this.base = new URL(options.base.endsWith('/') ? options.base : `${options.base}/`);
  }

  /** An absolute URL under the API base. Anything else throws: the token goes nowhere else. */
  url(pathOrUrl: string): string {
    const url = pathOrUrl.startsWith('/')
      ? new URL(`${this.base.href}${pathOrUrl.slice(1)}`)
      : new URL(pathOrUrl);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname))
      throw new Error(
        `Refusing to send a token outside ${this.base.href}: ${url.origin}${url.pathname}`,
      );
    return url.href;
  }

  async get<T>(pathOrUrl: string): Promise<{ data: T; next?: string }> {
    const url = this.url(pathOrUrl);
    const response = await this.send(url, false);
    return {
      data: JSON.parse(await this.read(response, url)) as T,
      next: this.nextLink(response.headers.get('link')),
    };
  }

  /** Every page of a list, following `rel="next"`, up to `maxPages` pages. */
  async getAll<T>(path: string, maxPages = 10): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < maxPages; page++) {
      const result: { data: T[]; next?: string } = await this.get<T[]>(next);
      out.push(...result.data);
      next = result.next;
    }
    return out;
  }

  private nextLink(header: string | null): string | undefined {
    const href = header
      ?.split(',')
      .map((part) => /<([^>]+)>\s*;\s*rel="next"/.exec(part)?.[1])
      .find(Boolean);
    if (!href) return undefined;
    try {
      return this.url(href);
    } catch {
      // A next page somewhere else is not followed.
      return undefined;
    }
  }

  private async send(url: string, retried: boolean): Promise<Response> {
    this.options.budget.take();
    const fetchImpl = this.options.fetch ?? ((u, init) => fetch(u, init));
    const response = await fetchImpl(url, {
      headers: { ...this.options.headers },
      signal: AbortSignal.timeout(30_000),
    });
    const limit = rateLimit(response);
    if (limit) {
      await response.body?.cancel();
      if (!retried && limit.waitMs !== undefined && limit.waitMs <= MAX_WAIT_MS) {
        await (this.options.sleep ?? delay)(limit.waitMs);
        return this.send(url, true);
      }
      throw new RateLimitedError(this.options.platform, limit.resetAt);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PlatformHttpError(this.options.platform, response.status, new URL(url).pathname);
    }
    return response;
  }

  /** The body as text, refused once it passes the size bound, before it is all in memory. */
  private async read(response: Response, url: string): Promise<string> {
    const max = this.options.maxBytes ?? MAX_RESPONSE_BYTES;
    const tooLarge = () =>
      new Error(
        `${this.options.platform} sent more than ${max} bytes for ${new URL(url).pathname}`,
      );
    if (Number(response.headers.get('content-length')) > max) {
      await response.body?.cancel();
      throw tooLarge();
    }
    if (!response.body) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

/** GitHub's and GitLab's rate limits: 429, or 403 with no requests left or a `retry-after`. */
function rateLimit(response: Response): { waitMs?: number; resetAt?: string } | undefined {
  const headers = response.headers;
  const retryAfter = headers.get('retry-after');
  const remaining = headers.get('x-ratelimit-remaining') ?? headers.get('ratelimit-remaining');
  const limited =
    response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter));
  if (!limited) return undefined;
  const reset = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset');
  return {
    waitMs: retryAfter && /^\d{1,9}$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined,
    // Bounded so a nonsense header cannot make an invalid date.
    resetAt:
      reset && /^\d{1,11}$/.test(reset) ? new Date(Number(reset) * 1000).toISOString() : undefined,
  };
}
