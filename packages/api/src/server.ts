import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CATALOG_GAME_VERSION_HEADER, CATALOG_MAP_ID } from '@open-northland/data';
import type { CatalogSnapshot } from './catalog/snapshot.js';
import { bytesBody, jsonBody } from './catalog/snapshot.js';
import type { Log } from './catalog/thumbnails.js';
import { ArchiveVerificationBusyError } from './conversion/archive-verifier.js';
import { serveContent, serveKeptFile } from './http/files.js';
import { pathOf, send, sendError, V1_HEADERS } from './http/response.js';
import type { ContentSource, KeptFileSource } from './http/sources.js';
import type { NewsFile } from './news/news-file.js';
import { type ReportEndpoint, type ReportsHealth, reportTargetOf } from './reports/endpoint.js';
import type { DataStore } from './store.js';

export const HEALTH_PATH = '/healthz';
const CATALOG_PATH = '/v1/catalog';
const NEWS_PATH = '/v1/news';
const MAP_PATH = /^\/v1\/maps\/([^/]+)(?:\/(thumbnail|file))?$/;
const CONTENT_PATH = /^\/v1\/content\/([^/]+)\/maps\/([^/]+)$/;
const CATALOG_CACHE = 'public, max-age=300';
const THUMBNAIL_CACHE = 'public, max-age=86400';
const NEWS_MAX_AGE_SECONDS = 60;
const NEWS_CACHE = `public, max-age=${NEWS_MAX_AGE_SECONDS}`;
const MS_PER_SECOND = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 5000;
/** How often Node enforces the two timeouts above; its 30-second default lets a slow body hold a
 *  report upload slot for that long. */
const TIMEOUT_CHECK_INTERVAL_MS = 1000;
const OK = 200;
const NO_CONTENT = 204;
/** How long a browser may reuse a `/v1` preflight answer. */
const PREFLIGHT_MAX_AGE_SECONDS = 86_400;
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
const INTERNAL_ERROR = 500;
const UNAVAILABLE = 503;

/** The health endpoint's body. */
export interface ApiHealth {
  readonly ok: boolean;
  readonly build: string | null;
  readonly gameVersion: string | null;
  readonly lastSyncAt: string | null;
  readonly staleSeconds: number | null;
  readonly entryCount: number;
  /** Entries by conversion verdict in the served catalogue. */
  readonly converted: number;
  readonly pending: number;
  readonly failed: number;
  /** Bug report intake; null when the server takes no reports. */
  readonly reports: ReportsHealth | null;
}

export interface ApiServerOptions {
  /** 0 picks a free port; read it back from the server. */
  readonly port: number;
  readonly host?: string | null;
  readonly build?: string | null;
  /** Sent with the catalogue, so a game of another release can name the one the maps are for. */
  readonly gameVersion?: string | null;
  readonly store: DataStore;
  /** Serves `/v1/content/<irVersion>/maps/*`; without it every content request is a 404. */
  readonly content?: ContentSource;
  /** Serves `/v1/maps/<id>/file`; without it every file request is a 404. */
  readonly files?: KeptFileSource;
  /** Takes `POST /v1/reports[/<id>]`; without it those paths answer like any other `/v1` route. */
  readonly reports?: ReportEndpoint;
  /** Serves `/v1/news`; without it that path answers like an unknown `/v1` route. */
  readonly news?: Pick<NewsFile, 'current'>;
  readonly log?: Log;
  readonly now?: () => Date;
}

export interface ApiServer {
  readonly port: number;
  /** Replaces the served catalogue; a sync calls it after each good run. */
  publish(snapshot: CatalogSnapshot): void;
  health(): ApiHealth;
  close(): Promise<void>;
}

