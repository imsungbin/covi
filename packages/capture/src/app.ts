import { createServer } from 'node:net';
import { join } from 'node:path';
import {
  type CoviConfig,
  childEnv,
  execShell,
  type Logger,
  type Run,
  type ServiceHandle,
  serveStatic,
  startService,
} from '@covi/core';

export interface RunningApp {
  url: string;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function substitute(template: string, port: number): string {
  return template.replace(/\{port\}/g, String(port));
}

/** Polls until the app answers (any status below 500) or the process dies or time runs out. */
export async function waitForReady(
  url: string,
  timeoutMs: number,
  service?: ServiceHandle,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  service?.exited.then(() => {
    exited = true;
  });
  let last = '';
  while (Date.now() < deadline) {
    if (exited)
      throw new Error(
        `The app exited before it was ready.\n${service?.output().split('\n').slice(-15).join('\n')}`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      if (response.status < 500) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = (error as Error).message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `The app at ${url} was not ready within ${Math.round(timeoutMs / 1000)}s (${last}).\n${service?.output().split('\n').slice(-15).join('\n') ?? ''}`,
  );
}

/**
 * Starts the software for one revision: a static site (no project code runs), a configured start
 * command (sandboxed environment), or an externally running URL.
 */
export async function startApp(
  dir: string,
  config: CoviConfig,
  options: {
    mode: 'static' | 'command' | 'url';
    staticRoot?: string;
    run: Run;
    logger: Logger;
    revision: string;
  },
): Promise<RunningApp> {
  const { app } = config;
  if (options.mode === 'url') {
    if (!app.url) throw new Error('app.url is required');
    return { url: app.url.replace(/\/$/, ''), stop: async () => {} };
  }
  if (options.mode === 'static') {
    const server = await serveStatic(join(dir, options.staticRoot ?? '.'));
    return { url: server.url, stop: () => server.close() };
  }
  const env = childEnv({ extra: app.env, passThrough: app.passEnv });
  if (app.install) {
    options.logger.info(`  installing (${options.revision}): ${app.install}`);
    const result = await execShell(app.install, { cwd: dir, env, timeoutMs: 15 * 60_000 });
    options.run.recordCommand({
      command: app.install,
      cwd: options.revision,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      purpose: 'install',
    });
    if (result.exitCode !== 0)
      throw new Error(
        `Install failed for ${options.revision} (exit ${result.exitCode}):\n${(result.stderr || result.stdout).split('\n').slice(-12).join('\n')}`,
      );
  }
  if (!app.start) throw new Error('app.start is required to run the app');
  const port = app.port ?? (await freePort());
  const command = substitute(app.start, port);
  env.PORT = String(port);
  options.logger.info(`  starting (${options.revision}): ${command}`);
  const service = startService(command, { cwd: dir, env });
  const started = Date.now();
  const url = substitute(app.url ?? 'http://127.0.0.1:{port}', port).replace(/\/$/, '');
  try {
    await waitForReady(`${url}${app.readyPath}`, app.timeout * 1000, service);
  } catch (error) {
    await service.stop();
    options.run.recordCommand({
      command,
      cwd: options.revision,
      exitCode: null,
      durationMs: Date.now() - started,
      timedOut: true,
      purpose: 'start',
    });
    throw error;
  }
  return {
    url,
    stop: async () => {
      await service.stop();
      options.run.recordCommand({
        command,
        cwd: options.revision,
        exitCode: 0,
        durationMs: Date.now() - started,
        timedOut: false,
        purpose: 'start',
      });
    },
  };
}
