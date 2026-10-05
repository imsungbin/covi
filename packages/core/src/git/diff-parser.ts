import type { DiffLine, FileStatus, Hunk } from '../model/change.ts';

export interface ParsedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  oldMode?: string;
  newMode?: string;
  similarity?: number;
}

interface Draft {
  header: string;
  oldPath?: string;
  newPath?: string;
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  added: boolean;
  deleted: boolean;
  binary: boolean;
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  hunks: Hunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Parses `git diff` unified output (with a/ b/ prefixes) into files and hunks.
 * Handles renames, copies, mode changes, binary files, quoted paths, and missing newlines.
 */
export function parseDiff(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();

  let draft: Draft | undefined;
  let hunk: Hunk | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let last: DiffLine | undefined;

  const finish = () => {
    if (draft) files.push(finalize(draft));
    draft = undefined;
    hunk = undefined;
    last = undefined;
  };

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const tag = line[0];
      if (tag === ' ' || line === '') {
        last = { kind: 'context', text: line.slice(1), oldLine: oldNo++, newLine: newNo++ };
        oldLeft--;
        newLeft--;
        hunk.lines.push(last);
        continue;
      }
      if (tag === '-') {
        last = { kind: 'del', text: line.slice(1), oldLine: oldNo++ };
        oldLeft--;
        hunk.lines.push(last);
        continue;
      }
      if (tag === '+') {
        last = { kind: 'add', text: line.slice(1), newLine: newNo++ };
        newLeft--;
        hunk.lines.push(last);
        continue;
      }
      if (tag === '\\') {
        if (last) last.noNewline = true;
        continue;
      }
      // Malformed or truncated hunk: fall through to header handling.
      hunk = undefined;
    }

    if (line.startsWith('\\')) {
      if (last) last.noNewline = true;
      continue;
    }

    if (line.startsWith('diff --git ')) {
      finish();
      draft = {
        header: line.slice('diff --git '.length),
        added: false,
        deleted: false,
        binary: false,
        hunks: [],
      };
      continue;
    }
    if (!draft) continue;

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      hunk = {
        oldStart: oldNo,
        oldLines: oldLeft,
        newStart: newNo,
        newLines: newLeft,
        section: header[5]?.trim() || undefined,
        lines: [],
      };
      draft.hunks.push(hunk);
      last = undefined;
      continue;
    }

    if (line.startsWith('--- ')) draft.oldPath = parsePathLine(line.slice(4), 'a/');
    else if (line.startsWith('+++ ')) draft.newPath = parsePathLine(line.slice(4), 'b/');
    else if (line.startsWith('new file mode ')) {
      draft.added = true;
      draft.newMode = line.slice('new file mode '.length);
    } else if (line.startsWith('deleted file mode ')) {
      draft.deleted = true;
      draft.oldMode = line.slice('deleted file mode '.length);
    } else if (line.startsWith('old mode ')) draft.oldMode = line.slice('old mode '.length);
    else if (line.startsWith('new mode ')) draft.newMode = line.slice('new mode '.length);
    else if (line.startsWith('rename from '))
      draft.renameFrom = unquote(line.slice('rename from '.length));
    else if (line.startsWith('rename to '))
      draft.renameTo = unquote(line.slice('rename to '.length));
    else if (line.startsWith('copy from '))
      draft.copyFrom = unquote(line.slice('copy from '.length));
    else if (line.startsWith('copy to ')) draft.copyTo = unquote(line.slice('copy to '.length));
    else if (line.startsWith('similarity index '))
      draft.similarity = Number.parseInt(line.slice(17), 10);
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') draft.binary = true;
  }
  finish();
  return files;
}

