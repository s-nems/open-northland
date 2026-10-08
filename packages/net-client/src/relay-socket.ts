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
/** An open link on which no relay message arrived for this long is quiet: the relay pings every second,
 *  and judges a client silent after this long without an answer, so the room has most likely stopped
 *  hearing this client at the same moment. The socket stays open: a large message still arriving
 *  looks the same, and a route that fell away may come back under it. */
export const LINK_QUIET_MS = 4000;
const QUIET_POLL_MS = 1000;
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
  /** The link dropped and reopens in `inMs`; `quietMs` is how long no relay message had arrived. */
  readonly onRetry?: (attempt: number, inMs: number, quietMs: number) => void;
  /** The open link has carried nothing from the relay for `quietMs` ({@link LINK_QUIET_MS} or more). */
  readonly onQuiet?: (quietMs: number) => void;
  /** The relay was heard again on a link reported quiet. */
  readonly onHeard?: () => void;
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
  /** Monotonic milliseconds; default `performance.now`. */
  readonly now?: () => number;
}

/** One relay connection that comes back on its own after a drop, with the same identity. */
export class RelaySocket implements RelayLink {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private quietPoll: ReturnType<typeof setInterval> | null = null;
  private quiet = false;
  /** When the relay was last heard on the current socket, or the attempt began. */
  private heardAt: number;
  private closed = false;
  private readonly options: RelaySocketOptions;
  private readonly now: () => number;

  constructor(options: RelaySocketOptions) {
    this.options = options;
    this.now = options.now ?? ((): number => performance.now());
    this.heardAt = this.now();
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
    this.stopQuietWatch();
    this.socket?.close();
    this.socket = null;
    this.options.onClosed('closed');
  }

  private open(): void {
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    this.heardAt = this.now();
    this.watchOpening(socket);
    socket.onopen = () => {
      if (this.closed || this.socket !== socket) return;
      this.clearDeadline();
      this.attempt = 0;
      this.heardAt = this.now();
      this.watchQuiet(socket);
      this.options.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.closed || this.socket !== socket) return;
      this.heard();
      if (typeof event.data !== 'string') return;
      let raw: unknown = null;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      this.options.onMessage(raw);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.clearDeadline();
      this.stopQuietWatch();
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

  private heard(): void {
    this.heardAt = this.now();
    if (!this.quiet) return;
    this.quiet = false;
    this.options.onHeard?.();
  }

  private watchQuiet(socket: WebSocket): void {
    this.stopQuietWatch();
    this.quietPoll = setInterval(() => {
      if (this.closed || this.socket !== socket) {
        this.stopQuietWatch();
        return;
      }
      const quietMs = this.now() - this.heardAt;
      if (this.quiet || quietMs < LINK_QUIET_MS) return;
      this.quiet = true;
      this.options.onQuiet?.(quietMs);
    }, QUIET_POLL_MS);
  }

  /** A closed or dropped socket's silence is the retry's or the close's to tell. */
  private stopQuietWatch(): void {
    if (this.quietPoll !== null) clearInterval(this.quietPoll);
    this.quietPoll = null;
    this.quiet = false;
  }

  private watchOpening(socket: WebSocket): void {
    this.clearDeadline();
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.closed || this.socket !== socket) return;
      // A broken link may never finish its close handshake. Detach it before retrying so queued
      // events cannot act on the replacement connection.
      this.socket = null;
      this.stopQuietWatch();
      socket.close();
      this.scheduleRetry();
    }, CONNECT_TIMEOUT_MS);
  }

  private scheduleRetry(): void {
    const inMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempt);
    this.attempt++;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (!this.closed) this.open();
    }, inMs);
    this.options.onRetry?.(this.attempt, inMs, this.now() - this.heardAt);
  }
}
