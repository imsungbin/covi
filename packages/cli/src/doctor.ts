import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  chooseProvider,
  exec,
  exists,
  Git,
  LANGUAGE_NAME,
  type Language,
  loadRepositoryConfig,
  repositoryCommands,
  resolveConfig,
  TrustStore,
  which,
} from '@covi/core';
import { chooseTts, localeLanguage, Media, SystemTts } from '@covi/video';
import { chromium } from 'playwright';

export interface DoctorCheck {
  id: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  hint?: string;
}

/** Preflight: what Covi can do in this environment, and what to install for the rest. */
export async function doctor(repo: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
  const nodeOk = major > 22 || (major === 22 && minor >= 18);
  checks.push(
    nodeOk
      ? { id: 'node', status: 'ok', message: `Node.js ${process.versions.node}` }
      : {
          id: 'node',
          status: 'fail',
          message: `Node.js ${process.versions.node} is too old`,
          hint: 'Install Node.js 22.18 or newer.',
        },
  );

  const git = await which(['git']);
  if (!git)
    checks.push({ id: 'git', status: 'fail', message: 'git not found', hint: 'Install git.' });
  else {
    const version = (
      await exec('git', ['--version'], { cwd: repo, timeoutMs: 5000 })
    ).stdout.trim();
    checks.push({ id: 'git', status: 'ok', message: version });
    const root = await new Git(repo).tryOut(['rev-parse', '--show-toplevel']);
    if (!root)
      checks.push({
        id: 'repository',
        status: 'warn',
        message: `${repo} is not inside a git repository`,
        hint: 'Run Covi from a repository or pass --repo.',
      });
    else {
      try {
        const loaded = await loadRepositoryConfig(root, { kind: 'worktree' });
        checks.push({
          id: 'config',
          status: 'ok',
          message: loaded.source
            ? `${loaded.source} is valid`
            : 'No .covi/config.yml (defaults apply; `covi init` creates one)',
        });
        const { config } = resolveConfig(
          loaded.values ? [{ name: 'repository', values: loaded.values }] : [],
        );
        const commands = repositoryCommands(loaded.values);
        if (commands.length)
          checks.push(
            (await new TrustStore().isTrusted(root, commands))
              ? {
                  id: 'commands',
                  status: 'ok',
                  message: `The ${commands.length} command setting(s) in ${loaded.source} are trusted here`,
                }
              : {
                  id: 'commands',
                  status: 'warn',
                  message: `${loaded.source} sets ${commands.length} command setting(s) that are not trusted here yet, so Covi will not use them`,
                  hint: 'Review and allow them with `covi trust`.',
                },
          );
        const choice = chooseProvider(config);
        checks.push({
          id: 'intelligence',
          status: 'ok',
          message:
            choice.kind === 'heuristic'
              ? 'Built-in heuristics (run Covi from a coding agent, or set ANTHROPIC_API_KEY, for reasoning reviews)'
              : `${choice.kind}${'model' in choice ? ` (${choice.model})` : ''}: ${choice.reason}`,
        });
        const tts = await chooseTts({ ...config.video.narration, enabled: true });
        // System voices speak one language each; say which one Covi would use for each language.
        const others: string[] = [];
        const missing: string[] = [];
        if (tts.provider?.id === 'system' && !config.video.narration.voice) {
          for (const language of ['ko', 'ja', 'zh'] as Language[]) {
            const voice = await SystemTts.detect(undefined, language);
            if (voice && localeLanguage(voice.locale) === language)
              others.push(`${LANGUAGE_NAME[language]} "${voice.voice}"`);
            else missing.push(LANGUAGE_NAME[language]);
          }
        }
        checks.push(
          tts.provider
            ? {
                id: 'narration',
                status: 'ok',
                message: `${tts.provider.id} voice "${tts.provider.voice}"${others.length ? `; ${others.join(', ')}` : ''}${missing.length ? `; no voice for ${missing.join(', ')}` : ''}`,
                hint: missing.length
                  ? 'Install voices for those languages (macOS: System Settings → Accessibility → Spoken Content; Linux: espeak-ng) or set OPENAI_API_KEY / ELEVENLABS_API_KEY.'
                  : undefined,
              }
            : {
                id: 'narration',
                status: 'warn',
                message: `No speech engine: ${tts.reason}`,
                hint: 'Videos will use captions only.',
              },
        );
        // Check writability without creating anything: test the nearest directory that exists.
        let probe = join(root, config.output.dir);
        while (!(await exists(probe)) && dirname(probe) !== probe) probe = dirname(probe);
        await access(probe, constants.W_OK).then(
          () =>
            checks.push({
              id: 'output',
              status: 'ok',
              message: `Runs are written to ${config.output.dir}`,
            }),
          () =>
            checks.push({
              id: 'output',
              status: 'fail',
              message: `${config.output.dir} cannot be created (${probe} is not writable)`,
            }),
        );
      } catch (error) {
        checks.push({ id: 'config', status: 'fail', message: (error as Error).message });
      }
    }
  }

  try {
    const media = await Media.locate();
    const h264 =
      (await media.hasEncoder('libx264')) || (await media.hasEncoder('h264_videotoolbox'));
    checks.push(
      h264
        ? { id: 'ffmpeg', status: 'ok', message: `ffmpeg with H.264 (${media.ffmpegPath})` }
        : {
            id: 'ffmpeg',
            status: 'warn',
            message: 'ffmpeg has no H.264 encoder; videos fall back to MPEG-4',
            hint: 'Install an ffmpeg build with libx264.',
          },
    );
  } catch (error) {
    checks.push({
      id: 'ffmpeg',
      status: 'warn',
      message: 'ffmpeg/ffprobe not found (needed for video only)',
      hint: (error as { hint?: string }).hint,
    });
  }

  checks.push(await browserCheck());
  return checks;
}

export async function browserCheck(): Promise<DoctorCheck> {
  try {
    const browser = await chromium.launch({ timeout: 20_000 });
    const version = browser.version();
    await browser.close();
    return { id: 'browser', status: 'ok', message: `Chromium ${version}` };
  } catch {
    return {
      id: 'browser',
      status: 'warn',
      message: 'Playwright Chromium is not installed (needed for demos and video)',
      hint: 'Run: covi doctor --install-browser',
    };
  }
}

/**
 * Installs the Chromium build that Covi's own Playwright expects, so the two always match (a
 * separately run `npx playwright` may be a different version). Progress goes to stderr.
 */
export async function installBrowser(options: { withDeps?: boolean } = {}): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  const args = [cli, 'install', ...(options.withDeps ? ['--with-deps'] : []), 'chromium'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 2, 2] });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
