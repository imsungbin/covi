import type { FindingInput } from '../../model/finding.ts';
import { addedLines, isAppCode, quote, type Rule } from './types.ts';

const SANITIZER = /\b(DOMPurify|sanitize\w*|escapeHtml|escape_html|bleach\.clean|xss\(|purify)\b/i;

export const dangerousHtml: Rule = {
  id: 'dangerous-html',
  checks: 'raw HTML injection points (innerHTML, dangerouslySetInnerHTML, v-html)',
  async run({ files, reader }) {
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      const m =
        /dangerouslySetInnerHTML|\.(?:inner|outer)HTML\s*=(?!=)|insertAdjacentHTML\s*\(|\bv-html\s*=|\{@html\s|document\.write\s*\(|\bmark_safe\s*\(|\|\s*safe\b/.exec(
          line.text,
        );
      if (!m || SANITIZER.test(line.text)) continue;
      // Constant markup (no interpolation) cannot carry injected content.
      if (/\.(inner|outer)HTML\s*=\s*(?:'[^'\\]*'|"[^"\\]*"|`[^`$\\]*`)\s*;?\s*$/.test(line.text))
        continue;
      const content = await reader.readOne('head', file.path);
      if (content && SANITIZER.test(content)) continue;
      out.push({
        title: `Unsanitized HTML rendering in ${file.path}`,
        certainty: 'risk',
        severity: 'medium',
        category: 'security',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation: `${m[0].trim()} renders markup as HTML. If any part of it comes from users or external data, this is a cross-site scripting vector.`,
        suggestion:
          'Render text instead of HTML, or sanitize the markup (for example with DOMPurify) before inserting it.',
      });
      if (out.length >= 3) break;
    }
    return out;
  },
};

export const dynamicCodeExecution: Rule = {
  id: 'dynamic-code-execution',
  checks: 'eval and dynamically constructed code',
  run({ files }) {
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      if (/^\s*(\/\/|#|\*)/.test(line.text)) continue;
      const js =
        file.language === 'javascript' ||
        file.language === 'typescript' ||
        file.category === 'markup';
      const hit = js
        ? /(^|[^\w.])eval\s*\(|new\s+Function\s*\(/.exec(line.text)
        : file.language === 'python'
          ? /(^|[^\w.])(eval|exec)\s*\(/.exec(line.text)
          : null;
      if (!hit) continue;
      out.push({
        title: `Dynamic code execution in ${file.path}`,
        certainty: 'likely',
        severity: 'medium',
        category: 'security',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation:
          'Evaluating strings as code executes whatever reaches it, defeats static analysis, and is rarely necessary.',
        suggestion: 'Replace with explicit parsing or a lookup table.',
      });
    }
    return out.slice(0, 2);
  },
};

const SQL = '(?:SELECT|INSERT|UPDATE|DELETE|WHERE|VALUES)';
const SQL_PATTERNS = [
  new RegExp(
    `\\b(?:query|execute|exec|raw|prepare|run|all|get)\\s*\\(\\s*\`[^\`]*\\b${SQL}\\b[^\`]*\\$\\{`,
    'i',
  ),
  new RegExp(
    `\\b(?:query|execute|exec|raw)\\s*\\(\\s*(['"])[^'"]*\\b${SQL}\\b[^'"]*\\1\\s*\\+`,
    'i',
  ),
  new RegExp(`\\.(?:execute|executemany|raw)\\(\\s*f(['"])[^'"]*\\b${SQL}\\b`, 'i'),
  new RegExp(
    `\\.(?:execute|executemany)\\(\\s*(['"])[^'"]*\\b${SQL}\\b[^'"]*\\1\\s*(%|\\.format\\()`,
    'i',
  ),
  /\.(?:Query|Exec|QueryRow)(?:Context)?\(\s*(?:ctx,\s*)?fmt\.Sprintf\(/,
];

export const sqlStringBuilding: Rule = {
  id: 'sql-string-building',
  checks: 'SQL built by string interpolation instead of parameters',
  run({ files }) {
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files, isAppCode)) {
      if (!SQL_PATTERNS.some((re) => re.test(line.text))) continue;
      out.push({
        title: `SQL built from interpolated values in ${file.path}`,
        certainty: 'likely',
        severity: 'high',
        category: 'security',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation:
          'Interpolating values into SQL text allows SQL injection whenever any value can be influenced by a user.',
        suggestion: 'Use parameterized queries (placeholders with bound values).',
      });
    }
    return out.slice(0, 3);
  },
};

const UNTRUSTED_EXPR =
  /\$\{\{\s*(github\.event\.(pull_request\.(title|body|head\.ref|head\.label)|issue\.(title|body)|comment\.body|review\.body|review_comment\.body|head_commit\.(message|author\.(name|email))|commits\[?.*\]?\.message|pages.*page_name|discussion\.(title|body))|github\.head_ref)\s*\}\}/;

function isWorkflow(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

/** Line numbers that belong to `run:` (or github-script `script:`) blocks in a workflow file. */
export function scriptLines(content: string): Set<number> {
  const lines = content.split('\n');
  const out = new Set<number>();
  let blockIndent = -1;
  lines.forEach((text, i) => {
    const indent = text.length - text.trimStart().length;
    if (blockIndent >= 0) {
      if (text.trim() === '' || indent > blockIndent) {
        out.add(i + 1);
        return;
      }
      blockIndent = -1;
    }
    const m = /^(\s*)(?:-\s+)?(run|script):\s*(.*)$/.exec(text);
    if (m) {
      out.add(i + 1);
      const rest = m[3]!.trim();
      if (rest === '' || /^[|>][-+]?\d?$/.test(rest))
        blockIndent = indent + (text.trimStart().startsWith('-') ? 2 : 0);
    }
  });
  return out;
}

export const workflowScriptInjection: Rule = {
  id: 'workflow-script-injection',
  checks: 'GitHub Actions scripts that interpolate untrusted event data',
  async run({ files, reader }) {
    const out: FindingInput[] = [];
    for (const file of files.filter((f) => isWorkflow(f.path) && f.status !== 'deleted')) {
      const content = await reader.readOne('head', file.path);
      if (!content) continue;
      const scripts = scriptLines(content);
      for (const { line } of addedLines([file])) {
        const m = UNTRUSTED_EXPR.exec(line.text);
        if (!m || !scripts.has(line.newLine ?? -1)) continue;
        out.push({
          title: `Script injection via ${m[1]} in ${file.path}`,
          certainty: 'likely',
          severity: 'high',
          category: 'security',
          location: { path: file.path, line: line.newLine },
          evidence: quote(line.text),
          explanation: `${m[0]} is attacker-controlled and is substituted into the shell script before it runs, so a crafted title or branch name executes commands in the workflow.`,
          suggestion:
            'Pass the value through an environment variable (env: TITLE: ${{ ... }}) and reference "$TITLE" in the script.',
        });
      }
    }
    return out;
  },
};

export const workflowPullRequestTarget: Rule = {
  id: 'workflow-pull-request-target',
  checks: 'pull_request_target workflows that check out untrusted pull request code',
  async run({ files, reader }) {
    const out: FindingInput[] = [];
    for (const file of files.filter((f) => isWorkflow(f.path) && f.status !== 'deleted')) {
      const content = await reader.readOne('head', file.path);
      if (!content || !/\bpull_request_target\b/.test(content)) continue;
      const lines = content.split('\n');
      const index = lines.findIndex((l) =>
        /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)\s*\}\}|refs\/pull\/|github\.head_ref/.test(
          l,
        ),
      );
      if (index === -1) continue;
      const lineNo = index + 1;
      const touched = file.hunks.some((h) =>
        h.lines.some(
          (l) => l.kind === 'add' && (l.newLine === lineNo || /pull_request_target/.test(l.text)),
        ),
      );
      if (!touched) continue;
      out.push({
        title: `pull_request_target workflow checks out pull request code in ${file.path}`,
        certainty: 'likely',
        severity: 'high',
        category: 'security',
        location: { path: file.path, line: lineNo },
        evidence: quote(lines[index]!),
        explanation:
          'pull_request_target runs with a write token and repository secrets. Checking out and running code from the pull request lets any fork execute code with those privileges.',
        suggestion:
          'Use the pull_request trigger for jobs that run PR code, and a separate workflow_run job (without checkout of PR code) for privileged steps like commenting.',
      });
    }
    return out;
  },
};

export const workflowBroadPermissions: Rule = {
  id: 'workflow-broad-permissions',
  checks: 'workflow token permissions broadened to write-all',
  run({ files }) {
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files, (f) => isWorkflow(f.path))) {
      if (!/^\s*permissions:\s*write-all\s*$/.test(line.text)) continue;
      out.push({
        title: `Workflow grants write-all token permissions in ${file.path}`,
        certainty: 'risk',
        severity: 'medium',
        category: 'permissions',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation:
          'Every step, including third-party actions, receives a token that can push code, edit releases, and change settings.',
        suggestion:
          'Grant only the scopes the job needs (for example contents: read, pull-requests: write).',
      });
    }
    return out;
  },
};
