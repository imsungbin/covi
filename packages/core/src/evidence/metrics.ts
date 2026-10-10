import { isMetricValue, METRIC_LIMITS } from '../model/evidence.ts';
import { UNPRINTABLE } from '../util/text.ts';

/*
 * Numbers measured in a run's own text: a demo command's output, a response body, the test run's
 * output. Pure and deterministic. Silence over noise: a line counts only when it is a name and a
 * number (and a unit) and nothing else, so versions, times, dates, addresses, and paths give
 * nothing, and a name that ends in an identifier word (`pid`, `port`, `request id`) gives nothing.
 */

/** One number read from one text. */
export interface MetricReading {
  /** Its slug, unique in its text: `request-bytes`, then `request-bytes-2` for a second one. */
  name: string;
  /** What the text called it, as printed: `request bytes`, or a JSON path, `data.total`. */
  label: string;
  value: number;
  unit?: string;
}

/** A metric of one source, its base and head readings paired by name. */
export interface PairedMetric {
  name: string;
  label: string;
  unit?: string;
  base?: number;
  head?: number;
}

/** A reading before it is named, with the words its name is made of. */
type Found = Omit<MetricReading, 'name'> & { words: string[] };

/** Digits, grouped by commas, underscores, or thin or no-break spaces (one kind throughout). */
const NUMBER = String.raw`[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:_\d{3})+|\d{1,3}(?:[\u00a0\u202f\u2009]\d{3})+|\d+)(?:\.\d+)?`;
const WHOLE_NUMBER = new RegExp(`^(?:${NUMBER})$`, 'u');
const UNIT = String.raw`%|\p{L}{1,8}`;
/**
 * A whole line that names one number: `request bytes: 70406`, `- Duration = 1.2 s`, `Coverage: 87%`.
 * A colon needs a space after it: `localhost:3000` and `src/app.ts:42` are not a name and a number.
 */
const LINE = new RegExp(
  String.raw`^(?:[-*•]\s+)?(\p{L}[\p{L}\p{N} _./()'-]{0,59}?)\s*(?:=|:(?=\s))\s*(${NUMBER})\s*(${UNIT})?$`,
  'u',
);
/** `key=value` pairs inside a line: `status=200 duration=12ms`. A comma before a digit is `1,5`. */
const PAIR = new RegExp(
  String.raw`(?<=^|[\s,;(\[{])([A-Za-z_][A-Za-z0-9_.-]{0,39})=(${NUMBER})(${UNIT})?(?=$|[\s;)\]}]|,(?!\d))`,
  'gu',
);
/** Terminal colors and cursor moves, which commands print around their numbers. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
/** One test at a time: the shared pattern is global, and a global `test` keeps its place. */
const HIDES_TEXT = new RegExp(UNPRINTABLE.source, 'u');
/** Words that name an identifier rather than a measurement; a pid differs between runs. */
const IDENTIFIERS = new Set([
  'pid',
  'ppid',
  'port',
  'id',
  'uid',
  'gid',
  'seed',
  'build',
  'commit',
  'hash',
  'line',
  'lineno',
  'col',
  'column',
  'offset',
  'version',
  'rev',
  'revision',
]);

/** A parsed number as a metric value: rounded to six decimals, undefined when out of bounds. */
function bounded(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const rounded = Number(value.toFixed(METRIC_LIMITS.decimals)) || 0;
  return isMetricValue(rounded) ? rounded : undefined;
}

/**
 * A number as printed (`70,406`, `−3.5`), as a metric value: separators dropped, rounded to six
 * decimals. Undefined for any other text, such as `''`, `1,5`, or `0x10`.
 */
export function metricValue(text: string): number | undefined {
  if (!WHOLE_NUMBER.test(text)) return undefined;
  return bounded(Number(text.replace(/[,_\u00a0\u202f\u2009]/g, '').replace('−', '-')));
}

/** Words apart as code writes them: `userId` is `user Id`, `HTTPStatus` is `HTTP Status`. */
const uncamel = (text: string) =>
  text.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');

