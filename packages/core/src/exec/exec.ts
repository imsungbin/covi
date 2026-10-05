import { type ChildProcess, spawn } from 'node:child_process';

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string | Uint8Array;
  /** Captured output is capped; the tail is kept because errors usually appear last. */
  maxOutputBytes?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;

/** Runs a program without a shell. */
export function exec(
  file: string,
  args: readonly string[],
  options: ExecOptions,
): Promise<ExecResult> {
  return run(spawn(file, args, spawnOptions(options, false)), options);
}

/** Runs a shell command line (used for commands that come from configuration). */
export function execShell(command: string, options: ExecOptions): Promise<ExecResult> {
  return run(spawn(shell(), shellArgs(command), spawnOptions(options, true)), options);
}

export interface ServiceHandle {
  readonly pid: number | undefined;
  /** Resolves when the process exits on its own (crash or early exit). */
  readonly exited: Promise<ExecResult>;
  output(): string;
  stop(graceMs?: number): Promise<void>;
}

/** Starts a long-running command (e.g. a dev server) in its own process group. */
export function startService(
  command: string,
  options: Omit<ExecOptions, 'timeoutMs' | 'input'>,
): ServiceHandle {
  const child = spawn(shell(), shellArgs(command), spawnOptions(options, true));
  let tail = '';
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-64 * 1024);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = run(child, { ...options, maxOutputBytes: 64 * 1024 });
  let stopped = false;
  return {
    pid: child.pid,
    exited,
    output: () => tail,
    async stop(graceMs = 3000) {
      if (stopped || child.exitCode !== null) return;
      stopped = true;
      killTree(child, 'SIGTERM');
      const timer = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), graceMs),
      );
      if ((await Promise.race([exited.then(() => 'exited' as const), timer])) === 'timeout') {
        killTree(child, 'SIGKILL');
        await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))]);
      }
    },
  };
}

function shell(): string {
  return process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh';
}

function shellArgs(command: string): string[] {
  return process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
}

function spawnOptions(
  options: ExecOptions | Omit<ExecOptions, 'timeoutMs' | 'input'>,
  group: boolean,
) {
  return {
    cwd: options.cwd,
    env: options.env ?? process.env,
    // A separate process group lets us terminate servers together with their children.
    detached: group && process.platform !== 'win32',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
  };
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

function run(child: ChildProcess, options: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  const max = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  let stdout = '';
  let stderr = '';
  let truncated = false;
  let timedOut = false;

  const append = (current: string, chunk: string): string => {
    const next = current + chunk;
    if (next.length > max) {
      truncated = true;
      return next.slice(next.length - max);
    }
    return next;
  };

  return new Promise((resolve, reject) => {
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = append(stdout, chunk);
      options.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = append(stderr, chunk);
      options.onStderr?.(chunk);
    });

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child, 'SIGTERM');
            setTimeout(() => killTree(child, 'SIGKILL'), 2000).unref();
          }, options.timeoutMs)
        : undefined;
    timer?.unref?.();

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });

    if (child.stdin) {
      child.stdin.on('error', () => {
        // The process may exit before reading stdin; that is not an error for us.
      });
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    }
  });
}

/** Resolves the first available executable from candidates on PATH. */
export async function which(candidates: readonly string[]): Promise<string | undefined> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  for (const candidate of candidates) {
    try {
      const result = await exec(probe, [candidate], { cwd: process.cwd(), timeoutMs: 5000 });
      const found = result.stdout.split(/\r?\n/)[0]?.trim();
      if (result.exitCode === 0 && found) return found;
    } catch {
      // Keep looking.
    }
  }
  return undefined;
}
