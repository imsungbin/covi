import { EnvironmentError, exec, which } from '@covi/core';

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  pixFmt?: string;
}

/** Thin wrapper around the ffmpeg and ffprobe binaries. */
export class Media {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  private encoders?: Set<string>;

  private constructor(ffmpegPath: string, ffprobePath: string) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
  }

  static async locate(env: NodeJS.ProcessEnv = process.env): Promise<Media> {
    const ffmpeg = env.COVI_FFMPEG ?? (await which(['ffmpeg']));
    const ffprobe = env.COVI_FFPROBE ?? (await which(['ffprobe']));
    if (!ffmpeg || !ffprobe) {
      throw new EnvironmentError(
        'ffmpeg and ffprobe are required to render video.',
        'Install them (macOS: brew install ffmpeg · Debian/Ubuntu: apt-get install ffmpeg) or set COVI_FFMPEG/COVI_FFPROBE.',
      );
    }
    return new Media(ffmpeg, ffprobe);
  }

  async ffmpeg(args: readonly string[], timeoutMs = 600_000): Promise<string> {
    const result = await exec(
      this.ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args],
      { cwd: process.cwd(), timeoutMs },
    );
    if (result.exitCode !== 0)
      throw new Error(`ffmpeg failed: ${result.stderr.trim().split('\n').slice(-3).join(' ')}`);
    return result.stderr;
  }

  /** Runs ffmpeg for its analysis output (filters like blackdetect write to stderr at info level). */
  async analyze(args: readonly string[], timeoutMs = 600_000): Promise<string> {
    const result = await exec(
      this.ffmpegPath,
      ['-hide_banner', '-nostdin', '-loglevel', 'info', ...args],
      { cwd: process.cwd(), timeoutMs },
    );
    if (result.exitCode !== 0)
      throw new Error(
        `ffmpeg analysis failed: ${result.stderr.trim().split('\n').slice(-3).join(' ')}`,
      );
    return result.stderr;
  }

  async probe(file: string): Promise<ProbeResult> {
    const result = await exec(
      this.ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt',
        '-of',
        'json',
        file,
      ],
      { cwd: process.cwd(), timeoutMs: 60_000 },
    );
    if (result.exitCode !== 0)
      throw new Error(`ffprobe failed for ${file}: ${result.stderr.trim()}`);
    const json = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        pix_fmt?: string;
      }>;
    };
    const video = json.streams?.find((s) => s.codec_type === 'video');
    const audio = json.streams?.find((s) => s.codec_type === 'audio');
    const [n, d] = (video?.r_frame_rate ?? '0/1').split('/').map(Number);
    return {
      duration: Number(json.format?.duration ?? 0),
      width: video?.width,
      height: video?.height,
      fps: d ? n! / d : undefined,
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
      pixFmt: video?.pix_fmt,
    };
  }

  async hasEncoder(name: string): Promise<boolean> {
    if (!this.encoders) {
      const result = await exec(this.ffmpegPath, ['-hide_banner', '-encoders'], {
        cwd: process.cwd(),
        timeoutMs: 30_000,
      });
      this.encoders = new Set(
        result.stdout
          .split('\n')
          .map((l) => /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(l)?.[1])
          .filter((x): x is string => Boolean(x)),
      );
    }
    return this.encoders.has(name);
  }

  /** H.264 encoder arguments: libx264 when available (portable, deterministic), otherwise a fallback. */
  async videoEncoderArgs(): Promise<string[]> {
    if (await this.hasEncoder('libx264')) {
      return [
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'high',
        '-tune',
        'stillimage',
        '-x264-params',
        'colorprim=bt709:transfer=bt709:colormatrix=bt709',
      ];
    }
    if (await this.hasEncoder('h264_videotoolbox'))
      return ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p'];
    return ['-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p'];
  }
}
