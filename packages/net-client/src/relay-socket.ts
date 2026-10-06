import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_REPLACED,
  CLOSE_SERVICE_RESTART,
  type ClientMessage,
  type ClosingCode,
} from '@open-northland/net-protocol';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** The relay pings once a second; match its tolerance for a silent peer. */
const SILENT_TIMEOUT_MS = 30_000;
const FINAL_CLOSE_CODES: readonly number[] = [CLOSE_REPLACED, CLOSE_PROTOCOL_ERROR];
/** A restarted relay has forgotten every room, so reconnecting to one would only be refused. The
 *  reason tells the relay's own restart from a proxy's, after which the relay may still be there. */
const SERVER_RESTART: ClosingCode = 'serverRestart';

function finalClose(event: CloseEvent): boolean {
  if (FINAL_CLOSE_CODES.includes(event.code)) return true;
  return event.code === CLOSE_SERVICE_RESTART && event.reason === SERVER_RESTART;
}

/** What a relay link reports to its owner. */
export interface RelayLinkEvents {
  /** Runs on every (re)connection; the client introduces itself again from here. */
  readonly onOpen: () => void;
  readonly onMessage: (raw: unknown) => void;
  /** Runs once the link will not reopen: closed here, replaced, refused or restarted by the relay. */
  readonly onClosed: (reason: string) => void;
  readonly onRetry?: (attempt: number, inMs: number) => void;
}

/** A connection to the relay that carries client messages out and reports through `RelayLinkEvents`. */
export interface RelayLink {
  readonly connected: boolean;
  /** False when nothing is connected; the message is dropped, since the client says everything that
   *  matters again once it is back. */
  send(message: ClientMessage): boolean;
  close(): void;
}

export interface RelaySocketOptions extends RelayLinkEvents {
  readonly url: string;
  readonly createSocket?: (url: string) => WebSocket;
}

/** One relay connection that comes back on its own after a drop, with the same identity. */
export class RelaySocket implements RelayLink {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private lastReceivedAt = 0;
  private closed = false;
  private readonly options: RelaySocketOptions;

  constructor(options: RelaySocketOptions) {
    this.options = options;
    this.open();
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === this.socket.OPEN;
  }

  send(message: ClientMessage): boolean {
    if (!this.connected || this.socket === null) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.clearDeadline();
    this.socket?.close();
    this.socket = null;
    this.options.onClosed('closed');
  }

  private open(): void {
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    this.watch(socket, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.closed || this.socket !== socket) return;
      this.lastReceivedAt = performance.now();
      this.watch(socket, SILENT_TIMEOUT_MS);
      this.attempt = 0;
      this.options.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.closed || this.socket !== socket) return;
      if (typeof event.data !== 'string') return;
      let raw: unknown = null;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      this.lastReceivedAt = performance.now();
      this.options.onMessage(raw);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.clearDeadline();
      this.socket = null;
      if (this.closed) return;
      if (finalClose(event)) {
        this.closed = true;
        this.options.onClosed(event.reason === '' ? `closed with code ${event.code}` : event.reason);
        return;
      }
      this.scheduleRetry();
    };
    // A failed attempt is followed by a close event, where the retry is scheduled.
    socket.onerror = () => undefined;
  }

  private clearDeadline(): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
  }

  private watch(socket: WebSocket, ms: number): void {
    this.clearDeadline();
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.closed || this.socket !== socket) return;
      if (socket.readyState === socket.OPEN) {
        const remaining = SILENT_TIMEOUT_MS - (performance.now() - this.lastReceivedAt);
        if (remaining > 0) {
          this.watch(socket, remaining);
          return;
        }
      }
      // A broken link may never finish its close handshake. Detach it before retrying so queued
      // events cannot act on the replacement connection.
      this.socket = null;
      socket.close();
      this.scheduleRetry();
    }, ms);
  }

  private scheduleRetry(): void {
    const inMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempt);
    this.attempt++;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (!this.closed) this.open();
    }, inMs);
    this.options.onRetry?.(this.attempt, inMs);
  }
}
