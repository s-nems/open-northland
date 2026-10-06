import type { RelayLinkEvents } from '@open-northland/net-client';
import { type ClientMessage, PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { NetworkConnection } from '../../src/net/connection.js';
import { deliveredMatchEnd } from '../../src/net/net-worker-client.js';
import type { FromNetWorker, ToNetWorker } from '../../src/session/worker/net-protocol.js';
import { serveRelay } from '../../src/session/worker/net-serve.js';
import type { SessionPort } from '../../src/session/worker/port.js';

const ENDED_TICK = 50;
const NICK = 'Ania';
const LOBBY: RoomView = {
  id: 'r',
  state: 'lobby',
  creator: NICK,
  settings: {
    name: 'Room',
    world: { kind: 'map', mapId: 'forest' },
    seed: 1,
    rules: { fog: null, progression: null, needs: null, weather: null },
    speed: 1,
  },
  seats: [{ player: 0, mode: 'human', offers: ['idle', 'ai', 'absent'], color: 0, nick: NICK, ready: true }],
  members: [
    {
      nick: NICK,
      seat: 0,
      connected: true,
      compatibility: null,
      load: null,
      loading: null,
      roundTripMs: null,
      delayTicks: null,
      behindTicks: 0,
    },
  ],
};

/** One end of a port: what was posted to the other end, and a way to hand this end a message. */
function fakePort<In, Out>() {
  const posted: Out[] = [];
  let receive: (message: unknown, receiveMs: number) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const port: SessionPort = {
    post: (message) => posted.push(message as Out),
    listen: (listener) => {
      receive = listener;
    },
    listenFailure: (listener) => {
      fail = listener;
    },
    close: vi.fn(),
  };
  return { port, posted, send: (message: In) => receive(message, 0), crash: (error: Error) => fail(error) };
}

it('reports the confirmed match end only once the runtime delivered its tick', () => {
  const client = { endedTick: ENDED_TICK };
  expect(deliveredMatchEnd(client, { tick: ENDED_TICK - 2 })).toBeNull();
  expect(deliveredMatchEnd(client, { tick: ENDED_TICK })).toBe(ENDED_TICK);
  expect(deliveredMatchEnd({ endedTick: null }, { tick: ENDED_TICK })).toBeNull();
});

/** The worker end serving a relay link the test plays. */
function servedRelay() {
  const worker = fakePort<ToNetWorker<never>, FromNetWorker<never>>();
  const sent: ClientMessage[] = [];
  let events: RelayLinkEvents | null = null;
  const socket = { connected: false };
  serveRelay(
    worker.port,
    () => {
      throw new Error('no world in this test');
    },
    (_url, linkEvents) => {
      events = linkEvents;
      return {
        get connected() {
          return socket.connected;
        },
        send: (message) => {
          if (socket.connected) sent.push(message);
          return socket.connected;
        },
        close: () => {
          socket.connected = false;
        },
      };
    },
  );
  worker.send({ kind: 'connect', url: 'ws://example.test', token: 'token-0123456789abcdef', nick: NICK });
  const link = (): RelayLinkEvents => {
    if (events === null) throw new Error('the worker opened no link');
    return events;
  };
  const open = (): void => {
    socket.connected = true;
    link().onOpen();
    link().onMessage({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: NICK });
  };
  return { worker, sent, socket, link, open };
}

it('leaves the lobby room on the worker as soon as its link drops, not when the runtime answers', () => {
  const { worker, sent, socket, link, open } = servedRelay();
  open();
  link().onMessage({ kind: 'room', room: LOBBY });
  socket.connected = false;
  link().onRetry?.(1, 0);
  expect(worker.posted.at(-1)).toEqual({ kind: 'link', state: 'reconnecting' });
  // Back and welcomed before the runtime saw the drop: the client sits in no room to leave.
  open();
  worker.send({ kind: 'leave', leave: true });
  expect(sent.map((message) => message.kind)).not.toContain('leaveRoom');
});

it('posts a relay refusal as a failure that keeps its coded reason across the worker', () => {
  const { worker, link, open } = servedRelay();
  open();
  link().onMessage({ kind: 'rejected', of: 'loaded', reason: { code: 'noSnapshot' } });
  const failure = worker.posted.find((message) => message.kind === 'failure');
  expect(failure).toMatchObject({
    what: 'open',
    error: { name: 'RelayRefusal', refusal: { code: 'noSnapshot' } },
  });
});

describe('pending network worker answers', () => {
  function connect() {
    const worker = fakePort<FromNetWorker<never>, ToNetWorker<never>>();
    const connection = new NetworkConnection(
      'ws://example.test',
      { token: 'token-0123456789abcdef', nick: NICK },
      () => worker.port,
    );
    return { connection, worker };
  }

  it('reject when the connection is disposed', async () => {
    const { connection } = connect();
    const digests = connection.digests();
    connection.dispose(false);
    await expect(digests).rejects.toThrow(/closed/);
    await expect(connection.digests()).rejects.toThrow(/closed/);
  });

  it('reject when the worker fails', async () => {
    const { connection, worker } = connect();
    worker.send({ kind: 'link', state: 'ok' });
    const event = vi.fn();
    connection.subscribe(event);
    const digests = connection.digests();
    worker.crash(new Error('worker crashed'));
    await expect(digests).rejects.toThrow(/worker crashed/);
    await expect(connection.digests()).rejects.toThrow(/worker crashed/);
    expect(connection.connected).toBe(false);
    expect(connection.linkState).toEqual({ state: 'closed' });
    expect(event).toHaveBeenCalledExactlyOnceWith({
      kind: 'failure',
      what: 'worker',
      error: expect.objectContaining({ message: 'worker crashed' }),
    });
    const postedBefore = worker.posted.length;
    connection.client.listRooms();
    worker.send({ kind: 'link', state: 'ok' });
    worker.crash(new Error('duplicate failure'));
    connection.dispose(false);
    expect(connection.connected).toBe(false);
    expect(worker.posted).toHaveLength(postedBefore);
    expect(worker.port.close).toHaveBeenCalledTimes(1);
  });

  it('reject when the worker closes', async () => {
    const { connection, worker } = connect();
    const digests = connection.digests();
    worker.send({ kind: 'link', state: 'closed', reason: 'serverRestart' });
    worker.send({ kind: 'closed' });
    await expect(digests).rejects.toThrow(/closed/);
    await expect(connection.digests()).rejects.toThrow(/closed/);
    expect(connection.linkState).toEqual({ state: 'closed', reason: 'serverRestart' });
    connection.dispose(false);
    expect(worker.port.close).toHaveBeenCalledTimes(1);
  });

  it('terminates an unresponsive worker once even if its goodbye arrives after the grace period', () => {
    vi.useFakeTimers();
    try {
      const { connection, worker } = connect();
      connection.dispose(false);
      vi.advanceTimersByTime(2000);
      worker.send({ kind: 'closed' });
      expect(worker.port.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('passes shared responsiveness requests and confirmations through the network worker', () => {
  const { worker, sent, link, open } = servedRelay();
  open();
  worker.send({ kind: 'responsiveness', mode: 'smooth' });
  expect(sent.at(-1)).toEqual({ kind: 'responsiveness', mode: 'smooth' });
  const selected = { kind: 'responsiveness' as const, mode: 'smooth' as const, bufferTicks: 3, by: 'Ania' };
  link().onMessage(selected);
  expect(worker.posted).toContainEqual({ kind: 'message', message: selected });
  worker.send({ kind: 'leave', leave: false });
});
