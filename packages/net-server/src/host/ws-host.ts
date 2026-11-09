import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_REPLACED,
  CLOSE_SERVICE_RESTART,
  type ClosingCode,
  MAX_BLOB_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type RelayReason,
  type RelayReasonCode,
  type ServerMessage,
} from '@open-northland/net-protocol';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { type Connection, type ConnectionEnd, DEFAULT_MAX_ROOMS, Relay } from '../relay/relay.js';
import { faultFields, printable, type RelayLog } from '../relay/relay-log.js';
import { type HallFile, hallFile } from './hall-file.js';
import {
  ControlPings,
  DEFAULT_MAX_CONNECTIONS,
  type EncodedMessage,
  encodeText,
  RecoveryBudget,
  SocketBudget,
  sendBounded,
} from './socket-budget.js';

/** How often the relay clock is polled; a small fraction of a frame at the highest speed. */
const POLL_INTERVAL_MS = 5;
/** RFC 6455 close code for a relay fault, after which a client may reconnect. */
const CLOSE_INTERNAL_ERROR = 1011;
/** Buffered valid traffic can exceed a burst budget; reconnecting can resume the same seat. */
const CLOSE_TRY_AGAIN_LATER = 1013;
/** Close reasons are relay reason codes, which a client words in its own language. */
const TRAFFIC_LIMIT: ClosingCode = 'trafficLimit';
const RELAY_FAULT: RelayReasonCode = 'relayFault';
const RETRY_TOO_SOON: RelayReason = { code: 'retryTooSoon' };
const SERVER_RESTART: ClosingCode = 'serverRestart';
export const HEALTH_PATH = '/healthz';
const MS_PER_SECOND = 1000;
const BYTES_PER_MIB = 1024 * 1024;
const HTTP_CONNECTION_HEADROOM = 16;
/** A connection that has sent nothing for this long is dead to the relay, whose ping it answers every
 *  second while alive; closing it lets the seat be waited for and the token return on a new socket. */
export const SILENT_SOCKET_MS = 30_000;
/** The log's cause for a socket closed by `SILENT_SOCKET_MS`. */
const SILENT_SOCKET = 'silentSocket';
/** The log's cause for a socket closed because what it was sent outgrew `MAX_BUFFERED_BYTES` unread. */
const SEND_BACKLOG = 'sendBacklog';
/** RFC 6455 bounds a close reason to 123 bytes; the log keeps at most as many characters. */
const MAX_CLOSE_REASON_LENGTH = 123;
const SILENCE_CHECK_MS = 5000;
/** TCP keepalive so a peer that vanished without a FIN is noticed by the kernel as well. */
const TCP_KEEPALIVE_MS = 10_000;
/** HTTP limits for the health check and upgrade requests; a game connection lives on the WebSocket. */
const HTTP_HEADERS_TIMEOUT_MS = 5000;
const HTTP_REQUEST_TIMEOUT_MS = 10_000;
const HTTP_CONNECTION_CHECK_MS = 1000;
const HTTP_SOCKET_TIMEOUT_MS = 10_000;
const MAX_REQUESTS_PER_SOCKET = 100;
/** How long a closing WebSocket waits for the peer's close frame before the socket is destroyed. */
const WS_CLOSE_TIMEOUT_MS = 1000;

