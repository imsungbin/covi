import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { serveStatic, sha256 } from '@covi/core';
import { type Browser, chromium, type Page } from 'playwright';
import { entranceSeconds, restFrame, settledFrame } from '../timeline/cues.ts';
import {
  type CompositionApi,
  HERO_PHASE,
  type LayoutReport,
  type Timeline,
} from '../timeline/types.ts';
import type { Media } from './ffmpeg.ts';
import { HIDE_LABEL_SCRIPT, sheetLabel, showLabelScript, tileLayout } from './sheet.ts';

export interface RenderOptions {
  /** Directory holding the composition's index.html. */
  compositionDir: string;
  output: string;
  timeline: Pick<
    Timeline,
    'fps' | 'frames' | 'width' | 'height' | 'duration' | 'scenes' | 'transition'
  >;
  media: Media;
  /** The mixed sound to mux (a stereo WAV), when anything plays. */
  audio?: string;
  workers?: number;
  /** Frames to sample for layout QC (defaults to `layoutSampleFrames`). */
  layoutFrames?: number[];
  /** Frames for the contact sheet (defaults to `contactSheetFrames`). */
  sheetFrames?: number[];
  posterFrame?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderResult {
  output: string;
  frames: number;
  renderMs: number;
  /** The layout reports sampled while rendering, in frame order. */
  layouts: LayoutReport[];
  poster?: string;
  contactSheet?: string;
  pageErrors: string[];
}

/** In the page, `globalThis` is the window and exposes the composition API. */
type CompositionWindow = { covi?: CompositionApi };

const LAUNCH_ARGS = [
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--mute-audio',
];

async function openPage(
  browser: Browser,
  url: string,
  width: number,
  height: number,
  errors: string[],
): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof (globalThis as CompositionWindow).covi !== 'undefined',
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => (globalThis as CompositionWindow).covi!.ready);
  return page;
}

