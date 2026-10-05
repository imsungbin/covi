import { type DemoRequest, type Language, listOf, t } from '@covi/core';

export interface HttpResult {
  status: number;
  body: string;
  contentType?: string;
}

const MAX_BODY = 20_000;

export async function performRequest(baseUrl: string, request: DemoRequest): Promise<HttpResult> {
  const hasBody =
    request.body !== undefined && !['GET', 'HEAD'].includes(request.method.toUpperCase());
  const response = await fetch(`${baseUrl}${request.path}`, {
    method: request.method.toUpperCase(),
    headers: {
      accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...request.headers,
    },
    body: hasBody
      ? typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body)
      : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.slice(0, MAX_BODY),
    contentType: response.headers.get('content-type') ?? undefined,
  };
}

type Shape = string | { array: Shape } | { object: Record<string, Shape> };

/** The type structure of a JSON value (arrays summarized by their first elements). */
export function shapeOf(value: unknown, depth = 0): Shape {
  if (Array.isArray(value)) {
    if (value.length === 0 || depth > 4) return { array: 'unknown' };
    return { array: shapeOf(value[0], depth + 1) };
  }
  if (value && typeof value === 'object') {
    if (depth > 4) return 'object';
    return {
      object: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth + 1)])),
    };
  }
  return value === null ? 'null' : typeof value;
}

function kind(shape: Shape): string {
  if (typeof shape === 'string') return shape;
  return 'array' in shape ? 'array' : 'object';
}

/**
 * Describes incompatible differences between two JSON responses: changed top-level type, removed
 * fields, or fields whose type changed. Added fields are compatible and not reported.
 */
export function describeShapeChange(
  beforeBody: string,
  afterBody: string,
  language: Language = 'en',
): string | undefined {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `capture.shape.${key}`, params);
  const named = (k: string) => say(`kind.${k}`);
  let before: unknown;
  let after: unknown;
  try {
    before = JSON.parse(beforeBody);
    after = JSON.parse(afterBody);
  } catch {
    return undefined;
  }
  const a = shapeOf(before);
  const b = shapeOf(after);
  if (kind(a) !== kind(b)) {
    const keys =
      typeof b === 'object' && 'object' in b
        ? say('keys', { keys: Object.keys(b.object).slice(0, 4).join(', ') })
        : '';
    return say('kindChanged', { from: named(kind(a)), to: named(kind(b)), keys });
  }
  const removed: string[] = [];
  const retyped: string[] = [];
  const walk = (x: Shape, y: Shape, path: string) => {
    if (typeof x === 'object' && typeof y === 'object') {
      if ('object' in x && 'object' in y) {
        for (const [key, value] of Object.entries(x.object)) {
          const next = path ? `${path}.${key}` : key;
          if (!(key in y.object)) removed.push(next);
          else walk(value, y.object[key]!, next);
        }
      } else if ('array' in x && 'array' in y) {
        walk(x.array, y.array, `${path}[]`);
      }
      return;
    }
    if (kind(x) !== kind(y) && x !== 'unknown' && y !== 'unknown' && x !== 'null' && y !== 'null')
      retyped.push(
        say('retypedField', {
          path: path || say('value'),
          from: named(kind(x)),
          to: named(kind(y)),
        }),
      );
  };
  walk(a, b, '');
  const parts: string[] = [];
  if (removed.length)
    parts.push(say('removed', { count: removed.length, fields: removed.slice(0, 4).join(', ') }));
  if (retyped.length) parts.push(say('retyped', { fields: retyped.slice(0, 3).join(', ') }));
  if (!parts.length) return undefined;
  return say('response', {
    parts: language === 'en' ? parts.join(say('and')) : listOf(language, parts),
  });
}

export function normalizeBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body.trim();
  }
}
