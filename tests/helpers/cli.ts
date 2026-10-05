import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BIN = join(import.meta.dirname, '..', '..', 'bin', 'covi.mjs');

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  json: () => Record<string, unknown>;
}

/** Runs the real `covi` binary (no TTY, so never interactive). */
export function covi(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): CliResult {
  const result = spawnSync('node', [BIN, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, NO_COLOR: '1', COVI_NONINTERACTIVE: '1', ...options.env },
    input: options.input,
    encoding: 'utf8',
    timeout: 300_000,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout) as Record<string, unknown>,
  };
}

/**
 * Async variant for tests that serve mock APIs from the test process: a synchronous spawn would
 * block the event loop and the mock server could never answer the CLI's requests.
 */
export function coviAsync(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, NO_COLOR: '1', COVI_NONINTERACTIVE: '1', ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        json: () => JSON.parse(stdout) as Record<string, unknown>,
      }),
    );
  });
}
