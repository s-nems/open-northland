import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

// The first path segment of every URL the app fetches from the content tree. A miss there answers
// 404: Vite's SPA fallback would otherwise serve `index.html` as HTTP 200 and the loaders' `!res.ok`
// absence checks would read a missing file as bytes.
const CONTENT_ROOTS = new Set([
  'ir.json',
  'maps-index.json',
  'bobs-index.json',
  'maps',
  'bobs',
  'textures',
  'sounds',
  'music',
  'gui',
  'gui-bitmaps',
  'goods',
  'terrain-palettes',
]);

const HTTP_PARTIAL_CONTENT = 206;
const HTTP_RANGE_NOT_SATISFIABLE = 416;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.cur': 'image/x-icon',
  '.webm': 'video/webm',
};

/**
 * The content file a request pathname names under `contentRoot`, or undefined: a missing file, a
 * directory, a malformed percent sequence and any path that would leave the root all read the same
 * way. `contentRoot` is absolute and never request input. The desktop shell keeps the same rule in
 * `packages/desktop/src/static-files.ts`; a change here applies there too.
 */
export async function contentFile(contentRoot: string, rawPathname: string): Promise<string | undefined> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  const file = resolve(contentRoot, `.${sep}${pathname.replace(/^\/+/, '')}`);
  if (!file.startsWith(`${contentRoot}${sep}`)) return undefined;
  try {
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** Inclusive byte bounds of a satisfiable single `Range` request. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The part of a `size`-byte file a `Range` header asks for: undefined to serve it whole (no header, a
 * multi-range or an unparsed unit), `'unsatisfiable'` for a range past the end. Media elements need
 * ranges to seek.
 */
export function byteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (match === null) return undefined;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return undefined;
  if (first === '') {
    const suffix = Number(last);
    return suffix === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? 'unsatisfiable' : { start, end };
}

/** Whether a pathname belongs to the content tree's URL space, whatever is on disk. */
export function isContentPath(pathname: string): boolean {
  return CONTENT_ROOTS.has(pathname.split('/')[1] ?? '');
}

/** Streams the pipeline's output tree from `/` as static files, laid out exactly as the app fetches it. */
export function serveContent(contentRoot: string): Plugin {
  return {
    name: 'opennorthland-serve-content',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        void (async () => {
          const file = await contentFile(contentRoot, pathname);
          if (file === undefined) {
            if (isContentPath(pathname)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            next();
            return;
          }
          res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
          res.setHeader('Accept-Ranges', 'bytes');
          const { size } = await stat(file);
          const range = byteRange(req.headers.range, size);
          if (range === 'unsatisfiable') {
            res.statusCode = HTTP_RANGE_NOT_SATISFIABLE;
            res.setHeader('Content-Range', `bytes */${size}`);
            res.end();
            return;
          }
          if (range !== undefined) {
            res.statusCode = HTTP_PARTIAL_CONTENT;
            res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
          }
          res.setHeader('Content-Length', range === undefined ? size : range.end - range.start + 1);
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          createReadStream(file, range).pipe(res);
        })().catch(next);
      });
    },
  };
}
