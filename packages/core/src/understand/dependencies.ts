import type { DependencyChange } from '../model/context.ts';

type Deps = Map<string, { version: string; dev: boolean }>;

function parsePackageJson(text: string | undefined): Deps {
  const deps: Deps = new Map();
  if (!text) return deps;
  try {
    const json = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
    for (const [field, dev] of [
      ['dependencies', false],
      ['optionalDependencies', false],
      ['peerDependencies', false],
      ['devDependencies', true],
    ] as const) {
      for (const [name, version] of Object.entries(json[field] ?? {}))
        deps.set(name, { version: String(version), dev });
    }
  } catch {
    // Invalid JSON is reported by other tooling; treat as no dependencies.
  }
  return deps;
}

function parseRequirements(text: string | undefined, dev: boolean): Deps {
  const deps: Deps = new Map();
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.split('#')[0]!.trim();
    if (!line || line.startsWith('-')) continue;
    const m = /^([A-Za-z0-9_.\-[\]]+)\s*((?:==|>=|<=|~=|!=|>|<).*)?$/.exec(line);
    if (m)
      deps.set(m[1]!.toLowerCase().replace(/\[.*\]$/, ''), { version: (m[2] ?? '*').trim(), dev });
  }
  return deps;
}

function parsePyproject(text: string | undefined): Deps {
  const deps: Deps = new Map();
  if (!text) return deps;
  const block = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
  for (const m of (block?.[1] ?? '').matchAll(/["']([A-Za-z0-9_.-]+)\s*([^"']*)["']/g)) {
    deps.set(m[1]!.toLowerCase(), { version: m[2]?.trim() || '*', dev: false });
  }
  return deps;
}

function parseGoMod(text: string | undefined): Deps {
  const deps: Deps = new Map();
  if (!text) return deps;
  for (const m of text.matchAll(
    /^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v[\w.\-+]+)(\s*\/\/\s*indirect)?/gm,
  )) {
    deps.set(m[1]!, { version: m[2]!, dev: Boolean(m[3]) });
  }
  return deps;
}

function parseCargo(text: string | undefined): Deps {
  const deps: Deps = new Map();
  if (!text) return deps;
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!;
      continue;
    }
    if (!/dependencies$/.test(section)) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/.exec(line);
    if (m) deps.set(m[1]!, { version: m[2] ?? m[3] ?? '*', dev: section.includes('dev') });
  }
  return deps;
}

function parseGemfile(text: string | undefined): Deps {
  const deps: Deps = new Map();
  for (const m of (text ?? '').matchAll(
    /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm,
  )) {
    deps.set(m[1]!, { version: m[2] ?? '*', dev: false });
  }
  return deps;
}

const PARSERS: Record<
  string,
  { ecosystem: DependencyChange['ecosystem']; parse: (t: string | undefined) => Deps }
> = {
  'package.json': { ecosystem: 'npm', parse: parsePackageJson },
  'requirements.txt': { ecosystem: 'pypi', parse: (t) => parseRequirements(t, false) },
  'requirements-dev.txt': { ecosystem: 'pypi', parse: (t) => parseRequirements(t, true) },
  'pyproject.toml': { ecosystem: 'pypi', parse: parsePyproject },
  'go.mod': { ecosystem: 'go', parse: parseGoMod },
  'Cargo.toml': { ecosystem: 'cargo', parse: parseCargo },
  Gemfile: { ecosystem: 'rubygems', parse: parseGemfile },
};

export function isDependencyManifest(path: string): boolean {
  return (path.split('/').pop() ?? '') in PARSERS;
}

function majorOf(version: string): number | undefined {
  const m = /(\d+)(?:\.(\d+))?/.exec(version.replace(/^v/, ''));
  if (!m) return undefined;
  const major = Number(m[1]);
  // 0.x releases treat the minor version as breaking.
  return major === 0 && m[2] !== undefined ? Number(m[2]) / 1000 : major;
}

function compareVersions(a: string, b: string): number {
  const pa = (a.match(/\d+/g) ?? []).map(Number);
  const pb = (b.match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function diffManifest(
  path: string,
  before: string | undefined,
  after: string | undefined,
): DependencyChange[] {
  const parser = PARSERS[path.split('/').pop() ?? ''];
  if (!parser) return [];
  const a = parser.parse(before);
  const b = parser.parse(after);
  const out: DependencyChange[] = [];
  for (const [name, next] of b) {
    const prev = a.get(name);
    if (!prev) {
      out.push({
        name,
        manifest: path,
        ecosystem: parser.ecosystem,
        change: 'added',
        to: next.version,
        major: false,
        dev: next.dev,
      });
    } else if (prev.version !== next.version) {
      const direction = compareVersions(next.version, prev.version);
      const ma = majorOf(prev.version);
      const mb = majorOf(next.version);
      out.push({
        name,
        manifest: path,
        ecosystem: parser.ecosystem,
        change: direction > 0 ? 'upgraded' : direction < 0 ? 'downgraded' : 'changed',
        from: prev.version,
        to: next.version,
        major: ma !== undefined && mb !== undefined && ma !== mb,
        dev: next.dev,
      });
    }
  }
  for (const [name, prev] of a) {
    if (!b.has(name)) {
      out.push({
        name,
        manifest: path,
        ecosystem: parser.ecosystem,
        change: 'removed',
        from: prev.version,
        major: false,
        dev: prev.dev,
      });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
