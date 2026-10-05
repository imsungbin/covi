import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export interface StaticServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * Serves a directory on 127.0.0.1 (random port). Used to show static sites without running any
 * project code, and to load compositions over HTTP. Paths cannot escape the root, including
 * through symlinks: a reviewed repository could commit one pointing at files outside it.
 */
export async function serveStatic(
  root: string,
  options: { port?: number } = {},
): Promise<StaticServer> {
  const base = resolve(root);
  const realBase = await realpath(base);
  const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);
  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = normalize(join(base, decodeURIComponent(url.pathname)));
      if (!inside(path, base)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let real = await realpath(path).catch(() => undefined);
      let info = real ? await stat(real).catch(() => undefined) : undefined;
      if (real && info?.isDirectory()) {
        real = await realpath(join(real, 'index.html')).catch(() => undefined);
        info = real ? await stat(real).catch(() => undefined) : undefined;
      }
      if (real && !inside(real, realBase)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!real || !info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      path = real;
      res.writeHead(200, {
        'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(path).pipe(res);
    } catch {
      res.writeHead(500).end('Error');
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolveListen());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}
