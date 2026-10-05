import { findSecrets, mask } from '../../security/redact.ts';
import { addedLines, isAppCode, quote, type Rule } from './types.ts';

export const secretInDiff: Rule = {
  id: 'secret-in-diff',
  checks: 'credentials or private keys added to the repository',
  run({ files }) {
    const out = [];
    for (const { file, line } of addedLines(files)) {
      for (const hit of findSecrets(line.text)) {
        out.push({
          title: `${hit.pattern.label} committed in ${file.path}`,
          certainty: 'confirmed' as const,
          severity: 'high' as const,
          category: 'security' as const,
          location: { path: file.path, line: line.newLine },
          evidence: `Added line contains a value matching the ${hit.pattern.label} format: ${mask(hit.match, hit.pattern.keepPrefix)}`,
          explanation:
            'Anything committed is readable by everyone with repository access and stays in git history even after it is deleted.',
          suggestion:
            'Revoke and rotate the credential now, then load it from a secret store or environment variable.',
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
  run({ files }) {
    const out = [];
    for (const file of files) {
      const lines = addedLines([file]);
      const opening = lines.find(({ line }) => /^<{7}( |$)/.test(line.text));
      const closing = lines.find(({ line }) => /^>{7}( |$)/.test(line.text));
      const marker = opening ?? closing;
      if (!marker) continue;
      out.push({
        title: `Unresolved merge conflict in ${file.path}`,
        certainty: 'confirmed' as const,
        severity: 'high' as const,
        category: 'correctness' as const,
        location: { path: file.path, line: marker.line.newLine },
        evidence: `Conflict marker added: ${quote(marker.line.text)}`,
        explanation:
          'The file contains both sides of a conflict and will not parse or behave as intended.',
        suggestion: 'Resolve the conflict and remove the <<<<<<< / ======= / >>>>>>> markers.',
      });
    }
    return out;
  },
};

export const focusedTest: Rule = {
  id: 'focused-test',
  checks: 'focused tests (.only) that silently skip the rest of the suite',
  run({ files }) {
    const out = [];
    for (const { file, line } of addedLines(files, (f) => f.category === 'test')) {
      if (
        /\b(describe|it|test|context|suite|specify)\.only\s*\(|\b(fdescribe|fit)\s*\(/.test(
          line.text,
        )
      ) {
        out.push({
          title: `Focused test left in ${file.path}`,
          certainty: 'confirmed' as const,
          severity: 'medium' as const,
          category: 'testing' as const,
          location: { path: file.path, line: line.newLine },
          evidence: quote(line.text),
          explanation:
            'A focused test makes the runner skip every other test in its scope, so CI can pass without running them.',
          suggestion: 'Remove `.only` before merging.',
        });
      }
    }
    return out;
  },
};

export const skippedTest: Rule = {
  id: 'skipped-test',
  checks: 'tests that are newly skipped or disabled',
  run({ files }) {
    const hits = addedLines(files, (f) => f.category === 'test').filter(({ line }) =>
      /\b(describe|it|test|context)\.skip\s*\(|\b(xit|xdescribe|xtest)\s*\(|@pytest\.mark\.skip|\bt\.Skip\(|@Disabled\b|@Ignore\b|\bpending\(/.test(
        line.text,
      ),
    );
    if (hits.length === 0) return [];
    const first = hits[0]!;
    return [
      {
        title:
          hits.length === 1 ? `Test skipped in ${first.file.path}` : `${hits.length} tests skipped`,
        certainty: 'risk' as const,
        severity: 'low' as const,
        category: 'testing' as const,
        location: { path: first.file.path, line: first.line.newLine },
        evidence: hits
          .slice(0, 3)
          .map(({ file, line }) => `${file.path}:${line.newLine}: ${quote(line.text, 100)}`)
          .join('\n'),
        explanation:
          'Skipped tests stop protecting the behavior they cover. That can be intentional, but it should be deliberate.',
        suggestion: 'Confirm the skip is intended and track re-enabling it.',
      },
    ];
  },
};

export const debugLeftover: Rule = {
  id: 'debug-leftover',
  checks: 'debugger statements and breakpoints left in application code',
  run({ files }) {
    const out = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      if (/^\s*(\/\/|#)/.test(line.text)) continue;
      if (
        /(^|[^\w.])debugger\s*;?\s*$|\bbreakpoint\(\)|\b(i?pdb)\.set_trace\(|\bbinding\.(pry|irb)\b|^\s*byebug\b|\bdbg!\(/.test(
          line.text,
        )
      ) {
        out.push({
          title: `Debugger breakpoint left in ${file.path}`,
          certainty: 'likely' as const,
          severity: 'low' as const,
          category: 'maintainability' as const,
          location: { path: file.path, line: line.newLine },
          evidence: quote(line.text),
          explanation:
            'Breakpoints pause execution when developer tools or a debugger are attached and are almost never meant to ship.',
          suggestion: 'Remove the breakpoint.',
        });
      }
    }
    return out.slice(0, 3);
  },
};
