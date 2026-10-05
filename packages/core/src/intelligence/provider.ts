import type { z } from 'zod';
import type { CoviConfig } from '../config/schema.ts';
import { CoviError, ExitCode } from '../util/errors.ts';

/**
 * Covi separates methodology (skills, schemas, renderers) from intelligence. Inside a coding-agent
 * session the agent itself is the intelligence and writes the JSON artifacts. In automation, a
 * ModelProvider fills the same artifacts; without one, Covi's deterministic heuristics do.
 */
export interface GenerateRequest<T> {
  /** Short label for logs and the run manifest, e.g. "review" or "storyboard". */
  purpose: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface ModelProvider {
  readonly id: 'anthropic' | 'command';
  readonly model?: string;
  generate<T>(request: GenerateRequest<T>): Promise<T>;
}

export class ProviderError extends CoviError {
  readonly provider: string;
  constructor(provider: string, message: string, cause?: unknown) {
    super(`${provider}: ${message}`, { exitCode: ExitCode.environment, cause });
    this.name = 'ProviderError';
    this.provider = provider;
  }
}

export type ProviderChoice =
  | { kind: 'heuristic'; reason: string }
  | { kind: 'anthropic'; model: string; reason: string }
  | { kind: 'command'; command: string; reason: string };

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Decides which intelligence to use; `auto` prefers an API key, then a configured agent command. */
export function chooseProvider(
  config: CoviConfig,
  env: NodeJS.ProcessEnv = process.env,
): ProviderChoice {
  const { provider, model, command } = config.intelligence;
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  if (provider === 'heuristic') return { kind: 'heuristic', reason: 'configured' };
  if (provider === 'anthropic') {
    if (!hasAnthropic) {
      throw new CoviError(
        'intelligence.provider is "anthropic" but ANTHROPIC_API_KEY is not set.',
        {
          exitCode: ExitCode.environment,
          hint: 'Export ANTHROPIC_API_KEY, or use provider: heuristic.',
        },
      );
    }
    return { kind: 'anthropic', model: model ?? DEFAULT_MODEL, reason: 'configured' };
  }
  if (provider === 'command') {
    if (!command)
      throw new CoviError('intelligence.provider is "command" but intelligence.command is empty.', {
        exitCode: ExitCode.usage,
      });
    return { kind: 'command', command, reason: 'configured' };
  }
  if (hasAnthropic)
    return { kind: 'anthropic', model: model ?? DEFAULT_MODEL, reason: 'ANTHROPIC_API_KEY is set' };
  if (command) return { kind: 'command', command, reason: 'intelligence.command is configured' };
  return { kind: 'heuristic', reason: 'no model provider configured' };
}
