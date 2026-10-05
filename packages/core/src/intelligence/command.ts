import { execShell } from '../exec/exec.ts';
import { extractJson, structuredSchema, validateWith } from './json.ts';
import { type GenerateRequest, type ModelProvider, ProviderError } from './provider.ts';

/**
 * Delegates reasoning to any agent CLI (for example `claude -p` or `codex exec`). Covi writes the
 * prompt to stdin and expects a JSON object on stdout, so the same methodology runs on whatever
 * agent a team already uses in CI.
 */
export class CommandProvider implements ModelProvider {
  readonly id = 'command' as const;
  readonly model: string;
  private readonly command: string;
  private readonly cwd: string;
  private readonly timeoutSeconds: number;

  constructor(options: { command: string; cwd: string; timeoutSeconds: number }) {
    this.command = options.command;
    this.model = options.command.split(/\s+/)[0] ?? 'command';
    this.cwd = options.cwd;
    this.timeoutSeconds = options.timeoutSeconds;
  }

  async generate<T>(request: GenerateRequest<T>): Promise<T> {
    const input = [
      request.system,
      '',
      '---',
      '',
      request.prompt,
      '',
      'Respond with a single JSON object and nothing else. It must match this JSON Schema:',
      JSON.stringify(structuredSchema(request.schema)),
    ].join('\n');
    const result = await execShell(this.command, {
      cwd: this.cwd,
      input,
      timeoutMs: this.timeoutSeconds * 1000,
      maxOutputBytes: 16 * 1024 * 1024,
    });
    if (result.timedOut)
      throw new ProviderError(
        'command',
        `"${this.model}" timed out after ${this.timeoutSeconds}s.`,
      );
    if (result.exitCode !== 0) {
      throw new ProviderError(
        'command',
        `"${this.model}" exited with ${result.exitCode}: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`,
      );
    }
    try {
      return validateWith(
        request.schema,
        extractJson(result.stdout),
        `${this.model} ${request.purpose} output`,
      );
    } catch (error) {
      throw new ProviderError('command', (error as Error).message);
    }
  }
}
