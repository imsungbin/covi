import { createInterface } from 'node:readline/promises';
import { CERTAINTY_LABEL, type Logger, Redactor, VERDICT_LABEL } from '@covi/core';
import type { VideoQuestion } from '@covi/video';
import pc from 'picocolors';
import type { WorkflowResult } from './workflows.ts';

export interface UiOptions {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  color: boolean;
}

type Colors = ReturnType<typeof pc.createColors> & { cobalt: (s: string) => string };

/**
 * Colors for one output stream. Terminals and CI logs (which render ANSI) get color; pipes and
 * files do not. `--no-color` and NO_COLOR always win; FORCE_COLOR forces it on.
 */
function colorsFor(stream: NodeJS.WriteStream, wanted: boolean): Colors {
  const force = process.env.FORCE_COLOR;
  const on = wanted && Boolean((force && force !== '0') || process.env.CI || stream.isTTY);
  return {
    ...pc.createColors(on),
    cobalt: (s) => (on ? `\u001b[38;2;59;91;255m${s}\u001b[39m` : s),
  };
}

/** Terminal logger: progress on stderr so stdout stays clean for results and --json. */
export class TerminalLogger implements Logger {
  private readonly options: UiOptions;
  private readonly prefix: string;
  private readonly redactor: Redactor;
  private readonly c: Colors;

  constructor(options: UiOptions, prefix = '', redactor = Redactor.fromProcess()) {
    this.options = options;
    this.prefix = prefix;
    this.redactor = redactor;
    this.c = colorsFor(process.stderr, options.color);
  }

  private write(line: string): void {
    process.stderr.write(`${this.redactor.redact(line)}\n`);
  }

  debug(message: string): void {
    if (this.options.verbose) this.write(this.c.dim(`  ${this.prefix}${message}`));
  }
  info(message: string): void {
    if (!this.options.quiet && !this.options.json)
      this.write(this.c.dim(`${this.prefix}${message}`));
  }
  step(message: string): void {
    if (!this.options.quiet && !this.options.json)
      this.write(`${this.c.cobalt('›')} ${this.prefix}${message}`);
  }
  warn(message: string): void {
    this.write(`${this.c.yellow('warning')} ${this.prefix}${message}`);
  }
  error(message: string): void {
    this.write(`${this.c.red('error')} ${this.prefix}${message}`);
  }
  child(prefix: string): Logger {
    return new TerminalLogger(this.options, `${this.prefix}${prefix}: `, this.redactor);
  }
}

export function isInteractive(flags: {
  yes?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
}): boolean {
  if (flags.yes || flags.nonInteractive || flags.json) return false;
  if (process.env.CI || process.env.COVI_NONINTERACTIVE) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export type Question = Pick<VideoQuestion, 'question' | 'options'>;

/** Minimal numbered-choice prompt for humans at a terminal (agents use their own question tool). */
export async function ask(question: Question): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`\n${pc.bold(question.question)}\n`);
    for (const [i, o] of question.options.entries())
      process.stderr.write(
        `  ${pc.cyan(String(i + 1))}. ${o.label} ${pc.dim(`· ${o.description}`)}\n`,
      );
    const answer = (await rl.question(pc.dim(`Choose 1-${question.options.length} [1]: `))).trim();
    const index = answer ? Number(answer) - 1 : 0;
    return (question.options[index] ?? question.options[0]!).value;
  } finally {
    rl.close();
  }
}

/** Human-readable result (stdout). */
export function printResult(result: WorkflowResult, options: UiOptions, extra?: string): void {
  const out: string[] = [];
  const c = colorsFor(process.stdout, options.color);
  const severityColor = { high: c.red, medium: c.yellow, low: c.blue } as const;
  if (extra) out.push(extra.trimEnd(), '');
  if (result.change && result.command !== 'publish') {
    out.push(
      `${c.cobalt('◆')} ${c.bold(`covi ${result.command}`)}  ${result.change.title ? `${result.change.title} · ` : ''}${result.change.base.slice(0, 7)}…${result.change.head.slice(0, 7)} · ${result.change.files} files, ${c.green(`+${result.change.additions}`)} ${c.red(`−${result.change.deletions}`)}`,
    );
  }
  if (result.verdict) {
    const review = (
      result.data as
        | {
            review?: {
              summary: string;
              findings: Array<{
                title: string;
                certainty: keyof typeof CERTAINTY_LABEL;
                severity: 'high' | 'medium' | 'low';
                location?: { path: string; line?: number };
              }>;
            };
          }
        | undefined
    )?.review;
    const color =
      result.verdict === 'looks-good'
        ? c.green
        : result.verdict === 'needs-changes'
          ? c.red
          : c.yellow;
    out.push(
      '',
      `${color(c.bold(VERDICT_LABEL[result.verdict]))}${review ? `: ${review.summary}` : ''}`,
    );
    for (const [i, f] of (review?.findings ?? []).entries()) {
      const where = f.location
        ? c.dim(` ${f.location.path}${f.location.line ? `:${f.location.line}` : ''}`)
        : '';
      out.push(
        `  ${i + 1}. ${severityColor[f.severity](CERTAINTY_LABEL[f.certainty])} · ${f.severity}${where}`,
        `     ${f.title}`,
      );
    }
  }
  if (result.video) {
    out.push(
      '',
      result.video.rendered
        ? `${c.green('Video')} ${result.video.path} ${c.dim(`(${result.video.seconds?.toFixed(1)}s · QC ${result.video.qc} · ${result.video.reason})`)}`
        : `${c.dim('No video:')} ${result.video.reason}`,
    );
  }
  if (result.message)
    out.push('', result.exitCode === 0 ? result.message : c.yellow(result.message));
  if (result.warnings.length) out.push('', ...result.warnings.map((w) => `${c.yellow('!')} ${w}`));
  if (result.runDir) out.push('', `${c.dim('Artifacts:')} ${result.runDir}`);
  process.stdout.write(`${out.join('\n')}\n`);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
