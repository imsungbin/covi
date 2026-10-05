/**
 * Minimal gitignore-flavoured glob matching for path filters in configuration.
 * Supports `**`, `*`, `?`, `{a,b}` and character classes. Patterns without a slash
 * match against any path segment suffix (like .gitignore), so `*.snap` matches `a/b/c.snap`.
 */
const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let p = pattern.trim();
  const anchored = p.startsWith('/') || p.replace(/\/$/, '').includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        const prevSlash = i === 0 || p[i - 1] === '/';
        const nextSlash = p[i + 2] === '/' || i + 2 === p.length;
        if (prevSlash && nextSlash) {
          re += p[i + 2] === '/' ? '(?:.*/)?' : '.*';
          i += p[i + 2] === '/' ? 2 : 1;
          continue;
        }
        re += '.*';
        i++;
        continue;
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      const options = p
        .slice(i + 1, end)
        .split(',')
        .map(escapeRegExp);
      re += `(?:${options.join('|')})`;
      i = end;
    } else if (c === '[') {
      const end = p.indexOf(']', i);
      if (end === -1) {
        re += '\\[';
        continue;
      }
      let cls = p.slice(i + 1, end);
      if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
      re += `[${cls.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else {
      re += escapeRegExp(c);
    }
  }
  // A directory pattern (or any pattern) also matches everything beneath it.
  const suffix = '(?:/.*)?';
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const regex = new RegExp(`${prefix}${re}${dirOnly ? '/.*' : suffix}$`);
  cache.set(pattern, regex);
  return regex;
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path.replace(/\\/g, '/'));
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
