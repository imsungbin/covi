import { isMetricValue, METRIC_LIMITS } from '../model/evidence.ts';

/*
 * Numbers measured in a run's own text: a demo command's output, a response body, the test run's
 * output. Pure and deterministic. Silence over noise: a line counts only when it is a name and a
 * number (and a unit) and nothing else, so versions, times, dates, and paths give nothing.
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

/** Digits, grouped by commas, underscores, or thin or no-break spaces (one kind throughout). */
const NUMBER = String.raw`[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:_\d{3})+|\d{1,3}(?:[   ]\d{3})+|\d+)(?:\.\d+)?`;
const UNIT = String.raw`%|\p{L}{1,8}`;
/** A whole line that names one number: `request bytes: 70406`, `- Duration = 1.2 s`, `Coverage: 87%`. */
const LINE = new RegExp(
  String.raw`^(?:[-*•]\s+)?(\p{L}[\p{L}\p{N} _./()'-]{0,59}?)\s*[:=]\s*(${NUMBER})\s*(${UNIT})?$`,
  'u',
);
/** `key=value` pairs inside a line: `status=200 duration=12ms`. */
const PAIR = new RegExp(
  String.raw`(?<=^|[\s,;(\[{])([A-Za-z_][A-Za-z0-9_.-]{0,39})=(${NUMBER})(${UNIT})?(?=$|[\s,;)\]}])`,
  'gu',
);
/** Terminal colors and cursor moves, which commands print around their numbers. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** A number as printed, as a metric value: separators dropped, rounded to six decimals. */
export function metricValue(text: string): number | undefined {
  const plain = text.replace(/[,_   ]/g, '').replace('−', '-');
  const value = Number(plain);
  if (!Number.isFinite(value)) return undefined;
  const rounded = Number(value.toFixed(METRIC_LIMITS.decimals)) || 0;
  return isMetricValue(rounded) ? rounded : undefined;
}

/**
 * A metric's name for its id: lowercase ASCII letters and digits, dashes between words, at most 40
 * characters. Empty when the label has no such letters (a label in another script); the label
 * itself keeps what the text said.
 */
export function metricSlug(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, METRIC_LIMITS.nameChars)
    .replace(/-+$/, '');
}

/** Gives each reading a name unique in its text, in order, and stops at the per-source cap. */
function named(found: Array<Omit<MetricReading, 'name'>>): MetricReading[] {
  const seen = new Set<string>();
  const out: MetricReading[] = [];
  for (const reading of found) {
    if (out.length >= METRIC_LIMITS.perSource) break;
    const slug = metricSlug(reading.label) || 'value';
    let name = slug;
    for (let n = 2; seen.has(name); n++)
      name = `${slug.slice(0, METRIC_LIMITS.nameChars - String(n).length - 1).replace(/-+$/, '')}-${n}`;
    seen.add(name);
    out.push({ name, ...reading });
  }
  return out;
}

const label = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, METRIC_LIMITS.labelChars).trimEnd();

/** Numeric leaves of a JSON object, by key path, down to `jsonDepth`; arrays are not read. */
function leaves(value: unknown, path: string[], out: Array<Omit<MetricReading, 'name'>>): void {
  if (out.length >= METRIC_LIMITS.perSource) return;
  if (typeof value === 'number' && path.length) {
    const v = metricValue(String(value));
    if (v !== undefined) out.push({ label: label(path.join('.')), value: v });
    return;
  }
  // Arrays hold records, whose numbers are ids and amounts rather than measurements.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (path.length >= METRIC_LIMITS.jsonDepth) return;
  for (const [key, child] of Object.entries(value)) leaves(child, [...path, key], out);
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

/** The numeric fields of a JSON object body (a response); nothing for any other text. */
export function readJsonMetrics(text: string): MetricReading[] {
  const value = jsonObject(text.slice(0, METRIC_LIMITS.textChars));
  const found: Array<Omit<MetricReading, 'name'>> = [];
  if (value) leaves(value, [], found);
  return named(found);
}

/**
 * The numbers a command printed: a JSON object's numeric fields when the whole output is one,
 * else every line that is a name and a number (`label: 12 ms`, `label = 12`), else the
 * `key=value` pairs inside a line. At most 50, in the order printed.
 */
export function readMetrics(text: string): MetricReading[] {
  const plain = text.slice(0, METRIC_LIMITS.textChars).replace(ANSI, '');
  if (jsonObject(plain)) return readJsonMetrics(plain);
  const found: Array<Omit<MetricReading, 'name'>> = [];
  for (const raw of plain.split(/\r?\n/)) {
    if (found.length >= METRIC_LIMITS.perSource) break;
    const line = raw.trim();
    if (!line || line.length > METRIC_LIMITS.lineChars) continue;
    const whole = LINE.exec(line);
    if (whole) {
      const value = metricValue(whole[2]!);
      if (value !== undefined)
        found.push({ label: label(whole[1]!), value, ...(whole[3] ? { unit: whole[3] } : {}) });
      continue;
    }
    for (const pair of line.matchAll(PAIR)) {
      const value = metricValue(pair[2]!);
      if (value !== undefined)
        found.push({ label: label(pair[1]!), value, ...(pair[3] ? { unit: pair[3] } : {}) });
    }
  }
  return named(found);
}

/**
 * One source's metrics: base and head readings with the same name and unit pair up (a unit that
 * changed is not converted: the head reading stands alone). Head's order first, then what only
 * base printed. At most 50.
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
