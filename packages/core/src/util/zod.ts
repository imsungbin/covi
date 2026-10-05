import type { z } from 'zod';
import { UsageError } from './errors.ts';

/** Formats schema issues as `path: message` lines that tell an author exactly what to fix. */
export function formatIssues(error: z.ZodError, maxIssues = 12): string[] {
  const lines = error.issues.slice(0, maxIssues).map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join('.') : '(root)';
    let message = issue.message;
    if (issue.code === 'unrecognized_keys') message = `unknown key(s): ${issue.keys.join(', ')}`;
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
