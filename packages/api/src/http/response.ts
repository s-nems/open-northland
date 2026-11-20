import type { IncomingMessage, ServerResponse } from 'node:http';
import { CATALOG_GAME_VERSION_HEADER } from '@open-northland/data';
import { type Body, jsonBody } from '../catalog/snapshot.js';
import { acceptsGzip } from './encoding.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const OK = 200;
const NOT_MODIFIED = 304;

/** Every `/v1` endpoint is public and read-only, so every origin may read it, its validator and the
 *  catalogue's game version. */
export const V1_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': `ETag, ${CATALOG_GAME_VERSION_HEADER}`,
} as const;

/** The request target up to its query, taken as text: nothing here needs more than the path. */
export function pathOf(request: IncomingMessage): string {
  return (request.url ?? '/').split('?', 1)[0] ?? '/';
}

/** Whether `If-None-Match` names `etag`, as one of a list or as `*`. */
export function holds(request: IncomingMessage, etag: string): boolean {
  const header = request.headers['if-none-match'];
  if (header === undefined) return false;
  return header.split(',').some((tag) => {
    const trimmed = tag.trim();
    return trimmed === '*' || trimmed === etag || trimmed === `W/${etag}`;
  });
}

/** Answers with `body`, or 304 when the request already holds it. Only a 200 carries the validator. */
export function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: Body,
  headers: Readonly<Record<string, string>>,
): void {
  const compressed = body.gzip;
  if (compressed !== undefined) {
    const gzip = acceptsGzip(request);
    headers = { ...headers, vary: 'Accept-Encoding', ...(gzip ? { 'content-encoding': 'gzip' } : {}) };
    if (gzip) body = compressed;
  }
  const ok = status === OK;
  if (ok && holds(request, body.etag)) {
    response.writeHead(NOT_MODIFIED, { ...headers, etag: body.etag }).end();
    return;
  }
  response.writeHead(status, {
    'content-type': JSON_TYPE,
    ...headers,
    'content-length': body.bytes.length,
    ...(ok ? { etag: body.etag } : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : body.bytes);
}

export function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  error: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  send(request, response, status, jsonBody({ error }), { 'cache-control': 'no-store', ...headers });
}
