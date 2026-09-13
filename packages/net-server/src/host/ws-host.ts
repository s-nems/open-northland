import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_REPLACED,
  MAX_BLOB_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@open-northland/net-protocol';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { type Connection, DEFAULT_MAX_ROOMS, Relay, type RelayLog } from '../relay/relay.js';
import { DEFAULT_MAX_CONNECTIONS, RecoveryBudget, SocketBudget, sendBounded } from './socket-budget.js';

/** How often the relay clock is polled; a small fraction of a frame at the highest speed. */
const POLL_INTERVAL_MS = 5;
/** RFC 6455 close code for a relay fault, after which a client may reconnect. */
const CLOSE_INTERNAL_ERROR = 1011;
/** The close frame's reason field holds at most 123 bytes; a longer reason is replaced, since `ws`
 *  throws on it and the `error` message already carried the detail. */
const MAX_CLOSE_REASON_BYTES = 123;
const CLOSE_REASON_FALLBACK = 'protocol violation';
export const HEALTH_PATH = '/healthz';
const MS_PER_SECOND = 1000;
const HTTP_CONNECTION_HEADROOM = 16;
/** A connection that has sent nothing for this long is dead to the relay, whose ping it answers every
 *  second while alive; closing it lets the seat be waited for and the token return on a new socket. */
export const SILENT_SOCKET_MS = 30_000;
const SILENCE_CHECK_MS = 5000;
/** TCP keepalive so a peer that vanished without a FIN is noticed by the kernel as well. */
const TCP_KEEPALIVE_MS = 10_000;

export interface RelayHostOptions {
  /** 0 picks a free port; read it back from the host. */
  readonly port: number;
  readonly host?: string | null;
  readonly log?: RelayLog;
  readonly maxRooms?: number;
  readonly maxConnections?: number;
  readonly publicUrl?: string | null;
  readonly build?: string | null;
}

/** The health endpoint's body: the relay is up, what it speaks, and how busy it is. */
export interface RelayHealth {
  readonly ok: true;
  readonly protocol: number;
  readonly build: string | null;
  readonly url: string | null;
  readonly rooms: number;
  readonly clients: number;
  readonly uptimeSeconds: number;
}

export interface RelayHost {
  readonly port: number;
  readonly relay: Relay;
  health(): RelayHealth;
  close(): Promise<void>;
}

function byteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, chunk) => sum + chunk.length, 0);
  return data instanceof ArrayBuffer ? data.byteLength : data.length;
}

/** The request target up to its query, taken as text: a URL parser would refuse targets the HTTP
 *  parser accepts, and nothing here needs more than the path. */
function pathOf(request: IncomingMessage): string {
  return (request.url ?? '/').split('?', 1)[0] ?? '/';
}

/** Plain HTTP beside the WebSocket upgrade: the health check, and a miss for everything else. */
function serveHttp(request: IncomingMessage, response: ServerResponse, health: () => RelayHealth): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  if (pathOf(request) === HEALTH_PATH) {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(health()));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found\n');
}

