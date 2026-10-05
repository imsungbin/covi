import { SECRET_ENV_NAME } from './redact.ts';

/**
 * Builds the environment for project-defined commands (app servers, tests, demo commands).
 * Repositories are untrusted input: their commands get a minimal allowlisted environment so
 * CI tokens, API keys, and cloud credentials in Covi's own environment are never inherited.
 */
const SAFE_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TERM',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'CI',
  'NO_COLOR',
  'COLORTERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'PLAYWRIGHT_BROWSERS_PATH',
  'NODE_OPTIONS',
  'NVM_DIR',
  'NVM_BIN',
  'VOLTA_HOME',
  'PNPM_HOME',
  'COREPACK_HOME',
  'BUN_INSTALL',
  'GOPATH',
  'GOROOT',
  'GOCACHE',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'VIRTUAL_ENV',
  'JAVA_HOME',
  // Windows essentials.
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'ProgramFiles',
  'ProgramData',
]);
const SAFE_PREFIXES = ['LC_', 'XDG_', 'npm_config_cache'];

export interface ChildEnvOptions {
  /** Extra variables from configuration (`app.env`). Values are literal, never secrets. */
  extra?: Record<string, string>;
  /** Names the user explicitly allows to pass through from Covi's environment (`app.passEnv`). */
  passThrough?: readonly string[];
  source?: NodeJS.ProcessEnv;
}

export function childEnv(options: ChildEnvOptions = {}): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const safe = SAFE_NAMES.has(name) || SAFE_PREFIXES.some((p) => name.startsWith(p));
    if (safe && !SECRET_ENV_NAME.test(name)) env[name] = value;
  }
  for (const name of options.passThrough ?? []) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(options.extra ?? {})) env[name] = String(value);
  // Tooling that would otherwise prompt or open browsers must stay non-interactive.
  env.CI ??= '1';
  env.BROWSER = 'none';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}
