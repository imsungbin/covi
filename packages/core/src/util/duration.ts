/**
 * Parses human duration strings used in config and CLI flags.
 * Accepts numbers (seconds), "30s", "1m", "1m30s", "90 sec", "2 minutes", "1500ms".
 */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error(`Invalid duration: ${input}`);
    return input;
  }
  const text = input.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const unit = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)/g;
  let total = 0;
  let consumed = '';
  for (const match of text.matchAll(unit)) {
    const value = Number(match[1]);
    const u = match[2]!;
    if (u.startsWith('ms') || u.startsWith('milli')) total += value / 1000;
    else if (u.startsWith('h')) total += value * 3600;
    else if (u === 'm' || u.startsWith('min')) total += value * 60;
    else total += value;
    consumed += match[0];
  }
  if (!consumed || consumed.replace(/\s/g, '') !== text.replace(/[\s-]/g, '')) {
    throw new Error(`Invalid duration "${input}". Use seconds or forms like 30s, 1m30s, 90 sec.`);
  }
  return total;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return s ? `${m}m${s}s` : `${m}m`;
}

export function formatTimestamp(seconds: number, separator: '.' | ',' = '.'): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(rest, 3)}`;
}