/** Serve the relay over WebSockets with JSON text frames, and its health over plain HTTP. */
export function startRelayHost(options: RelayHostOptions): Promise<RelayHost> {
  const log = options.log ?? (() => undefined);
  const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const relay = new Relay({ log, maxRooms });
  const startedAt = performance.now();
  const health = (): RelayHealth => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    build: options.build ?? null,
    url: options.publicUrl ?? null,
    rooms: relay.roomCount,
    clients: relay.clientCount,
    uptimeSeconds: Math.floor((performance.now() - startedAt) / MS_PER_SECOND),
  });
  // A broadcast hands every member the same object; it is serialised once.
  const encoded = new WeakMap<ServerMessage, string>();
  const encode = (message: ServerMessage): string => {
    const known = encoded.get(message);
    if (known !== undefined) return known;
    const text = JSON.stringify(message);
    encoded.set(message, text);
    return text;
  };
  const server = createServer(
    {
      headersTimeout: 5000,
      requestTimeout: 10_000,
      connectionsCheckingInterval: 1000,
    },
    (request, response) => {
      // A fault in one request costs that request, never the rooms.
      try {
        serveHttp(request, response, health);
      } catch (err) {
        log('request failed', { error: String(err) });
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    },
  );
  // HTTP sockets awaiting upgrade are outside WebSocketServer.clients.
  server.maxConnections = maxConnections + HTTP_CONNECTION_HEADROOM;
  server.setTimeout(10_000);
  server.maxRequestsPerSocket = 100;
  const socketOptions = {
    noServer: true,
    maxPayload: MAX_BLOB_MESSAGE_BYTES,
    perMessageDeflate: false,
    autoPong: false,
    closeTimeout: 1000,
  };
  const sockets = new WebSocketServer(socketOptions);
  const lastHeardAt = new Map<WebSocket, number>();
  server.on('upgrade', (request, socket, head) => {
    if (sockets.clients.size >= maxConnections) {
      socket.on('error', () => socket.destroy());
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (socket instanceof Socket) socket.setKeepAlive(true, TCP_KEEPALIVE_MS);
    sockets.handleUpgrade(request, socket, head, (peer) => sockets.emit('connection', peer, request));
  });
  sockets.on('connection', (socket) => {
    const budget = new SocketBudget(performance.now());
    const recovery = new RecoveryBudget(performance.now());
    lastHeardAt.set(socket, performance.now());
    const heard = (): void => {
      lastHeardAt.set(socket, performance.now());
    };
    const connection: Connection = {
      send: (message) => {
        sendBounded(socket, encode(message));
      },
      close: (reason) => {
        const code = reason === 'replaced' ? CLOSE_REPLACED : CLOSE_PROTOCOL_ERROR;
        socket.close(
          code,
          Buffer.byteLength(reason) <= MAX_CLOSE_REASON_BYTES ? reason : CLOSE_REASON_FALLBACK,
        );
      },
    };
    const client = relay.connect(connection);
    const refuseTraffic = (): void => {
      socket.close(CLOSE_PROTOCOL_ERROR, 'relay traffic limit');
      relay.disconnect(client);
    };
    const acceptTraffic = (bytes: number): boolean => {
      if (socket.readyState !== socket.OPEN) return false;
      if (budget.take(bytes, performance.now())) return true;
      refuseTraffic();
      return false;
    };
    socket.on('ping', (data) => {
      heard();
      if (acceptTraffic(data.length)) socket.pong(data);
    });
    socket.on('pong', (data) => {
      heard();
      acceptTraffic(data.length);
    });
    socket.on('message', (data, isBinary) => {
      heard();
      if (!acceptTraffic(byteLength(data))) return;
      // Anything but a JSON text frame is handed over as a value no message parses, which closes the
      // connection through the relay's own refusal path.
      let raw: unknown = null;
      if (!isBinary) {
        try {
          raw = JSON.parse(data.toString());
        } catch {
          raw = null;
        }
      }
      if (!recovery.take(raw, performance.now())) {
        refuseTraffic();
        return;
      }
      // A relay fault costs the one connection that triggered it, never the other rooms.
      try {
        relay.receive(client, raw, byteLength(data));
      } catch (err) {
        log('receive failed', { error: String(err) });
        socket.close(CLOSE_INTERNAL_ERROR, 'relay fault');
      }
    });
    // A fault in departure handling costs the one room it hit, never the process.
    socket.on('close', () => {
      lastHeardAt.delete(socket);
      try {
        relay.disconnect(client);
      } catch (err) {
        log('disconnect failed', { error: String(err) });
      }
    });
    // `ws` closes the socket itself after a protocol error; a transport error is followed by `close`.
    socket.on('error', (err) => log('socket error', { error: String(err) }));
  });
  const poll = setInterval(() => {
    try {
      relay.advance();
    } catch (err) {
      log('advance failed', { error: String(err) });
    }
  }, POLL_INTERVAL_MS);
  const silence = setInterval(() => {
    const now = performance.now();
    for (const [socket, at] of lastHeardAt) {
      if (now - at >= SILENT_SOCKET_MS) socket.terminate();
    }
  }, SILENCE_CHECK_MS);
  return new Promise((resolve, reject) => {
    const failToStart = (err: Error): void => {
      clearInterval(poll);
      clearInterval(silence);
      reject(err);
    };
    server.once('error', failToStart);
    server.once('listening', () => {
      // Past the start, a server error (an accept that failed) is logged and the relay keeps running.
      server.off('error', failToStart);
      server.on('error', (err) => log('server error', { error: String(err) }));
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the relay host did not bind a TCP port'));
        return;
      }
      const port = address.port;
      log('listening', {
        port,
        url: options.publicUrl ?? null,
        protocol: PROTOCOL_VERSION,
        build: options.build ?? null,
        maxRooms,
        maxConnections,
      });
      resolve({
        port,
        relay,
        health,
        close: () => {
          clearInterval(poll);
          clearInterval(silence);
          for (const socket of sockets.clients) socket.terminate();
          sockets.close();
          server.closeAllConnections();
          return new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
    if (options.host === undefined || options.host === null) server.listen(options.port);
    else server.listen(options.port, options.host);
  });
}
