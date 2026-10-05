import { hasMessage } from '../../i18n/catalog.ts';
import { findSecrets, mask } from '../../security/redact.ts';
import { addedLines, isAppCode, messages, quote, type Rule } from './types.ts';

export const secretInDiff: Rule = {
  id: 'secret-in-diff',
  checks: 'credentials or private keys added to the repository',
  run({ files, language }) {
    const say = messages(language, 'secret-in-diff');
    const out = [];
    for (const { file, line } of addedLines(files)) {
      for (const hit of findSecrets(line.text)) {
        // Product names (GitHub token, OpenAI API key) stay as they are; generic ones translate.
        const label = hasMessage(language ?? 'en', `rule.secret-in-diff.label.${hit.pattern.id}`)
          ? say(`label.${hit.pattern.id}`)
          : hit.pattern.label;
        out.push({
          title: say('title', { label, path: file.path }),
          certainty: 'confirmed' as const,
          severity: 'high' as const,
          category: 'security' as const,
          location: { path: file.path, line: line.newLine },
          evidence: say('evidence', {
            label,
            value: mask(hit.match, hit.pattern.keepPrefix),
          }),
          explanation: say('explanation'),
          suggestion: say('suggestion'),
        });
        break;
      }
    }
    return out;
  },
};

export const mergeConflictMarkers: Rule = {
  id: 'merge-conflict-markers',
  checks: 'leftover merge conflict markers',
  run({ files, language }) {
    const say = messages(language, 'merge-conflict-markers');
    const out = [];
    for (const file of files) {
      const lines = addedLines([file]);
      const opening = lines.find(({ line }) => /^<{7}( |$)/.test(line.text));
      const closing = lines.find(({ line }) => /^>{7}( |$)/.test(line.text));
      const marker = opening ?? closing;
      if (!marker) continue;
      out.push({
        title: say('title', { path: file.path }),
        certainty: 'confirmed' as const,
        severity: 'high' as const,
        category: 'correctness' as const,
        location: { path: file.path, line: marker.line.newLine },
        evidence: say('evidence', { line: quote(marker.line.text) }),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      });
    }
    return out;
  },
};

export const focusedTest: Rule = {
  id: 'focused-test',
  checks: 'focused tests (.only) that silently skip the rest of the suite',
  run({ files, language }) {
    const say = messages(language, 'focused-test');
    const out = [];
    for (const { file, line } of addedLines(files, (f) => f.category === 'test')) {
      if (
        inCode(
          line.text,
          /\b(describe|it|test|context|suite|specify)\.only\s*\(|\b(fdescribe|fit)\s*\(/g,
        )
      ) {
        out.push({
          title: say('title', { path: file.path }),
          certainty: 'confirmed' as const,
          severity: 'medium' as const,
          category: 'testing' as const,
          location: { path: file.path, line: line.newLine },
          evidence: quote(line.text),
          explanation: say('explanation'),
          suggestion: say('suggestion'),
        });
      }
    }
    return out;
  },
};

/**
 * Whether `pattern` (global) matches outside string literals on this line. Test files often hold
 * code as fixtures ("it.only(...)" in a string); those are data, not focused tests.
 */
function inCode(text: string, pattern: RegExp): boolean {
  for (const m of text.matchAll(pattern)) if (!inString(text, m.index)) return true;
  return false;
}

function inString(text: string, at: number): boolean {
  let quote: string | undefined;
  for (let i = 0; i < at; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
  }
  return quote !== undefined;
}

export const skippedTest: Rule = {
  id: 'skipped-test',
  checks: 'tests that are newly skipped or disabled',
  run({ files, language }) {
    const say = messages(language, 'skipped-test');
    const hits = addedLines(files, (f) => f.category === 'test').filter(({ line }) =>
      inCode(
        line.text,
        /\b(describe|it|test|context)\.skip\s*\(|\b(xit|xdescribe|xtest)\s*\(|@pytest\.mark\.skip|\bt\.Skip\(|@Disabled\b|@Ignore\b|\bpending\(/g,
      ),
    );
    if (hits.length === 0) return [];
    const first = hits[0]!;
    return [
      {
        title:
          hits.length === 1
            ? say('title', { path: first.file.path })
            : say('titleMany', { count: hits.length }),
        certainty: 'risk' as const,
        severity: 'low' as const,
        category: 'testing' as const,
        location: { path: first.file.path, line: first.line.newLine },
        evidence: hits
          .slice(0, 3)
          .map(({ file, line }) => `${file.path}:${line.newLine}: ${quote(line.text, 100)}`)
          .join('\n'),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      },
    ];
  },
};

export const debugLeftover: Rule = {
  id: 'debug-leftover',
  checks: 'debugger statements and breakpoints left in application code',
  run({ files, language }) {
    const say = messages(language, 'debug-leftover');
    const out = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      if (/^\s*(\/\/|#)/.test(line.text)) continue;
      if (
        /(^|[^\w.])debugger\s*;?\s*$|\bbreakpoint\(\)|\b(i?pdb)\.set_trace\(|\bbinding\.(pry|irb)\b|^\s*byebug\b|\bdbg!\(/.test(
          line.text,
        )
      ) {
        out.push({
          title: say('title', { path: file.path }),
          certainty: 'likely' as const,
          severity: 'low' as const,
          category: 'maintainability' as const,
          location: { path: file.path, line: line.newLine },
          evidence: quote(line.text),
          explanation: say('explanation'),
          suggestion: say('suggestion'),
        });
      }
    }
    return out.slice(0, 3);
  },
};
