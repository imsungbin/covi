/**
 * Error types carry an exit code so every entry point (CLI, CI, agents) maps
 * failures to the same documented process status.
 */
export const ExitCode = {
  ok: 0,
  /** Review gate failed: findings at or above the configured `failOn` threshold. */
  gate: 1,
  /** Invalid usage, configuration, or agent-authored artifact. */
  usage: 2,
  /** The environment cannot do what was asked (not a git repo, missing ffmpeg, no browser). */
  environment: 3,
  /** Unexpected internal failure. */
  internal: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class CoviError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly hint?: string;
  constructor(
    message: string,
    options: { exitCode?: ExitCodeValue; hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CoviError';
    this.exitCode = options.exitCode ?? ExitCode.internal;
    this.hint = options.hint;
  }
}

export class UsageError extends CoviError {
  constructor(message: string, hint?: string) {
    super(message, { exitCode: ExitCode.usage, hint });
    this.name = 'UsageError';
  }
}

export class EnvironmentError extends CoviError {
  constructor(message: string, hint?: string, cause?: unknown) {
    super(message, { exitCode: ExitCode.environment, hint, cause });
    this.name = 'EnvironmentError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
