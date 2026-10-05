import type { FindingInput } from '../../model/finding.ts';
import { addedLines, messages, quote, type Rule } from './types.ts';

const MARKUP = (path: string) =>
  /\.(html?|jsx|tsx|vue|svelte|astro|hbs|ejs|erb|njk|twig|liquid)$/.test(path);

export const imgMissingAlt: Rule = {
  id: 'img-missing-alt',
  checks: 'images without alternative text',
  run({ files, language }) {
    const say = messages(language, 'img-missing-alt');
    const out: FindingInput[] = [];
    for (const file of files.filter((f) => MARKUP(f.path) && f.category !== 'test')) {
      const lines = addedLines([file]);
      lines.forEach(({ line }, i) => {
        if (!/<img\b/i.test(line.text)) return;
        // Collect the whole tag, which may span several added lines.
        let tag = line.text.slice(line.text.search(/<img\b/i));
        for (let j = i + 1; !/>/.test(tag) && j < lines.length && j < i + 8; j++)
          tag += ` ${lines[j]!.line.text}`;
        tag = tag.slice(0, tag.indexOf('>') + 1 || undefined);
        if (/\balt\s*=|\{\s*\.\.\.|v-bind\s*=|:alt\s*=/i.test(tag)) return;
        out.push({
          title: say('title', { path: file.path }),
          certainty: 'likely',
          severity: 'medium',
          category: 'accessibility',
          location: { path: file.path, line: line.newLine },
          evidence: quote(tag),
          explanation: say('explanation'),
          suggestion: say('suggestion'),
        });
      });
    }
    return out.slice(0, 3);
  },
};

export const focusOutlineRemoved: Rule = {
  id: 'focus-outline-removed',
  checks: 'focus indicators removed without a visible replacement',
  async run({ files, reader, language }) {
    const say = messages(language, 'focus-outline-removed');
    const out: FindingInput[] = [];
    for (const file of files.filter(
      (f) => f.category === 'style' || /\.(html?|vue|svelte|astro)$/.test(f.path),
    )) {
      const hit = addedLines([file]).find(({ line }) =>
        /\boutline(-width)?\s*:\s*(none|0(px)?)\s*(!important)?\s*;?/.test(line.text),
      );
      if (!hit) continue;
      const content = (await reader.readOne('head', file.path)) ?? '';
      if (
        /:focus-visible/.test(content) ||
        /:focus[^{]*\{[^}]*(box-shadow|outline\s*:(?!\s*(?:none|0)\b)[^;]+;|border)/.test(content)
      )
        continue;
      out.push({
        title: say('title', { path: file.path }),
        certainty: 'likely',
        severity: 'medium',
        category: 'accessibility',
        location: { path: file.path, line: hit.line.newLine },
        evidence: quote(hit.line.text),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      });
    }
    return out;
  },
};

export const clickOnStaticElement: Rule = {
  id: 'click-on-static-element',
  checks: 'click handlers on non-interactive elements without keyboard support',
  run({ files, language }) {
    const say = messages(language, 'click-on-static-element');
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(
      files,
      (f) => MARKUP(f.path) && f.category !== 'test',
    )) {
      const m =
        /<(div|span|li|td|img|section|article)\b[^>]*\s(onClick|@click|on:click|v-on:click|\(click\))\s*=/i.exec(
          line.text,
        );
      if (!m) continue;
      if (
        /\brole\s*=|\btabIndex\s*=|\btabindex\s*=|onKey(Down|Up|Press)\s*=|@keydown|on:keydown/i.test(
          line.text,
        )
      )
        continue;
      out.push({
        title: say('title', { tag: m[1]!, path: file.path }),
        certainty: 'likely',
        severity: 'medium',
        category: 'accessibility',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation: say('explanation', { tag: m[1]! }),
        suggestion: say('suggestion'),
      });
    }
    return out.slice(0, 3);
  },
};
