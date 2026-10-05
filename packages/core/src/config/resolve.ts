import { parseOrThrow } from '../util/zod.ts';
import {
  ConfigInputSchema,
  type CoviConfig,
  DEFAULT_CONFIG,
  type ParsedConfigInput,
} from './schema.ts';

/**
 * Configuration precedence, highest first:
 *   explicit (CLI flags, CI inputs, COVI_* env)  >  repository (.covi/config.yml)
 *   >  workflow (defaults a workflow or integration declares)  >  global (built-in defaults)
 */
export const LAYER_ORDER = ['global', 'workflow', 'repository', 'explicit'] as const;
export type ConfigLayerName = (typeof LAYER_ORDER)[number];

export interface ConfigLayer {
  name: ConfigLayerName;
  /** Where the values came from (a file path, `--flag`, or an integration name). */
  source?: string;
  values: ParsedConfigInput;
}

export interface ResolvedConfig {
  config: CoviConfig;
  /** Dotted path → layer that set it, e.g. `video.mode: repository (.covi/config.yml)`. */
  provenance: Record<string, string>;
}

export function parseConfigInput(raw: unknown, label: string): ParsedConfigInput {
  return parseOrThrow(
    ConfigInputSchema,
    raw ?? {},
    label,
    'See docs/configuration.md for every supported key.',
  );
}

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(values: ParsedConfigInput): Plain {
  const copy = structuredClone(values) as Plain;
  const video = copy.video as Plain | undefined;
  if (video && typeof video.narration === 'boolean') video.narration = { enabled: video.narration };
  return copy;
}

function mergeInto(
  target: Plain,
  source: Plain,
  label: string,
  provenance: Record<string, string>,
  prefix = '',
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlain(value) && isPlain(target[key]) && !isRecordField(path)) {
      mergeInto(target[key] as Plain, value, label, provenance, path);
    } else {
      target[key] = structuredClone(value);
      provenance[path] = label;
      for (const existing of Object.keys(provenance)) {
        if (existing.startsWith(`${path}.`)) delete provenance[existing];
      }
    }
  }
}

/** Free-form maps are replaced as a whole rather than merged key by key. */
function isRecordField(path: string): boolean {
  return path === 'app.env' || path === 'video.narration.pronunciations';
}

function leafProvenance(
  value: unknown,
  label: string,
  out: Record<string, string>,
  prefix = '',
): void {
  if (!isPlain(value) || (prefix && isRecordField(prefix))) {
    out[prefix] = label;
    return;
  }
  for (const [key, child] of Object.entries(value))
    leafProvenance(child, label, out, prefix ? `${prefix}.${key}` : key);
}

export function resolveConfig(layers: readonly ConfigLayer[]): ResolvedConfig {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as Plain;
  const provenance: Record<string, string> = {};
  leafProvenance(config, 'global', provenance);
  const ordered = [...layers].sort(
    (a, b) => LAYER_ORDER.indexOf(a.name) - LAYER_ORDER.indexOf(b.name),
  );
  for (const layer of ordered) {
    const label = layer.source ? `${layer.name} (${layer.source})` : layer.name;
    mergeInto(config, normalize(layer.values), label, provenance);
  }
  return { config: config as unknown as CoviConfig, provenance };
}

/** Maps COVI_* environment variables onto config keys (treated as explicit input). */
export function configFromEnv(env: NodeJS.ProcessEnv): ParsedConfigInput {
  const raw: Record<string, unknown> = {};
  const set = (section: string, key: string, value: unknown) => {
    raw[section] ??= {};
    (raw[section] as Plain)[key] = value;
  };
  const bool = (v: string) => /^(1|true|yes|on)$/i.test(v);
  if (env.COVI_LANGUAGE) raw.language = env.COVI_LANGUAGE;
  if (env.COVI_PROVIDER) set('intelligence', 'provider', env.COVI_PROVIDER);
  if (env.COVI_MODEL) set('intelligence', 'model', env.COVI_MODEL);
  if (env.COVI_FAIL_ON) set('review', 'failOn', env.COVI_FAIL_ON);
  if (env.COVI_VIDEO_MODE) set('video', 'mode', env.COVI_VIDEO_MODE);
  if (env.COVI_VIDEO_DURATION) set('video', 'duration', env.COVI_VIDEO_DURATION);
  const narration: Record<string, unknown> = {};
  if (env.COVI_NARRATION) narration.enabled = bool(env.COVI_NARRATION);
  if (env.COVI_TTS_PROVIDER) narration.provider = env.COVI_TTS_PROVIDER;
  if (env.COVI_TTS_VOICE) narration.voice = env.COVI_TTS_VOICE;
  if (Object.keys(narration).length) set('video', 'narration', narration);
  if (env.COVI_CAPTIONS) set('video', 'captions', bool(env.COVI_CAPTIONS));
  const music: Record<string, unknown> = {};
  if (env.COVI_MUSIC) music.use = env.COVI_MUSIC;
  if (env.COVI_MUSIC_PLACEMENT) music.placement = env.COVI_MUSIC_PLACEMENT;
  if (Object.keys(music).length) set('video', 'music', music);
  if (env.COVI_SOUND_EFFECTS)
    set('video', 'soundEffects', { enabled: bool(env.COVI_SOUND_EFFECTS) });
  if (env.COVI_OUTRO) set('video', 'outro', bool(env.COVI_OUTRO));
  if (env.COVI_OUTPUT_DIR) set('output', 'dir', env.COVI_OUTPUT_DIR);
  return parseConfigInput(raw, 'COVI_* environment variables');
}
