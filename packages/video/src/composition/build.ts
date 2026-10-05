import { copyFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative } from 'node:path';
import { shortHash, UsageError } from '@covi/core';
import type { ImageAsset, Timeline } from '../timeline/types.ts';
import { imageSize } from './images.ts';
import { runtimeScript } from './runtime-bundle.ts';

const require = createRequire(import.meta.url);

/** Collects images referenced by the storyboard and assigns them stable, content-addressed names. */
export class AssetCollector {
  readonly files = new Map<string, string>();
  private readonly runDir: string;
  private readonly sizes = new Map<string, { width: number; height: number }>();

  constructor(runDir: string) {
    this.runDir = runDir;
  }

  /**
   * Pre-reads sizes so `image()` can stay synchronous during timeline construction. Images must
   * live in the run directory: a storyboard cannot pull other files from the machine into a video.
   */
  async prepare(paths: Iterable<string>): Promise<void> {
    const runDir = await realpath(this.runDir);
    for (const path of paths) {
      if (this.sizes.has(path)) continue;
      const absolute = await realpath(join(this.runDir, path)).catch(() => {
        throw new UsageError(`Storyboard image not found in the run: ${path}`);
      });
      const rel = relative(runDir, absolute);
      if (!rel || rel.startsWith('..') || isAbsolute(rel))
        throw new UsageError(`Storyboard image is outside the run directory: ${path}`);
      this.sizes.set(path, await imageSize(absolute));
    }
  }

  image = (path: string): ImageAsset => {
    const size = this.sizes.get(path);
    if (!size) throw new Error(`Image not prepared: ${path}`);
    const src = `assets/img/${shortHash(path)}${extname(path) || '.png'}`;
    this.files.set(src, join(this.runDir, path));
    return { src, width: size.width, height: size.height };
  };
}

export function fontFiles(): { sans: string; mono: string } {
  return {
    sans: require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    mono: require.resolve(
      '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
    ),
  };
}

/**
 * Writes a self-contained composition: index.html (timeline inlined), the runtime script, fonts,
 * and images. Opening index.html in a browser shows the first frame; `window.covi.seek(n)` draws
 * any frame, which is how the renderer captures video.
 */
export async function writeComposition(
  dir: string,
  timeline: Timeline,
  images: Map<string, string>,
): Promise<string> {
  await mkdir(join(dir, 'assets', 'img'), { recursive: true });
  await mkdir(join(dir, 'assets', 'fonts'), { recursive: true });
  const fonts = fontFiles();
  await copyFile(fonts.sans, join(dir, 'assets', 'fonts', 'inter.woff2'));
  await copyFile(fonts.mono, join(dir, 'assets', 'fonts', 'jetbrains-mono.woff2'));
  for (const [src, source] of images) {
    await mkdir(dirname(join(dir, src)), { recursive: true });
    await copyFile(source, join(dir, src));
  }
  await writeFile(join(dir, 'runtime.js'), await runtimeScript());
  await writeFile(join(dir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  const json = JSON.stringify(timeline).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${timeline.width}">
<title>${escapeHtml(timeline.title)} · Covi</title>
<style>
@font-face { font-family: 'Inter Variable'; src: url(assets/fonts/inter.woff2) format('woff2'); font-weight: 100 900; font-display: block; }
@font-face { font-family: 'JetBrains Mono Variable'; src: url(assets/fonts/jetbrains-mono.woff2) format('woff2'); font-weight: 100 800; font-display: block; }
html, body { margin: 0; background: ${timeline.theme.background}; }
</style>
</head>
<body>
<div id="stage"></div>
<script id="covi-timeline" type="application/json">${json}</script>
<script src="runtime.js"></script>
</body>
</html>
`;
  const index = join(dir, 'index.html');
  await writeFile(index, html);
  return index;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
