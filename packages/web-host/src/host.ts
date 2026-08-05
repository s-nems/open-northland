import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  isContentRoute,
  resolveContentRequest,
  resolveFileUnderRoot,
} from '@open-northland/content-resolver';

const STATIC_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const INDEX_FILE = 'index.html';

export interface WebHostOptions {
  readonly root: string;
  readonly basePath: string;
}

function pathUnderBase(pathname: string, basePath: string): string | undefined {
  if (basePath === '/') return pathname;
  if (pathname === basePath) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
}

function regularFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function sendText(res: ServerResponse, status: number, text: string): void {
  const body = Buffer.from(text);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
}

async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  contentType: string,
): Promise<void> {
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
    size = stat.size;
  } catch {
    sendText(res, 404, 'not found');
    return;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', size);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(createReadStream(file), res);
}

function serveJson(req: IncomingMessage, res: ServerResponse, body: unknown, status = 200): void {
  const encoded = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', encoded.byteLength);
  res.end(req.method === 'HEAD' ? undefined : encoded);
}

function health(options: WebHostOptions): { readonly status: number; readonly body: unknown } {
  const appReady = regularFile(join(options.root, INDEX_FILE));
  const contentReady = regularFile(join(options.root, 'ir.json'));
  const ready = appReady && contentReady;
  return {
    status: ready ? 200 : 503,
    body: {
      status: ready ? 'ok' : 'unavailable',
      app: appReady ? 'ready' : 'missing',
      content: contentReady ? 'ready' : 'missing',
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebHostOptions,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'method not allowed');
    return;
  }

  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://web-host.invalid');
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }

  const pathnameUnderBase = pathUnderBase(url.pathname, options.basePath);
  if (pathnameUnderBase === undefined) {
    sendText(res, 404, 'not found');
    return;
  }

  if (pathnameUnderBase === '/healthz') {
    const state = health(options);
    serveJson(req, res, state.body, state.status);
    return;
  }

  const content = resolveContentRequest(pathnameUnderBase, options.root);
  if (content !== undefined) {
    if (content.kind === 'json') {
      serveJson(req, res, content.body());
      return;
    }
    await serveFile(req, res, content.path, content.contentType);
    return;
  }
  if (isContentRoute(pathnameUnderBase)) {
    sendText(res, 404, 'not found');
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(pathnameUnderBase);
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }
  const relative = pathname.replace(/^\/+/, '') || INDEX_FILE;
  const file = resolveFileUnderRoot(options.root, relative);
  if (file === undefined) {
    sendText(res, 404, 'not found');
    return;
  }
  const contentType = STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  await serveFile(req, res, file, contentType);
}

export function createWebHost(options: WebHostOptions): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, options).catch((error: unknown) => {
      if (!res.headersSent) sendText(res, 500, 'internal server error');
      else res.destroy();
      console.error('[web-host] request failed', error);
    });
  });
}
