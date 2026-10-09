import type { z } from 'zod';
import { UsageError } from './errors.ts';
import { escapeUnprintable } from './text.ts';

/** Characters of a key or path segment echoed from the file, and unknown keys named per issue. */
const ECHO_CHARS = 64;
const ECHO_KEYS = 8;

/**
 * Formats schema issues as `path: message` lines that tell an author exactly what to fix. Keys come
 * from the file, which may be hostile: they are escaped, cut short, and only the first few named.
 */
export function formatIssues(error: z.ZodError, maxIssues = 12): string[] {
  const echo = (text: string) => escapeUnprintable(text, ECHO_CHARS);
  const lines = error.issues.slice(0, maxIssues).map((issue) => {
    const path = issue.path.length
      ? issue.path.map((part) => (typeof part === 'string' ? echo(part) : String(part))).join('.')
      : '(root)';
    let message = escapeUnprintable(issue.message);
    if (issue.code === 'unrecognized_keys') {
      const named = issue.keys.slice(0, ECHO_KEYS).map(echo);
      const more = issue.keys.length - named.length;
      message = `unknown key(s): ${named.join(', ')}${more > 0 ? `, …and ${more} more` : ''}`;
    }
    if (issue.code === 'invalid_value' && 'values' in issue) {
      message = `expected one of ${(issue.values as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`;
    }
    return `${path}: ${message}`;
  });
  if (error.issues.length > maxIssues) lines.push(`…and ${error.issues.length - maxIssues} more`);
  return lines;
}

export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
  hint?: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new UsageError(`${label} is invalid:\n  ${formatIssues(result.error).join('\n  ')}`, hint);
}
