import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { BRIEFING_VOICE_SUFFIX, CATALOG_MAP_ID } from '@open-northland/data';
import { MAP_FILE_SUFFIXES } from '@open-northland/map-import';
import { jsonBody } from '../catalog/snapshot.js';
import { acceptsGzip } from './encoding.js';
import { holds, send, sendError, V1_HEADERS } from './response.js';
import type { ContentSource, KeptFile } from './sources.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const OK = 200;
const NOT_FOUND = 404;
const NOT_MODIFIED = 304;
/** The sidecars the content route serves, longest first so `.meta.json` wins over `.json`. The
 *  minimap is left out: the client renders previews itself. */
const CONTENT_SUFFIXES: readonly string[] = Object.entries(MAP_FILE_SUFFIXES)
  .filter(([kind]) => kind !== 'minimap')
  .map(([, suffix]) => suffix)
  .sort((a, b) => b.length - a.length);
const PNG_SUFFIX = '.png';
const WAV_SUFFIX = '.wav';
const BRIEFING_PICTURE_SUFFIX = /\.pictures-[0-9a-f]{16}\.png$/;
/** A briefing voice's suffix, found in a file name rather than matched whole. */
const BRIEFING_VOICE_IN_NAME = new RegExp(BRIEFING_VOICE_SUFFIX.source.slice(1));
/** Stable map URLs can name a new conversion; caches must validate before reusing their bytes. */
const CONTENT_CACHE = 'public, no-cache';
const PNG_TYPE = 'image/png';
const WAV_TYPE = 'audio/wav';
const GZIP = 'gzip';
/** The catalogue names a kept file by a URL carrying its hash, like a thumbnail. */
const KEPT_FILE_CACHE = 'public, max-age=86400';
const KEPT_FILE_TYPE = 'application/octet-stream';
const HEX_RADIX = 16;
/** What a quoted `filename` may hold: printable ASCII without the quote and backslash it would escape. */
const UNQUOTABLE = /[^\x20-\x7e]|["\\]/g;

/** The map id and suffix of a content file name, or null unless both are valid. */
function contentName(fileName: string): { mapId: string; suffix: string } | null {
  const sidecar = BRIEFING_PICTURE_SUFFIX.exec(fileName) ?? BRIEFING_VOICE_IN_NAME.exec(fileName);
  if (sidecar !== null) {
    const mapId = fileName.slice(0, sidecar.index);
    return CATALOG_MAP_ID.test(mapId) ? { mapId, suffix: sidecar[0] } : null;
  }
  for (const suffix of CONTENT_SUFFIXES) {
    if (!fileName.endsWith(suffix)) continue;
    const mapId = fileName.slice(0, -suffix.length);
    return CATALOG_MAP_ID.test(mapId) ? { mapId, suffix } : null;
  }
  return null;
}

/** An attachment named `name`: an ASCII `filename` for every client, the exact one as RFC 5987
 *  `filename*` for those that read it. */
function attachment(name: string): string {
  const fallback = name.replace(UNQUOTABLE, '_');
  // encodeURIComponent leaves these four, which RFC 5987's attr-char does not admit.
  const exact = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${exact}`;
}

/** Streams one sidecar from disk; a gzip-stored one is inflated for a request that does not take gzip. */
export async function serveContent(
  content: ContentSource | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  version: string,
  fileName: string,
): Promise<void> {
  const served = content?.irVersion ?? null;
  if (served === null || version !== String(served)) {
    send(request, response, NOT_FOUND, jsonBody({ error: 'content version not served', irVersion: served }), {
      ...V1_HEADERS,
      'cache-control': 'no-store',
    });
    return;
  }
  const name = contentName(fileName);
  const file = name === null ? null : ((await content?.file(name.mapId, fileName)) ?? null);
  if (name === null || file === null) {
    sendError(request, response, NOT_FOUND, 'no such file', V1_HEADERS);
    return;
  }
  try {
    const headers: Record<string, string> = {
      ...V1_HEADERS,
      'cache-control': CONTENT_CACHE,
      'content-type': name.suffix.endsWith(PNG_SUFFIX)
        ? PNG_TYPE
        : name.suffix.endsWith(WAV_SUFFIX)
          ? WAV_TYPE
          : JSON_TYPE,
      'x-content-type-options': 'nosniff',
      vary: 'Accept-Encoding',
      etag: file.etag,
    };
    if (holds(request, file.etag)) {
      response.writeHead(NOT_MODIFIED, headers).end();
      return;
    }
    const inflate = file.gzipped && !acceptsGzip(request);
    const { size } = await file.handle.stat();
    // An inflated body's length is unknown until it is sent, so it goes out chunked.
    response.writeHead(OK, {
      ...headers,
      ...(file.gzipped && !inflate ? { 'content-encoding': GZIP } : {}),
      ...(inflate ? {} : { 'content-length': size }),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = file.handle.createReadStream({ autoClose: false });
    if (inflate) await pipeline(stream, createGunzip(), response);
    else await pipeline(stream, response);
  } finally {
    await file.handle.close();
  }
}

export async function serveKeptFile(
  kept: KeptFile | null,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (kept === null) {
    sendError(request, response, NOT_FOUND, 'no file', V1_HEADERS);
    return;
  }
  try {
    const etag = `"${kept.sha256}"`;
    const headers = {
      ...V1_HEADERS,
      'cache-control': KEPT_FILE_CACHE,
      'content-type': KEPT_FILE_TYPE,
      'content-disposition': attachment(kept.name),
      'x-content-type-options': 'nosniff',
      etag,
    };
    if (holds(request, etag)) {
      response.writeHead(NOT_MODIFIED, headers).end();
      return;
    }
    const { size } = await kept.handle.stat();
    response.writeHead(OK, { ...headers, 'content-length': size });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await pipeline(kept.handle.createReadStream({ autoClose: false, start: 0 }), response);
  } finally {
    await kept.handle.close();
  }
}