function finalize(d: Draft): ParsedFile {
  const fromHeader = parseHeaderPaths(d.header);
  const oldPath = d.renameFrom ?? d.copyFrom ?? d.oldPath ?? fromHeader?.[0];
  const newPath = d.renameTo ?? d.copyTo ?? d.newPath ?? fromHeader?.[1];

  let status: FileStatus = 'modified';
  if (d.added) status = 'added';
  else if (d.deleted) status = 'deleted';
  else if (d.renameFrom) status = 'renamed';
  else if (d.copyFrom) status = 'copied';
  else if (d.oldMode && d.newMode && fileType(d.oldMode) !== fileType(d.newMode))
    status = 'type-changed';

  const path = (status === 'deleted' ? (oldPath ?? newPath) : (newPath ?? oldPath)) ?? '';
  let additions = 0;
  let deletions = 0;
  for (const h of d.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') additions++;
      else if (l.kind === 'del') deletions++;
    }
  }
  const file: ParsedFile = { path, status, binary: d.binary, additions, deletions, hunks: d.hunks };
  if ((status === 'renamed' || status === 'copied') && oldPath && oldPath !== path)
    file.oldPath = oldPath;
  if (d.oldMode) file.oldMode = d.oldMode;
  if (d.newMode) file.newMode = d.newMode;
  if (d.similarity !== undefined && !Number.isNaN(d.similarity)) file.similarity = d.similarity;
  return file;
}

function fileType(mode: string): string {
  return mode.slice(0, 2);
}

function parsePathLine(value: string, prefix: string): string | undefined {
  let v = value;
  // Git appends a tab after names that contain spaces.
  if (v.endsWith('\t')) v = v.slice(0, -1);
  if (v === '/dev/null') return undefined;
  v = unquote(v);
  return v.startsWith(prefix) ? v.slice(prefix.length) : v;
}

/** Extracts old/new paths from the `diff --git` header when no other lines name them. */
function parseHeaderPaths(header: string): [string, string] | undefined {
  if (header.startsWith('"')) {
    const [first, rest] = readQuoted(header);
    const second = rest.trimStart();
    const secondPath = second.startsWith('"') ? readQuoted(second)[0] : second;
    return [stripPrefix(first, 'a/'), stripPrefix(secondPath, 'b/')];
  }
  if (!header.startsWith('a/')) return undefined;
  const quotedSecond = header.indexOf(' "b/');
  if (quotedSecond !== -1) {
    return [
      stripPrefix(header.slice(0, quotedSecond), 'a/'),
      stripPrefix(readQuoted(header.slice(quotedSecond + 1))[0], 'b/'),
    ];
  }
  // Unquoted paths may contain spaces: prefer the split where both sides are identical.
  let fallback: [string, string] | undefined;
  for (let i = header.indexOf(' b/'); i !== -1; i = header.indexOf(' b/', i + 1)) {
    const left = header.slice(2, i);
    const right = header.slice(i + 3);
    if (left === right) return [left, right];
    fallback ??= [left, right];
  }
  return fallback;
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Decodes git's C-style quoted paths, including octal-escaped UTF-8 bytes. */
export function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  return readQuoted(value)[0];
}

function readQuoted(value: string): [string, string] {
  const bytes: number[] = [];
  let i = 1;
  const pushText = (text: string) => {
    for (const b of Buffer.from(text, 'utf8')) bytes.push(b);
  };
  while (i < value.length) {
    const c = value[i]!;
    if (c === '"') {
      i++;
      break;
    }
    if (c === '\\') {
      const next = value[i + 1] ?? '';
      if (/[0-7]/.test(next)) {
        const octal = value.slice(i + 1, i + 4);
        bytes.push(Number.parseInt(octal, 8));
        i += 4;
        continue;
      }
      const map: Record<string, string> = {
        a: '\x07',
        b: '\b',
        t: '\t',
        n: '\n',
        v: '\v',
        f: '\f',
        r: '\r',
        '"': '"',
        '\\': '\\',
      };
      pushText(map[next] ?? next);
      i += 2;
      continue;
    }
    pushText(c);
    i++;
  }
  return [Buffer.from(bytes).toString('utf8'), value.slice(i)];
}
