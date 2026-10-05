import Anthropic from '@anthropic-ai/sdk';
import { extractJson, structuredSchema, validateWith } from './json.ts';
import { type GenerateRequest, type ModelProvider, ProviderError } from './provider.ts';

/** The subset of the SDK client this provider uses (injectable for tests). */
export interface AnthropicLike {
  beta: {
    messages: { stream(params: Record<string, unknown>): { finalMessage(): Promise<unknown> } };
  };
}

interface MessageLike {
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content?: Array<{ type: string; text?: string }>;
  model?: string;
}

export interface AnthropicProviderOptions {
  model: string;
  timeoutSeconds: number;
  client?: AnthropicLike;
  /** Thinking depth. Reviews benefit from deliberate reasoning; Opus 5.5 defaults to medium. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/** Server-side refusal fallback: re-runs a declined request on Anthropic's recommended model. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;
  private readonly client: AnthropicLike;
  private readonly effort: NonNullable<AnthropicProviderOptions['effort']>;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.effort = options.effort ?? 'high';
    this.client =
      options.client ??
      (new Anthropic({
        timeout: options.timeoutSeconds * 1000,
        maxRetries: 2,
      }) as unknown as AnthropicLike);
  }

  async generate<T>(request: GenerateRequest<T>): Promise<T> {
    const base = {
      model: this.model,
      max_tokens: request.maxTokens ?? 32_000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: request.prompt }],
    };
    let message: MessageLike;
    try {
      message = await this.send({
        ...base,
        output_config: {
          effort: this.effort,
          format: { type: 'json_schema', schema: structuredSchema(request.schema) },
        },
      });
    } catch (error) {
      // Some schemas use features structured outputs does not accept; fall back to instructed JSON.
      if (
        error instanceof Anthropic.BadRequestError &&
        /output_config|schema|format/i.test(error.message)
      ) {
        message = await this.send({ ...base, output_config: { effort: this.effort } });
      } else {
        throw this.wrap(error);
      }
    }

    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category ?? 'unspecified';
      throw new ProviderError(
        'anthropic',
        `The model declined the ${request.purpose} request (category: ${category}).`,
      );
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ProviderError(
        'anthropic',
        `The ${request.purpose} response hit max_tokens before completing.`,
      );
    }
    const text = (message.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    try {
      return validateWith(request.schema, extractJson(text), `Model ${request.purpose} output`);
    } catch (error) {
      throw new ProviderError('anthropic', (error as Error).message);
    }
  }

  private async send(params: Record<string, unknown>): Promise<MessageLike> {
    // Streaming avoids HTTP timeouts on long structured outputs; finalMessage() assembles the result.
    return (await this.client.beta.messages.stream(params).finalMessage()) as MessageLike;
  }

  private wrap(error: unknown): Error {
    if (error instanceof ProviderError) return error;
    if (error instanceof Anthropic.AuthenticationError)
      return new ProviderError(
        'anthropic',
        'authentication failed (check ANTHROPIC_API_KEY).',
        error,
      );
    if (error instanceof Anthropic.RateLimitError)
      return new ProviderError('anthropic', 'rate limited after retries.', error);
    if (error instanceof Anthropic.APIError)
      return new ProviderError(
        'anthropic',
        `API error ${error.status ?? ''}: ${error.message}`,
        error,
      );
    return new ProviderError('anthropic', (error as Error).message ?? String(error), error);
  }
}
