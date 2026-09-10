import { MAX_BLOB_MESSAGE_BYTES, type ServerMessage } from '@open-northland/net-protocol';
import { type RawData, WebSocketServer } from 'ws';
import { type Connection, Relay, type RelayLog } from '../relay/relay.js';

/** How often the relay clock is polled; a small fraction of a frame at the highest speed. */
const POLL_INTERVAL_MS = 5;
/** RFC 6455 close codes: a protocol violation, an internal error, and the private range for a
 *  superseded connection. */
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_REPLACED = 4000;
/** The close frame's reason field holds at most 123 bytes; a longer reason is replaced, since `ws`
 *  throws on it and the `error` message already carried the detail. */
const MAX_CLOSE_REASON_BYTES = 123;
const CLOSE_REASON_FALLBACK = 'protocol violation';

export interface RelayHostOptions {
  /** 0 picks a free port; read it back from the host. */
  readonly port: number;
  readonly host?: string;
  readonly log?: RelayLog;
}

export interface RelayHost {
  readonly port: number;
  readonly relay: Relay;
  close(): Promise<void>;
}

function byteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, chunk) => sum + chunk.length, 0);
  return data instanceof ArrayBuffer ? data.byteLength : data.length;
}

/** Serve the relay over WebSockets with JSON text frames. */
export function startRelayHost(options: RelayHostOptions): Promise<RelayHost> {
  const log = options.log ?? (() => undefined);
  const relay = new Relay({ log });
  // A broadcast hands every member the same object; it is serialised once.
  const encoded = new WeakMap<ServerMessage, string>();
  const encode = (message: ServerMessage): string => {
    const known = encoded.get(message);
    if (known !== undefined) return known;
    const text = JSON.stringify(message);
    encoded.set(message, text);
    return text;
  };
  const server = new WebSocketServer({
    port: options.port,
    ...(options.host !== undefined ? { host: options.host } : {}),
    maxPayload: MAX_BLOB_MESSAGE_BYTES,
  });
  server.on('connection', (socket) => {
    const connection: Connection = {
      send: (message) => {
        if (socket.readyState === socket.OPEN) socket.send(encode(message));
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
    socket.on('message', (data, isBinary) => {
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
      // A relay fault costs the one connection that triggered it, never the other rooms.
      try {
        relay.receive(client, raw, byteLength(data));
      } catch (err) {
        log('receive failed', { error: String(err) });
        socket.close(CLOSE_INTERNAL_ERROR, 'relay fault');
      }
    });
    socket.on('close', () => relay.disconnect(client));
    socket.on('error', () => socket.terminate());
  });
  const poll = setInterval(() => {
    try {
      relay.advance();
    } catch (err) {
      log('advance failed', { error: String(err) });
    }
  }, POLL_INTERVAL_MS);
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      clearInterval(poll);
      reject(err);
    });
    server.once('listening', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the relay host did not bind a TCP port'));
        return;
      }
      const port = address.port;
      log('listening', { port });
      resolve({
        port,
        relay,
        close: () => {
          clearInterval(poll);
          for (const socket of server.clients) socket.terminate();
          return new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
  });
}
