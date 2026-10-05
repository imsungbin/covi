import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseConfigInput, resolveConfig } from '../src/config/resolve.ts';
import { buildAnalysisSystemPrompt } from '../src/intelligence/analyze.ts';
import { AnthropicProvider, FALLBACK_BETA } from '../src/intelligence/anthropic.ts';
import { CommandProvider } from '../src/intelligence/command.ts';
import { extractJson, structuredSchema } from '../src/intelligence/json.ts';
import { chooseProvider } from '../src/intelligence/provider.ts';

const Schema = z.strictObject({
  verdict: z.enum(['ok', 'bad']),
  notes: z.array(z.string()).default([]),
});

function fakeClient(responses: unknown[]) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          calls.push(params);
          const next = responses.shift();
          return {
            finalMessage: async () => (next instanceof Error ? Promise.reject(next) : next),
          };
        },
      },
    },
  };
}

describe('chooseProvider', () => {
  const cfg = (input = {}) =>
    resolveConfig([{ name: 'repository', values: parseConfigInput(input, 't') }]).config;
  it('prefers an API key, then a configured command, then heuristics', () => {
    expect(chooseProvider(cfg(), { ANTHROPIC_API_KEY: 'k' })).toMatchObject({
      kind: 'anthropic',
      model: 'claude-opus-5-5',
    });
    expect(chooseProvider(cfg({ intelligence: { command: 'claude -p' } }), {})).toMatchObject({
      kind: 'command',
      command: 'claude -p',
    });
    expect(chooseProvider(cfg(), {})).toMatchObject({ kind: 'heuristic' });
    expect(
      chooseProvider(cfg({ intelligence: { provider: 'heuristic' } }), { ANTHROPIC_API_KEY: 'k' }),
    ).toMatchObject({ kind: 'heuristic' });
    expect(() => chooseProvider(cfg({ intelligence: { provider: 'anthropic' } }), {})).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

describe('AnthropicProvider', () => {
  it('sends a cached system prompt, structured output schema, explicit effort, and server-side fallback', async () => {
    const client = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdict":"ok"}' }] },
    ]);
    const provider = new AnthropicProvider({
      model: 'claude-opus-5-5',
      timeoutSeconds: 60,
      client,
    });
    const out = await provider.generate({
      purpose: 'review',
      system: 'SYS',
      prompt: 'PROMPT',
      schema: Schema,
    });
    expect(out).toEqual({ verdict: 'ok', notes: [] });
    const params = client.calls[0]!;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'PROMPT' }],
      output_config: { effort: 'high', format: { type: 'json_schema' } },
    });
    expect(JSON.stringify(params.output_config)).toContain('"additionalProperties":false');
  });

  it('turns refusals and truncation into clear errors', async () => {
    const refusal = fakeClient([
      { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] },
    ]);
    await expect(
      new AnthropicProvider({ model: 'm', timeoutSeconds: 1, client: refusal }).generate({
        purpose: 'review',
        system: '',
        prompt: '',
        schema: Schema,
      }),
    ).rejects.toThrow(/declined the review request \(category: cyber\)/);
    const truncated = fakeClient([
      { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"verd' }] },
    ]);
    await expect(
      new AnthropicProvider({ model: 'm', timeoutSeconds: 1, client: truncated }).generate({
        purpose: 'review',
        system: '',
        prompt: '',
        schema: Schema,
      }),
    ).rejects.toThrow(/max_tokens/);
  });

  it('rejects output that does not match the schema', async () => {
    const client = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdict":"maybe"}' }] },
    ]);
    await expect(
      new AnthropicProvider({ model: 'm', timeoutSeconds: 1, client }).generate({
        purpose: 'review',
        system: '',
        prompt: '',
        schema: Schema,
      }),
    ).rejects.toThrow(/does not match the schema/);
  });
});

describe('CommandProvider', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pipes the prompt to an agent CLI and parses wrapped JSON output', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-cmd-'));
    const script = join(dir, 'agent.sh');
    // Mimics `claude -p --output-format json`: the answer is wrapped in {"result": "..."}.
    writeFileSync(
      join(dir, 'out.json'),
      JSON.stringify({ result: 'Here you go:\n```json\n{"verdict":"bad","notes":["n1"]}\n```' }),
    );
    writeFileSync(
      script,
      `#!/bin/sh\ninput=$(cat)\ncase "$input" in *"JSON Schema"*) ;; *) echo "no schema" >&2; exit 3;; esac\ncat "${join(dir, 'out.json')}"\n`,
    );
    chmodSync(script, 0o755);
    const provider = new CommandProvider({ command: script, cwd: dir, timeoutSeconds: 10 });
    await expect(
      provider.generate({ purpose: 'review', system: 'S', prompt: 'P', schema: Schema }),
    ).resolves.toEqual({ verdict: 'bad', notes: ['n1'] });
  });

  it('reports non-zero exits', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-cmd-'));
    const provider = new CommandProvider({
      command: 'echo boom >&2; exit 7',
      cwd: dir,
      timeoutSeconds: 10,
    });
    await expect(
      provider.generate({ purpose: 'review', system: '', prompt: '', schema: Schema }),
    ).rejects.toThrow(/exited with 7: boom/);
  });
});

describe('JSON helpers and prompts', () => {
  it('extracts JSON from fenced, wrapped, and noisy output', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a":2} suffix')).toEqual({ a: 2 });
    expect(() => extractJson('nothing here')).toThrow();
  });

  it('produces a closed JSON schema without unsupported keywords', () => {
    const schema = structuredSchema(
      z.object({ a: z.string().min(3).max(9), b: z.number().int().positive().optional() }),
    );
    expect(schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'integer' } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('builds the analysis system prompt from the canonical skills', async () => {
    const system = await buildAnalysisSystemPrompt();
    expect(system).toContain('You are Covi');
    expect(system).toContain('# Review methodology');
  });
});
