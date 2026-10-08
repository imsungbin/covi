import { rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EnvironmentError, exec } from '@covi/core';

/** Recording was asked for explicitly (a flag, COVI_DEMO_RECORD, or configuration) and cannot happen. */
export class RecordingUnavailableError extends EnvironmentError {
  constructor(detail: string) {
    super(
      `Flows cannot be recorded: ${detail}`,
      'Install the browser with `covi doctor --install-browser`, or pass --no-record (demo.record: false).',
    );
    this.name = 'RecordingUnavailableError';
  }
}

export interface FinalRecording {
  file: string;
  format: 'mp4' | 'webm';
  /** Why the recording stayed WebM. */
  cause?: 'no-ffmpeg' | 'convert-failed';
  detail?: string;
}

/** H.264 plays everywhere; mpeg4 when this ffmpeg build has no libx264. */
const ENCODERS: ReadonlyArray<readonly string[]> = [
  ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'],
  ['-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p'],
];

/**
 * Turns Playwright's WebM into `targets.mp4` with ffmpeg, or keeps it as `targets.webm` when ffmpeg
 * is missing or fails: a WebM is still evidence, and missing ffmpeg must not fail a demonstration.
 */
export async function finalizeRecording(
  raw: string,
  targets: { mp4: string; webm: string },
  ffmpeg: string | undefined,
): Promise<FinalRecording> {
  if (!ffmpeg) {
    await rename(raw, targets.webm);
    return { file: targets.webm, format: 'webm', cause: 'no-ffmpeg' };
  }
  let detail = '';
  for (const encoder of ENCODERS) {
    try {
      const result = await exec(
        ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-loglevel',
          'error',
          '-i',
          raw,
          '-an',
          ...encoder,
          // yuv420p needs even dimensions.
          '-vf',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-movflags',
          '+faststart',
          targets.mp4,
        ],
        { cwd: dirname(raw), timeoutMs: 120_000 },
      );
      if (result.exitCode === 0) {
        await rm(raw, { force: true });
        return { file: targets.mp4, format: 'mp4' };
      }
      detail = result.stderr.trim().split('\n').at(-1) || `ffmpeg exited with ${result.exitCode}`;
    } catch (error) {
      // ffmpeg cannot run at all; another encoder will not help.
      detail = (error as Error).message.split('\n')[0]!;
      break;
    }
  }
  await rm(targets.mp4, { force: true });
  await rename(raw, targets.webm);
  return { file: targets.webm, format: 'webm', cause: 'convert-failed', detail };
}
