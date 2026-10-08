import { LINK_QUIET_MS, RelaySocket } from '@open-northland/net-client';
import type { ClientMessage } from '@open-northland/net-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The relay's close codes, as the socket must read them. */
const CLOSE_ABNORMAL = 1006;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_REPLACED = 4000;
const CLOSE_SERVICE_RESTART = 1012;

class FakeSocket {
  readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closedByClient = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
  }

  open(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  drop(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const HELLO: ClientMessage = { kind: 'hello', protocol: 1, token: 'token-0123456789abcdef', nick: 'Ania' };

function harness(onRetry?: () => void) {
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  const received: unknown[] = [];
  /** How long the relay had been quiet at each retry. */
  const quiet: number[] = [];
  const socket = new RelaySocket({
    url: 'ws://relay.test',
    onOpen: () => events.push('open'),
    onMessage: (raw) => received.push(raw),
    onClosed: (reason) => events.push(`closed:${reason}`),
    onRetry: (attempt, inMs, quietMs) => {
      events.push(`retry:${attempt}:${inMs}`);
      quiet.push(quietMs);
      onRetry?.();
    },
    onQuiet: (quietMs) => events.push(`quiet:${quietMs}`),
    onHeard: () => events.push('heard'),
    createSocket: () => {
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake as unknown as WebSocket;
    },
    now: () => Date.now(),
  });
  return { socket, sockets, events, received, quiet };
}

describe('RelaySocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens, reports the connection, and sends JSON text frames', () => {
    const { socket, sockets, events } = harness();
    const [first] = sockets;
    expect(socket.send(HELLO)).toBe(false);
    first?.open();
    expect(events).toEqual(['open']);
    expect(socket.send(HELLO)).toBe(true);
    expect(first?.sent).toEqual([JSON.stringify(HELLO)]);
  });

  it('parses text frames and ignores what is not JSON or not text', () => {
    const { sockets, received } = harness();
    const [first] = sockets;
    first?.open();
    first?.deliver('{"kind":"welcome"}');
    first?.deliver('not json');
    first?.deliver(new ArrayBuffer(4));
    expect(received).toEqual([{ kind: 'welcome' }]);
  });

  it('comes back after a drop with a growing wait and reports each opening', () => {
    const { socket, sockets, events } = harness();
    sockets[0]?.open();
    sockets[0]?.drop(CLOSE_ABNORMAL);
    expect(socket.connected).toBe(false);
    expect(events).toEqual(['open', 'retry:1:1000']);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1]?.drop(CLOSE_ABNORMAL);
    expect(events.at(-1)).toBe('retry:2:2000');
    vi.advanceTimersByTime(2000);
    sockets[2]?.open();
    expect(socket.connected).toBe(true);
    expect(events.at(-1)).toBe('open');
  });

  it('reports an open link quiet once nothing arrived for the quiet limit, and heard again', () => {
    const { socket, sockets, events } = harness();
    sockets[0]?.open();
    vi.advanceTimersByTime(LINK_QUIET_MS - 1000);
    sockets[0]?.deliver('{"kind":"ping","t":1}');
    // Heard within the limit: the silence counts from the message.
    vi.advanceTimersByTime(LINK_QUIET_MS - 1000);
    expect(events).toEqual(['open']);
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(['open', `quiet:${LINK_QUIET_MS}`]);
    // Said once; the socket stays open for whatever is still arriving.
    vi.advanceTimersByTime(LINK_QUIET_MS * 3);
    expect(events).toEqual(['open', `quiet:${LINK_QUIET_MS}`]);
    expect(socket.connected).toBe(true);
    expect(sockets[0]?.closedByClient).toBe(false);
    sockets[0]?.deliver('{"kind":"ping","t":2}');
    expect(events).toEqual(['open', `quiet:${LINK_QUIET_MS}`, 'heard']);
    // Quiet again on its own clock from the last message.
    vi.advanceTimersByTime(LINK_QUIET_MS);
    expect(events.at(-1)).toBe(`quiet:${LINK_QUIET_MS}`);
  });

  it('says how long the relay had been quiet when a socket drops', () => {
    const { sockets, events, quiet } = harness();
    sockets[0]?.open();
    sockets[0]?.deliver('{"kind":"ping","t":1}');
    vi.advanceTimersByTime(300);
    sockets[0]?.drop(CLOSE_ABNORMAL);
    expect(quiet).toEqual([300]);
    // A dropped socket's silence is the retry's to tell: the quiet watch ends with it.
    vi.advanceTimersByTime(LINK_QUIET_MS * 2);
    expect(events).toEqual(['open', 'retry:1:1000']);
    const quietFor = LINK_QUIET_MS * 3;
    sockets[1]?.open();
    vi.advanceTimersByTime(quietFor);
    sockets[1]?.drop(CLOSE_ABNORMAL);
    expect(events.slice(2)).toEqual(['open', `quiet:${LINK_QUIET_MS}`, 'retry:1:1000']);
    expect(quiet).toEqual([300, quietFor]);
  });

  it('retries a connection attempt that never opens or closes', () => {
    const { socket, sockets, events } = harness();
    vi.advanceTimersByTime(10_000);
    expect(sockets[0]?.closedByClient).toBe(true);
    expect(events).toEqual(['retry:1:1000']);
    vi.advanceTimersByTime(1000);
    sockets[1]?.open();
    expect(socket.connected).toBe(true);
    sockets[0]?.open();
    sockets[0]?.drop(CLOSE_ABNORMAL);
    expect(events).toEqual(['retry:1:1000', 'open']);
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not time out an open socket while a large message is still arriving', () => {
    const { socket, sockets, events, received } = harness();
    sockets[0]?.open();
    // Browser sockets expose no progress event; only the completed message reaches onmessage.
    vi.advanceTimersByTime(60_000);
    sockets[0]?.deliver('{"kind":"blob","bytes":"AAAA"}');
    expect(socket.connected).toBe(true);
    expect(sockets[0]?.closedByClient).toBe(false);
    // The wait reads as a quiet link meanwhile, and the message ends it.
    expect(events).toEqual(['open', `quiet:${LINK_QUIET_MS}`, 'heard']);
    expect(received).toEqual([{ kind: 'blob', bytes: 'AAAA' }]);
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays closed once the relay replaced or refused the connection', () => {
    for (const code of [CLOSE_REPLACED, CLOSE_PROTOCOL_ERROR]) {
      const { sockets, events } = harness();
      sockets[0]?.open();
      sockets[0]?.drop(code, 'told why');
      vi.advanceTimersByTime(60_000);
      expect(sockets).toHaveLength(1);
      expect(events.at(-1)).toBe('closed:told why');
    }
  });

  it('stays closed after the relay restarts, but retries a restart some proxy reported', () => {
    const restarted = harness();
    restarted.sockets[0]?.open();
    restarted.sockets[0]?.drop(CLOSE_SERVICE_RESTART, 'serverRestart');
    vi.advanceTimersByTime(60_000);
    expect(restarted.sockets).toHaveLength(1);
    expect(restarted.events.at(-1)).toBe('closed:serverRestart');

    const proxied = harness();
    proxied.sockets[0]?.open();
    proxied.sockets[0]?.drop(CLOSE_SERVICE_RESTART, '');
    vi.advanceTimersByTime(60_000);
    expect(proxied.sockets.length).toBeGreaterThan(1);
  });

  it('closes for good on request and cancels a pending retry', () => {
    const { socket, sockets, events } = harness();
    sockets[0]?.open();
    sockets[0]?.drop(CLOSE_ABNORMAL);
    socket.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(events.at(-1)).toBe('closed:closed');
    expect(socket.send(HELLO)).toBe(false);
  });

  it('leaves no retry timer when the retry notification closes the connection', () => {
    const { socket, sockets, events } = harness(() => socket.close());
    sockets[0]?.open();
    sockets[0]?.drop(CLOSE_ABNORMAL);
    expect(events).toEqual(['open', 'retry:1:1000', 'closed:closed']);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});

it('ignores queued events from a closed or superseded socket', () => {
  const { socket, sockets, events, received } = harness();
  const first = sockets[0];
  socket.close();
  first?.open();
  first?.deliver('{"kind":"welcome"}');
  expect(events).toEqual(['closed:closed']);
  expect(received).toEqual([]);
});