/** Lowercase ASCII words, camelCase split: accents dropped, anything else a break. */
function wordsOf(text: string): string[] {
  return uncamel(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const slugOf = (words: readonly string[]) =>
  words.join('-').slice(0, METRIC_LIMITS.nameChars).replace(/-+$/, '');

/**
 * A metric's name for its id: lowercase ASCII letters and digits, dashes between words (`userId` is
 * `user-id`), at most 40 characters. Empty when the label has no ASCII letters or digits (a label
 * in another script); the label itself keeps what the text said.
 */
export function metricSlug(label: string): string {
  return slugOf(wordsOf(label));
}

const label = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, METRIC_LIMITS.labelChars).trimEnd();

/**
 * Keeps a reading unless its value is out of bounds or its name ends in an identifier word
 * (`request id`, not `build time`). Before the cap, so identifiers never take a reading's place.
 */
function add(found: Found[], printed: string, value: number | undefined, unit?: string): void {
  const words = wordsOf(printed);
  if (value === undefined || IDENTIFIERS.has(words.at(-1) ?? '')) return;
  found.push({ label: label(printed), words, value, ...(unit ? { unit } : {}) });
}

/** Gives each reading a name unique in its text, in order, and stops at the per-source cap. */
function named(found: readonly Found[]): MetricReading[] {
  const seen = new Set<string>();
  const out: MetricReading[] = [];
  for (const { words, ...reading } of found) {
    if (out.length >= METRIC_LIMITS.perSource) break;
    const slug = slugOf(words) || 'value';
    let name = slug;
    for (let n = 2; seen.has(name); n++)
      name = `${slug.slice(0, METRIC_LIMITS.nameChars - String(n).length - 1).replace(/-+$/, '')}-${n}`;
    seen.add(name);
    out.push({ name, ...reading });
  }
  return out;
}

/** Numeric leaves of a JSON object, by key path, down to `jsonDepth`; arrays are not read. */
function leaves(value: unknown, path: string[], out: Found[]): void {
  if (out.length >= METRIC_LIMITS.perSource) return;
  if (typeof value === 'number' && path.length) {
    add(out, path.join('.'), bounded(value));
    return;
  }
  // Arrays hold records, whose numbers are ids and amounts rather than measurements.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (path.length >= METRIC_LIMITS.jsonDepth) return;
  for (const [key, child] of Object.entries(value)) {
    // People and models read the key: one that moves the cursor or turns text around is skipped.
    if (!HIDES_TEXT.test(key)) leaves(child, [...path, key], out);
  }
}

/** The text Covi reads: at most `textChars`, and never a last line the limit cuts in half. */
function within(text: string): string {
  if (text.length <= METRIC_LIMITS.textChars) return text;
  const end = text.lastIndexOf('\n', METRIC_LIMITS.textChars);
  return end < 0 ? '' : text.slice(0, end);
}

/** The text as a JSON object, or undefined when it is not one. */
function jsonObject(text: string): object | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function jsonReadings(value: object): MetricReading[] {
  const found: Found[] = [];
  leaves(value, [], found);
  return named(found);
}

/** The numeric fields of a JSON object body (a response); nothing for any other text. */
export function readJsonMetrics(text: string): MetricReading[] {
  const value = jsonObject(within(text));
  return value ? jsonReadings(value) : [];
}

/**
 * The numbers a command printed: a JSON object's numeric fields when the whole output is one (in
 * key order), else every line that is a name and a number (`label: 12 ms`, `label = 12`), else the
 * `key=value` pairs inside a line. At most 50, in the order printed.
 */
export function readMetrics(text: string): MetricReading[] {
  const plain = within(text).replace(ANSI, '');
  const json = jsonObject(plain);
  if (json) return jsonReadings(json);
  const found: Found[] = [];
  for (const raw of plain.split(/\r?\n/)) {
    if (found.length >= METRIC_LIMITS.perSource) break;
    const line = raw.trim();
    if (!line || line.length > METRIC_LIMITS.lineChars) continue;
    const whole = LINE.exec(line);
    if (whole) {
      add(found, whole[1]!, metricValue(whole[2]!), whole[3]);
      continue;
    }
    for (const pair of line.matchAll(PAIR)) add(found, pair[1]!, metricValue(pair[2]!), pair[3]);
  }
  return named(found);
}

/**
 * One source's metrics: base and head readings with the same name and unit pair up (a unit that
 * changed is not converted: the head reading stands alone). Head's order first, then what only
 * base printed. At most 50. Each list is one reader's output, so its names are unique.
 */
export function pairMetrics(
  base: readonly MetricReading[] = [],
  head: readonly MetricReading[] = [],
): PairedMetric[] {
  const before = new Map(base.map((m) => [m.name, m]));
  const after = new Map(head.map((m) => [m.name, m]));
  const out: PairedMetric[] = [];
  for (const h of head) {
    const b = before.get(h.name);
    const paired = b !== undefined && b.unit === h.unit;
    out.push({
      name: h.name,
      label: h.label,
      ...(h.unit ? { unit: h.unit } : {}),
      ...(paired ? { base: b.value } : {}),
      head: h.value,
    });
  }
  for (const b of base)
    if (!after.has(b.name))
      out.push({
        name: b.name,
        label: b.label,
        ...(b.unit ? { unit: b.unit } : {}),
        base: b.value,
      });
  return out.slice(0, METRIC_LIMITS.perSource);
}
