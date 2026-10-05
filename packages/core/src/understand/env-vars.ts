/** Environment variable references across common languages. */
const ENV_PATTERNS: RegExp[] = [
  /process\.env\.([A-Z][A-Z0-9_]{1,})/g,
  /process\.env\[\s*['"`]([A-Z][A-Z0-9_]{1,})['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]{1,})/g,
  /Deno\.env\.get\(\s*['"`]([A-Z][A-Z0-9_]{1,})['"`]/g,
  /os\.environ(?:\.get)?\(?\s*\[?\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{1,})"/g,
  /ENV(?:\.fetch\(\s*|\[\s*)['"]([A-Z][A-Z0-9_]{1,})['"]/g,
  /env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]{1,})"/g,
  /System\.getenv\(\s*"([A-Z][A-Z0-9_]{1,})"/g,
];

/** Variables every platform provides; never worth flagging. */
const WELL_KNOWN = new Set([
  'NODE_ENV',
  'HOME',
  'PATH',
  'PORT',
  'HOST',
  'CI',
  'DEBUG',
  'TZ',
  'LANG',
  'PWD',
  'USER',
  'SHELL',
  'TERM',
]);

export function extractEnvVars(text: string): string[] {
  const names = new Set<string>();
  for (const pattern of ENV_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const name = m[1]!;
      if (!WELL_KNOWN.has(name)) names.add(name);
    }
  }
  return [...names];
}

/** Where a newly required variable would normally be documented. */
export const ENV_DOC_PATHSPECS = [
  ':(glob)**/.env*',
  ':(glob)**/*.env',
  ':(glob)**/*.example',
  ':(glob)**/*.sample',
  ':(glob)**/*.md',
  ':(glob)**/*.mdx',
  ':(glob)**/*.yml',
  ':(glob)**/*.yaml',
  ':(glob)**/*.toml',
  ':(glob)**/Dockerfile*',
  ':(glob)**/docker-compose*',
];
