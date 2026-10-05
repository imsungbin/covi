import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resourcePath } from '@covi/core';

let cached: string | undefined;

export async function coviVersion(): Promise<string> {
  if (cached) return cached;
  try {
    cached =
      (JSON.parse(await readFile(resourcePath('package.json'), 'utf8')) as { version?: string })
        .version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

/** Synchronous variant for argument parsing (`covi --version`). */
export function coviVersionSync(): string {
  try {
    return (
      (JSON.parse(readFileSync(resourcePath('package.json'), 'utf8')) as { version?: string })
        .version ?? '0.0.0'
    );
  } catch {
    return '0.0.0';
  }
}