function encodeSegment(media: Media, fps: number, out: string, encoderArgs: string[]) {
  const child = spawn(
    media.ffmpegPath,
    [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', '-'],
      // Screenshots are full-range JPEG; convert to the broadcast range players expect.
      ...['-vf', 'scale=in_range=full:out_range=tv,format=yuv420p'],
      ...encoderArgs,
      ...[
        '-color_range',
        'tv',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
      ],
      ...['-r', String(fps), '-an', out],
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg segment encode failed (${code}): ${stderr.trim().slice(-400)}`)),
    );
  });
  // One error listener for the pipe's lifetime (not one per frame).
  let pipeError: Error | undefined;
  child.stdin.on('error', (error) => {
    pipeError = error;
  });
  const write = (buffer: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (pipeError) {
        reject(pipeError);
        return;
      }
      if (child.stdin.write(buffer)) resolve();
      else child.stdin.once('drain', resolve);
    });
  return { write, end: () => child.stdin.end(), done, kill: () => child.kill('SIGKILL') };
}

/** The opening tile: 0.3 s in, where a cold open is already on screen. */
const OPENING = 0.3;
/** The hero's tile, a beat after its phase, while its accent plays. */
const HERO_TILE = 0.1;
/** A morph's tile, halfway through it: kept tokens on their way, old lines folding, new arriving. */
const MORPH_TILE = 0.5;

/**
 * Frames for the contact sheet, in time order: the opening, every scene's middle, the middle of
 * every transition (a cut has none; timelines without kinds faded over `transition`), the hero's
 * accent, and the middle of every morph, so the sheet shows the code changing.
 */
export function contactSheetFrames(
  timeline: Pick<Timeline, 'fps' | 'frames' | 'scenes' | 'transition'>,
): number[] {
  const last = Math.max(0, timeline.frames - 1);
  const frame = (t: number) => Math.min(last, Math.max(0, Math.round(t * timeline.fps)));
  const frames = new Set([frame(OPENING)]);
  timeline.scenes.forEach((s, i) => {
    frames.add(frame((s.start + s.end) / 2));
    const seconds = entranceSeconds(timeline, i);
    if (seconds > 0) frames.add(frame(s.start + seconds / 2));
    const hero = s.phases?.[HERO_PHASE];
    if (s.hero && hero !== undefined) frames.add(frame(s.start + hero + HERO_TILE));
    for (const beat of s.direction?.beats ?? [])
      if (beat.verb === 'morph') frames.add(frame(s.start + beat.t + beat.seconds * MORPH_TILE));
  });
  return [...frames].sort((a, b) => a - b);
}

/**
 * Frames the layout checks read: 35% and 70% of the way through every scene, and the frame where
 * each story scene has settled, at which QC measures text sizes and how much of the frame the
 * content fills, with the frame before a directed scene's first camera beat, where its text is
 * read at its own scale. The outro is Covi's own card, so it is not held to those checks.
 */
export function layoutSampleFrames(
  timeline: Pick<Timeline, 'fps' | 'frames' | 'scenes' | 'transition'>,
): number[] {
  const last = Math.max(0, timeline.frames - 1);
  const frames = new Set(
    timeline.scenes.flatMap((s) =>
      [0.35, 0.7].map((k) =>
        Math.min(last, Math.round((s.start + (s.end - s.start) * k) * timeline.fps)),
      ),
    ),
  );
  timeline.scenes.forEach((s, i) => {
    if (s.visual.kind === 'outro') return;
    for (const frame of [settledFrame(timeline, i), restFrame(timeline, i)])
      if (frame !== undefined) frames.add(frame);
  });
  return [...frames].sort((a, b) => a - b);
}

/** Contact sheet columns: six narrow tiles for vertical video; three wide ones, four past twelve. */
export function sheetColumns(tiles: number, vertical: boolean): number {
  return Math.max(1, Math.min(tiles, vertical ? 6 : tiles > 12 ? 4 : 3));
}

/** A contact sheet tile: the frame as the video shows it, and its label band (see `tileLayout`). */
interface Tile {
  picture: Buffer;
  label: Buffer;
}

/**
 * A contact sheet tile of the frame the page shows, and a band naming the scene it belongs to and
 * the evidence it cites. The band is shot on its own and removed again, so neither the tile's
 * frame nor the video's frames carry it.
 */
async function shootTile(
  page: Page,
  timeline: Pick<Timeline, 'fps' | 'scenes' | 'width' | 'height'>,
  frame: number,
): Promise<Tile> {
  const shot = (clip?: { x: number; y: number; width: number; height: number }) =>
    page.screenshot({
      type: 'jpeg',
      quality: 94,
      animations: 'disabled',
      caret: 'hide',
      ...(clip ? { clip } : {}),
    });
  const picture = await shot();
  const { label } = tileLayout(timeline.width, timeline.height);
  await page.evaluate(showLabelScript(sheetLabel(timeline, frame), timeline.width));
  try {
    return { picture, label: await shot({ ...label, y: 0 }) };
  } finally {
    await page.evaluate(HIDE_LABEL_SCRIPT);
  }
}

export interface ContactSheetOptions {
  compositionDir: string;
  timeline: RenderOptions['timeline'];
  media: Media;
  /** Where the sheet goes: `contact-sheet.jpg` beside the video. */
  output: string;
}

/**
 * Shoots only the contact sheet, for reused frames: the frames key leaves out what the tiles
 * name (the evidence scenes cite), so the labels may have changed while the pixels did not.
 */
export async function renderContactSheet(options: ContactSheetOptions): Promise<string> {
  const { timeline, media } = options;
  const workDir = join(dirname(options.output), '.render-contact-sheet');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  const server = await serveStatic(options.compositionDir);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const errors: string[] = [];
    const page = await openPage(
      browser,
      `${server.url}/index.html`,
      timeline.width,
      timeline.height,
      errors,
    );
    const tiles: Tile[] = [];
    for (const frame of contactSheetFrames(timeline)) {
      await page.evaluate((f) => (globalThis as CompositionWindow).covi!.seek(f), frame);
      tiles.push(await shootTile(page, timeline, frame));
    }
    if (errors.length) throw new Error(`Composition error: ${errors[0]}`);
    return await contactSheet(
      media,
      tiles,
      options.output,
      workDir,
      timeline.width,
      timeline.height,
    );
  } finally {
    await browser.close().catch(() => undefined);
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Renders a composition to H.264 MP4 by seeking every frame in headless Chromium. */
export async function renderComposition(options: RenderOptions): Promise<RenderResult> {
  const started = Date.now();
  const { timeline, media } = options;
  const total = timeline.frames;
  const workDir = join(dirname(options.output), `.render-${basename(options.output)}`);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const workers = Math.max(
    1,
    Math.min(
      options.workers ?? Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))),
      Math.ceil(total / 45),
    ),
  );
  const ranges = Array.from({ length: workers }, (_, i) => {
    const from = Math.floor((total * i) / workers);
    return { from, to: Math.floor((total * (i + 1)) / workers) };
  });
  const layoutFrames = new Set(options.layoutFrames ?? layoutSampleFrames(timeline));
  const sheetFrames = new Set(options.sheetFrames ?? contactSheetFrames(timeline));
  const posterFrame =
    options.posterFrame ??
    Math.min(total - 1, Math.round(Math.min(1.6, timeline.duration / 3) * timeline.fps));

  const server = await serveStatic(options.compositionDir);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const encoderArgs = await media.videoEncoderArgs();
  const pageErrors: string[] = [];
  const layouts: LayoutReport[] = [];
  const sheet = new Map<number, Tile>();
  let poster: Buffer | undefined;
  let done = 0;
  const encoders: Array<ReturnType<typeof encodeSegment>> = [];

  try {
    await Promise.all(
      ranges.map(async (range, i) => {
        const page = await openPage(
          browser,
          `${server.url}/index.html`,
          timeline.width,
          timeline.height,
          pageErrors,
        );
        const encoder = encodeSegment(
          media,
          timeline.fps,
          join(workDir, `segment-${String(i).padStart(3, '0')}.mp4`),
          encoderArgs,
        );
        encoders.push(encoder);
        for (let frame = range.from; frame < range.to; frame++) {
          await page.evaluate((f) => (globalThis as CompositionWindow).covi!.seek(f), frame);
          const jpeg = await page.screenshot({
            type: 'jpeg',
            quality: 94,
            animations: 'disabled',
            caret: 'hide',
          });
          await encoder.write(jpeg);
          if (layoutFrames.has(frame))
            layouts.push(
              await page.evaluate(() => (globalThis as CompositionWindow).covi!.layout()),
            );
          if (sheetFrames.has(frame)) sheet.set(frame, await shootTile(page, timeline, frame));
          if (frame === posterFrame) poster = await page.screenshot({ type: 'png' });
          done++;
          if (done % 15 === 0 || done === total) options.onProgress?.(done, total);
        }
        encoder.end();
        await encoder.done;
        await page.close();
      }),
    );
    if (pageErrors.length) throw new Error(`Composition error: ${pageErrors[0]}`);

    const list = ranges
      .map(
        (_, i) =>
          `file '${join(workDir, `segment-${String(i).padStart(3, '0')}.mp4`).replace(/'/g, "'\\''")}'`,
      )
      .join('\n');
    await writeFile(join(workDir, 'segments.txt'), `${list}\n`);
    const silent = join(workDir, 'video.mp4');
    await media.ffmpeg([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(workDir, 'segments.txt'),
      '-c',
      'copy',
      silent,
    ]);
    await muxAudio(media, silent, options.audio, timeline.duration, options.output);

    const result: RenderResult = {
      output: options.output,
      frames: total,
      renderMs: Date.now() - started,
      // Workers finish in any order; in frame order, the same composition writes the same
      // frames.json however the frames were split.
      layouts: layouts.sort((a, b) => a.frame - b.frame),
      pageErrors,
    };
    if (poster) {
      result.poster = join(dirname(options.output), 'poster.png');
      await writeFile(result.poster, poster);
    }
    if (sheet.size)
      result.contactSheet = await contactSheet(
        media,
        [...sheet.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b),
        join(dirname(options.output), 'contact-sheet.jpg'),
        workDir,
        timeline.width,
        timeline.height,
      );
    return result;
  } catch (error) {
    for (const e of encoders) e.kill();
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Muxes sound into a video, copying the video stream: AAC at 192 kb/s, 48 kHz stereo. Without
 * sound, the video gets no audio stream.
 */
async function muxAudio(
  media: Media,
  video: string,
  audio: string | undefined,
  duration: number,
  output: string,
): Promise<void> {
  if (!audio) {
    await media.ffmpeg([
      '-i',
      video,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ]);
    return;
  }
  await media.ffmpeg([
    ...['-i', video, '-i', audio],
    ...['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'],
    ...['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'],
    ...['-t', duration.toFixed(3), '-movflags', '+faststart', output],
  ]);
}

/**
 * Replaces the sound of a rendered video without rendering a frame: the video stream is copied
 * and the new sound muxed in. For when only the music or the effects changed.
 */
export async function remuxAudio(options: {
  video: string;
  audio?: string;
  duration: number;
  media: Media;
}): Promise<void> {
  const tmp = join(dirname(options.video), `.remux-${basename(options.video)}`);
  await muxAudio(options.media, options.video, options.audio, options.duration, tmp);
  await rename(tmp, options.video);
}

/** `video/frames.json`: the frames a render drew, and what QC measured on them. */
export interface FramesRecord {
  schemaVersion: 1;
  /** A hash of the composition: timeline.json, the page, its assets, and the runtime bundle. */
  key: string;
  frames: number;
  /** The layout reports sampled while rendering, so QC can check them again after a re-mux. */
  layouts: LayoutReport[];
}

/**
 * The frames key: the same composition draws the same frames (rendering is deterministic), so a
 * video whose key has not changed can keep its frames.
 */
export async function framesKey(compositionDir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(compositionDir);
  const parts: string[] = [];
  for (const file of files.sort())
    parts.push(`${relative(compositionDir, file)} ${sha256(await readFile(file))}`);
  return sha256(parts.join('\n'));
}

/** Reuse the rendered frames when the composition is unchanged and the video is still there. */
export function canReuseFrames(
  previous: Pick<FramesRecord, 'key'> | undefined,
  key: string,
  videoExists: boolean,
): boolean {
  return Boolean(previous && videoExists && previous.key === key);
}

/**
 * Tiles the sampled frames, each with its label band stacked below it, into one image so a person
 * or agent can review the whole video at a glance.
 */
async function contactSheet(
  media: Media,
  tiles: Tile[],
  out: string,
  workDir: string,
  width: number,
  height: number,
): Promise<string> {
  const dir = join(workDir, 'sheet');
  await mkdir(dir, { recursive: true });
  await Promise.all(
    tiles.flatMap((tile, i) => [
      writeFile(join(dir, `f-${String(i).padStart(3, '0')}.jpg`), tile.picture),
      writeFile(join(dir, `l-${String(i).padStart(3, '0')}.jpg`), tile.label),
    ]),
  );
  const cols = sheetColumns(tiles.length, height > width);
  const rows = Math.ceil(tiles.length / cols);
  const tileWidth = height > width ? 320 : 560;
  await media.ffmpeg([
    ...['-framerate', '1', '-i', join(dir, 'f-%03d.jpg')],
    ...['-framerate', '1', '-i', join(dir, 'l-%03d.jpg')],
    '-filter_complex',
    `[0:v][1:v]vstack=inputs=2,scale=${tileWidth}:-2,tile=${cols}x${rows}:padding=12:margin=12:color=0xF8F9FB`,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    out,
  ]);
  return out;
}