export interface RelayHostOptions {
  /** 0 picks a free port; read it back from the host. */
  readonly port: number;
  readonly host?: string | null;
  readonly log?: RelayLog;
  readonly maxRooms?: number;
  readonly maxConnections?: number;
  readonly publicUrl?: string | null;
  readonly build?: string | null;
  /** The file the hall is kept in across restarts; absent or null keeps it in memory only. */
  readonly hallFile?: string | null;
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

/** The player's address: the proxy's `X-Forwarded-For` when it set one, which the deployed proxies
 *  replace rather than extend, otherwise the socket's peer. A client reaching the relay directly can
 *  forge the header, and with it escape the per-address chat and password allowances and a room's
 *  address ban; its token ban still holds. */
function peerAddress(request: IncomingMessage): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').at(-1)?.trim();
  return last !== undefined && last !== '' ? last : request.socket.remoteAddress;
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
  const hallPath = options.hallFile ?? null;
  const hall: HallFile | null = hallPath === null ? null : hallFile(hallPath, () => relay.hallRecord(), log);
  const relay: Relay = new Relay({
    log,
    maxRooms,
    build: options.build ?? null,
    hostStatus: () => ({ rssMib: Math.round(process.memoryUsage.rss() / BYTES_PER_MIB) }),
    hall: hall?.initial ?? null,
    hallChanged: () => hall?.changed(),
  });
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
  const encoded = new WeakMap<ServerMessage, EncodedMessage>();
  const encode = (message: ServerMessage): EncodedMessage => {
    const known = encoded.get(message);
    if (known !== undefined) return known;
    const body = encodeText(JSON.stringify(message));
    encoded.set(message, body);
    return body;
  };
  const server = createServer(
    {
      headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
      requestTimeout: HTTP_REQUEST_TIMEOUT_MS,
      connectionsCheckingInterval: HTTP_CONNECTION_CHECK_MS,
    },
    (request, response) => {
      // A fault in one request costs that request, never the rooms.
      try {
        serveHttp(request, response, health);
      } catch (err) {
        log('request failed', faultFields(err));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    },
  );
  // HTTP sockets awaiting upgrade are outside WebSocketServer.clients.
  server.maxConnections = maxConnections + HTTP_CONNECTION_HEADROOM;
  server.setTimeout(HTTP_SOCKET_TIMEOUT_MS);
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
  const socketOptions = {
    noServer: true,
    maxPayload: MAX_BLOB_MESSAGE_BYTES,
    perMessageDeflate: false,
    autoPong: false,
    closeTimeout: WS_CLOSE_TIMEOUT_MS,
  };
  const sockets = new WebSocketServer(socketOptions);
  const lastHeardAt = new Map<WebSocket, number>();
  /** Sockets the host terminated, which close as a dropped link would, and why. */
  const terminated = new WeakMap<WebSocket, string>();
  server.on('upgrade', (request, socket, head) => {
    if (sockets.clients.size >= maxConnections) {
      relay.connectionRefused();
      socket.on('error', () => socket.destroy());
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (socket instanceof Socket) socket.setKeepAlive(true, TCP_KEEPALIVE_MS);
    sockets.handleUpgrade(request, socket, head, (peer) => sockets.emit('connection', peer, request));
  });
  sockets.on('connection', (socket, request) => {
    const budget = new SocketBudget(performance.now());
    const recovery = new RecoveryBudget(performance.now());
    const controlPings = new ControlPings();
    const ping = (): void => {
      const challenge = controlPings.request();
      if (challenge !== null) socket.ping(challenge);
    };
    lastHeardAt.set(socket, performance.now());
    const heard = (): void => {
      lastHeardAt.set(socket, performance.now());
    };
    // Whether a frame is still arriving: bytes counted before `ws` parses a chunk, cleared by each frame
    // it completes. A chunk that ends one frame and starts the next reads as none until the next chunk.
    let unparsedBytes = 0;
    const countBytes = (data: Buffer): void => {
      unparsedBytes += data.length;
    };
    const frameEnded = (): void => {
      unparsedBytes = 0;
    };
    // A browser's upload may take longer than the silence limits before one whole message arrives.
    const receivedBytes = (data: Buffer): void => {
      if (data.length === 0 || socket.readyState !== socket.OPEN) return;
      heard();
      try {
        relay.receiving(client, unparsedBytes);
      } catch (err) {
        log('receiving failed', faultFields(err));
      }
    };
    request.socket.prependListener('data', countBytes);
    request.socket.on('data', receivedBytes);
    // From a fragmented send until the client has answered every control ping, so read it all.
    let downloadInFlight = false;
    const reportDownload = (inFlight: boolean): void => {
      downloadInFlight = inFlight;
      try {
        relay.sending(client, inFlight);
      } catch (err) {
        log('sending failed', faultFields(err));
      }
    };
    const address = peerAddress(request);
    const connection: Connection = {
      ...(address === undefined ? {} : { address }),
      send: (message) => {
        const open = socket.readyState === socket.OPEN;
        if (sendBounded(socket, encode(message), ping) && !downloadInFlight) reportDownload(true);
        if (open && socket.readyState !== socket.OPEN) terminated.set(socket, SEND_BACKLOG);
      },
      close: (reason) => {
        socket.close(reason === 'replaced' ? CLOSE_REPLACED : CLOSE_PROTOCOL_ERROR, reason);
      },
    };
    const client = relay.connect(connection);
    let transportError: string | undefined;
    let closed = false;
    const disconnect = (end: ConnectionEnd): void => {
      try {
        relay.disconnect(client, end);
      } catch (err) {
        log('disconnect failed', faultFields(err));
      }
    };
    const refuseTraffic = (): void => {
      socket.close(CLOSE_TRY_AGAIN_LATER, TRAFFIC_LIMIT);
      disconnect({ code: CLOSE_TRY_AGAIN_LATER, cause: TRAFFIC_LIMIT });
    };
    const acceptTraffic = (bytes: number, messageCost: 0 | 1 = 1): boolean => {
      if (socket.readyState !== socket.OPEN) return false;
      if (budget.take(bytes, performance.now(), messageCost)) return true;
      refuseTraffic();
      return false;
    };
    socket.on('ping', (data) => {
      frameEnded();
      heard();
      if (acceptTraffic(data.length)) socket.pong(data);
    });
    // The host pings between the fragments of a large message: an answer says the client has read
    // that far, while the relay's own pings still wait behind the rest.
    socket.on('pong', (data) => {
      frameEnded();
      heard();
      const answered = controlPings.answer(data);
      if (!acceptTraffic(data.length, answered ? 0 : 1) || !answered) return;
      try {
        relay.downloading(client);
      } catch (err) {
        log('downloading failed', faultFields(err));
      }
      if (downloadInFlight && controlPings.settled) reportDownload(false);
    });
    socket.on('message', (data, isBinary) => {
      frameEnded();
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
      const recoveryVerdict = recovery.take(raw, performance.now());
      if (recoveryVerdict === 'close') {
        refuseTraffic();
        return;
      }
      // A relay fault costs the one connection that triggered it, never the other rooms.
      try {
        if (recoveryVerdict === 'refuse') relay.refuse(client, raw, RETRY_TOO_SOON);
        else relay.receive(client, raw, byteLength(data));
      } catch (err) {
        log('receive failed', faultFields(err));
        socket.close(CLOSE_INTERNAL_ERROR, RELAY_FAULT);
        disconnect({ code: CLOSE_INTERNAL_ERROR, cause: RELAY_FAULT });
      }
    });
    // A fault in departure handling is logged; it never reaches the process.
    socket.on('close', (code, reason) => {
      closed = true;
      request.socket.off('data', countBytes);
      request.socket.off('data', receivedBytes);
      lastHeardAt.delete(socket);
      const cause = terminated.get(socket);
      disconnect({
        code,
        reason: printable(reason.toString(), MAX_CLOSE_REASON_LENGTH),
        ...(cause === undefined ? {} : { cause }),
        ...(transportError === undefined ? {} : { error: transportError }),
      });
    });
    // `ws` closes the socket itself after a protocol error, and a transport error is followed by `close`:
    // the error goes out on that connection's disconnect line.
    socket.on('error', (err) => {
      if (closed) log('socket error', { error: String(err) });
      else transportError ??= String(err);
    });
  });
  const poll = setInterval(() => {
    try {
      relay.advance();
    } catch (err) {
      log('advance failed', faultFields(err));
    }
  }, POLL_INTERVAL_MS);
  const silence = setInterval(() => {
    const now = performance.now();
    for (const [socket, at] of lastHeardAt) {
      if (now - at < SILENT_SOCKET_MS) continue;
      terminated.set(socket, SILENT_SOCKET);
      socket.terminate();
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
          try {
            relay.stop();
          } catch (err) {
            log('stop failed', faultFields(err));
          }
          const saved = hall?.flush();
          // Rooms live in memory and end here; the close code tells a client not to wait for them.
          // `closeTimeout` bounds a client that never answers the close.
          for (const socket of sockets.clients) socket.close(CLOSE_SERVICE_RESTART, SERVER_RESTART);
          sockets.close();
          server.closeAllConnections();
          const closed = new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done())));
          return Promise.all([saved, closed]).then(() => undefined);
        },
      });
    });
    if (options.host === undefined || options.host === null) server.listen(options.port);
    else server.listen(options.port, options.host);
  });
}
