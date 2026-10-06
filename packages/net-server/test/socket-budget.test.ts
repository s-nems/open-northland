import { MAX_BLOB_MESSAGE_BYTES } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  BYTE_BURST,
  BYTES_PER_SECOND,
  ControlPings,
  MAX_BUFFERED_BYTES,
  MESSAGE_BURST,
  MESSAGES_PER_SECOND,
  RecoveryBudget,
  SocketBudget,
  sendBounded,
} from '../src/host/socket-budget.js';

describe('socket traffic budgets', () => {
  it('reserves bounded credits for matching control pongs without spending the game message allowance', () => {
    const pings = new ControlPings();
    const budget = new SocketBudget(0);
    const issued: Buffer[] = [];
    for (let i = 0; i < MESSAGE_BURST; i++) {
      const challenge = pings.request();
      if (challenge === null) throw new Error('missing control ping');
      issued.push(challenge);
    }
    expect(pings.request()).toBeNull();
    expect(pings.answer(Buffer.from('unsolicited'))).toBe(false);
    for (const challenge of issued) {
      const cost = pings.answer(challenge) ? 0 : 1;
      expect(cost).toBe(0);
      expect(budget.take(challenge.length, 0, cost)).toBe(true);
    }
    const [challenge] = issued;
    if (challenge === undefined) throw new Error('missing control ping');
    expect(pings.answer(challenge)).toBe(false);
    for (let i = 0; i < MESSAGE_BURST; i++) expect(budget.take(1, 0)).toBe(true);
    expect(budget.take(1, 0)).toBe(false);
    const next = pings.request();
    if (next === null) throw new Error('missing control ping');
    expect(pings.answer(next)).toBe(true);
    expect(budget.take(BYTE_BURST, 0, 0)).toBe(false);
  });

  it('retires coalesced pings cumulatively and refuses duplicate, old or unissued pong credits', () => {
    const pings = new ControlPings();
    let first: Buffer | null = null;
    let last: Buffer | null = null;
    for (let i = 0; i < MESSAGE_BURST; i++) {
      last = pings.request();
      first ??= last;
    }
    if (first === null || last === null) throw new Error('missing control ping');
    const future = Buffer.from(last);
    future.writeBigUInt64BE(BigInt(MESSAGE_BURST + 1), future.length - 8);
    expect(pings.answer(future)).toBe(false);
    expect(pings.request()).toBeNull();
    expect(pings.answer(last)).toBe(true);
    expect(pings.answer(last)).toBe(false);
    expect(pings.answer(first)).toBe(false);
    for (let i = 0; i < MESSAGE_BURST; i++) expect(pings.request()).not.toBeNull();
    expect(pings.request()).toBeNull();
  });

  it('shares the recovery burst across request kinds without charging normal game traffic', () => {
    const budget = new RecoveryBudget(0);
    for (const kind of ['loaded', 'loaded', 'saveOrders', 'requestInitialSave'])
      expect(budget.take({ kind }, 0)).toBe(true);
    for (const kind of ['loaded', 'saveOrders', 'requestInitialSave'])
      expect(budget.take({ kind }, 0)).toBe(false);
    for (let i = 0; i < 1000; i++) expect(budget.take({ kind: 'ack' }, 1000)).toBe(true);
    expect(budget.take({ kind: 'loaded' }, 1999)).toBe(false);
    expect(budget.take({ kind: 'loaded' }, 2000)).toBe(true);
    expect(budget.take({ kind: 'loaded' }, 2000)).toBe(false);
    for (let i = 0; i < 4; i++) expect(budget.take({ kind: 'loaded' }, 100_000)).toBe(true);
    expect(budget.take({ kind: 'loaded' }, 100_000)).toBe(false);
  });

  it('limits a tiny-message flood and replenishes by elapsed time', () => {
    const budget = new SocketBudget(0);
    for (let i = 0; i < MESSAGE_BURST; i++) expect(budget.take(1, 0)).toBe(true);
    expect(budget.take(1, 0)).toBe(false);
    for (let i = 0; i < MESSAGES_PER_SECOND; i++) expect(budget.take(1, 1000)).toBe(true);
    expect(budget.take(1, 1000)).toBe(false);
  });

  it('allows two maximum snapshots but bounds repeated blob uploads independently of message count', () => {
    const budget = new SocketBudget(0);
    expect(budget.take(MAX_BLOB_MESSAGE_BYTES, 0)).toBe(true);
    expect(budget.take(MAX_BLOB_MESSAGE_BYTES, 0)).toBe(true);
    expect(budget.take(1, 0)).toBe(false);
    expect(budget.take(BYTES_PER_SECOND, 1000)).toBe(true);
    expect(budget.take(1, 1000)).toBe(false);
    expect(budget.take(BYTE_BURST + 1, 1e9)).toBe(false);
  });

  it('disconnects a slow recipient before growing its output queue, counting UTF-8 bytes', () => {
    const slow = {
      OPEN: 1 as const,
      readyState: 1 as const,
      bufferedAmount: MAX_BUFFERED_BYTES - 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
    };
    const healthy = { ...slow, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    for (const socket of [slow, healthy]) sendBounded(socket, 'ą');
    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledWith('ą');
    expect(healthy.ping).not.toHaveBeenCalled();
    expect(healthy.terminate).not.toHaveBeenCalled();
  });

  it.each([
    { text: 'a', headroom: 0 },
    { text: 'a'.repeat(128 * 1024 + 1), headroom: 20 },
  ])(
    'reserves frame and control bytes before starting an output message ($headroom spare bytes)',
    ({ text, headroom }) => {
      const socket = {
        OPEN: 1 as const,
        readyState: 1 as const,
        bufferedAmount: MAX_BUFFERED_BYTES - Buffer.byteLength(text) - headroom,
        send: vi.fn(),
        ping: vi.fn(),
        terminate: vi.fn(),
      };
      sendBounded(socket, text);
      expect(socket.terminate).toHaveBeenCalledOnce();
      expect(socket.send).not.toHaveBeenCalled();
      expect(socket.ping).not.toHaveBeenCalled();
    },
  );

  it('keeps control pings flowing inside a large text message without splitting its UTF-8 contents', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no socket address');
    const connected = new Promise<WebSocket>((resolve) => server.once('connection', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    try {
      const socket = await connected;
      const events: string[] = [];
      client.on('ping', () => events.push('ping'));
      const pong = new Promise<void>((resolve) => socket.once('pong', () => resolve()));
      const received = new Promise<{ text: string; binary: boolean }>((resolve) => {
        client.once('message', (data, binary) => {
          events.push('message');
          resolve({ text: data.toString(), binary });
        });
      });
      // A fragment ends inside a four-byte UTF-8 character.
      const text = 'x'.repeat(512 * 1024 - 1) + '🛶ą'.repeat(100_000);
      sendBounded(socket, text);
      expect(await received).toEqual({ text, binary: false });
      expect(events[0]).toBe('ping');
      expect(events.at(-1)).toBe('message');
      await pong;
    } finally {
      client.terminate();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});