/** Serve the catalogue over plain HTTP. */
export function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const build = options.build ?? null;
  const gameVersion = options.gameVersion ?? null;
  let snapshot: CatalogSnapshot | null = null;

  const health = (): ApiHealth => ({
    ok: snapshot !== null,
    build,
    gameVersion,
    lastSyncAt: snapshot?.syncedAt.toISOString() ?? null,
    staleSeconds:
      snapshot === null
        ? null
        : Math.max(0, Math.floor((now().getTime() - snapshot.syncedAt.getTime()) / MS_PER_SECOND)),
    entryCount: snapshot?.entries.size ?? 0,
    converted: snapshot?.conversions.converted ?? 0,
    pending: snapshot?.conversions.pending ?? 0,
    failed: snapshot?.conversions.failed ?? 0,
    reports: options.reports?.health() ?? null,
  });

  const serveThumbnail = async (
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ): Promise<void> => {
    const stored = snapshot?.entries.has(id) ? await options.store.readThumbnail(id) : null;
    if (stored === null) {
      sendError(request, response, NOT_FOUND, 'no thumbnail', V1_HEADERS);
      return;
    }
    send(request, response, OK, bytesBody(stored.bytes), {
      ...V1_HEADERS,
      'cache-control': THUMBNAIL_CACHE,
      'content-type': stored.contentType,
      'x-content-type-options': 'nosniff',
    });
  };

  const serveV1 = async (request: IncomingMessage, response: ServerResponse, path: string): Promise<void> => {
    const content = CONTENT_PATH.exec(path);
    if (content?.[1] !== undefined && content[2] !== undefined) {
      await serveContent(options.content, request, response, content[1], content[2]);
      return;
    }
    if (path === NEWS_PATH && options.news !== undefined) {
      send(request, response, OK, await options.news.current(), {
        ...V1_HEADERS,
        'cache-control': NEWS_CACHE,
      });
      return;
    }
    if (snapshot === null) {
      sendError(request, response, UNAVAILABLE, 'catalogue not synced yet', V1_HEADERS);
      return;
    }
    const headers = { ...V1_HEADERS, 'cache-control': CATALOG_CACHE };
    if (path === CATALOG_PATH) {
      const named = gameVersion === null ? {} : { [CATALOG_GAME_VERSION_HEADER]: gameVersion };
      send(request, response, OK, snapshot.catalog, { ...headers, ...named });
      return;
    }
    const match = MAP_PATH.exec(path);
    const id = match?.[1];
    if (id === undefined || !CATALOG_MAP_ID.test(id)) {
      sendError(request, response, NOT_FOUND, 'not found', V1_HEADERS);
      return;
    }
    if (match?.[2] === 'thumbnail') {
      await serveThumbnail(request, response, id);
      return;
    }
    if (match?.[2] === 'file') {
      const abort = new AbortController();
      const disconnected = (): void => abort.abort();
      response.once('close', disconnected);
      if (response.destroyed) abort.abort();
      try {
        const kept = snapshot.entries.has(id)
          ? ((await options.files?.keptFile(id, abort.signal)) ?? null)
          : null;
        if (abort.signal.aborted) await kept?.handle.close();
        else await serveKeptFile(kept, request, response);
      } finally {
        response.off('close', disconnected);
      }
      return;
    }
    const entry = snapshot.entries.get(id);
    if (entry === undefined) sendError(request, response, NOT_FOUND, 'no such map', V1_HEADERS);
    else send(request, response, OK, entry, headers);
  };

  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = pathOf(request);
    const v1 = path.startsWith('/v1/');
    const reportTarget = options.reports === undefined ? null : reportTargetOf(path);
    if (reportTarget !== null && options.reports !== undefined) {
      if (request.method === 'POST') await options.reports.handle(request, response, reportTarget);
      else if (request.method === 'OPTIONS') options.reports.preflight(request, response);
      else sendError(request, response, METHOD_NOT_ALLOWED, 'method not allowed', { allow: 'POST, OPTIONS' });
      return;
    }
    if (request.method === 'OPTIONS' && v1) {
      // A browser preflights a request whose `If-None-Match` it set itself.
      response
        .writeHead(NO_CONTENT, {
          ...V1_HEADERS,
          'access-control-allow-methods': 'GET, HEAD',
          'access-control-allow-headers': 'If-None-Match',
          'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
        })
        .end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(request, response, METHOD_NOT_ALLOWED, 'method not allowed', {
        allow: 'GET, HEAD',
        ...(v1 ? V1_HEADERS : {}),
      });
      return;
    }
    if (path === HEALTH_PATH) {
      const report = health();
      send(request, response, report.ok ? OK : UNAVAILABLE, jsonBody(report), {
        'cache-control': 'no-store',
      });
      return;
    }
    if (v1) {
      await serveV1(request, response, path);
      return;
    }
    sendError(request, response, NOT_FOUND, 'not found');
  };

  const server: Server = createServer(
    {
      headersTimeout: HEADERS_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
      connectionsCheckingInterval: TIMEOUT_CHECK_INTERVAL_MS,
    },
    (request, response) => {
      // A fault in one request costs that request, never the server.
      serve(request, response).catch((error: unknown) => {
        log('request failed', { error: String(error) });
        if (response.destroyed) return;
        if (!response.headersSent) {
          const busy = error instanceof ArchiveVerificationBusyError;
          sendError(
            request,
            response,
            busy ? UNAVAILABLE : INTERNAL_ERROR,
            busy ? error.message : 'internal error',
            {
              ...(pathOf(request).startsWith('/v1/') ? V1_HEADERS : {}),
              ...(busy ? { 'retry-after': '1' } : {}),
            },
          );
        } else response.end();
      });
    },
  );

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? undefined, () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      log('listening', { port, host: options.host ?? null, build });
      resolve({
        port,
        publish: (next) => {
          snapshot = next;
        },
        health,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
