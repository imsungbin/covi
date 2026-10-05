import { z } from 'zod';
import { formatIssues } from '../util/zod.ts';

/** Extracts the JSON object from model or agent-CLI output (fenced, wrapped, or bare). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [];
  for (const m of trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)) candidates.push(m[1]!);
  candidates.push(trimmed);
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  // Agent CLIs with --output-format json wrap the answer: {"result": "..."}.
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (
        value &&
        typeof value === 'object' &&
        'result' in value &&
        typeof (value as { result: unknown }).result === 'string'
      ) {
        return extractJson((value as { result: string }).result);
      }
      return value;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('No JSON object found in the output.');
}

export function validateWith<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(
    `${label} does not match the schema: ${formatIssues(result.error, 6).join('; ')}`,
  );
}

const KEEP = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'anyOf',
  'description',
  'additionalProperties',
]);

/**
 * Converts a Zod schema into the conservative JSON Schema subset accepted by structured outputs:
 * no $schema, no numeric/length bounds, closed objects.
 */
export function structuredSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  return clean(json) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    } else {
      out[key] = clean(value);
    }
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}
