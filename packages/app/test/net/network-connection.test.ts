import type { GameSession } from '@open-northland/lockstep';
import { RelayRefusal } from '@open-northland/net-client';
import { PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../../src/i18n/index.js';
import { type NetWorldPort, NetworkConnection } from '../../src/net/connection.js';
import type { FromNetWorker, RelayFacts, ToNetWorker } from '../../src/session/worker/net-protocol.js';
import type { SessionPort } from '../../src/session/worker/port.js';

const ROOM: RoomView = {
  id: 'r',
  state: 'lobby',
  creator: 'Ania',
  settings: {
    name: 'Room',
    world: { kind: 'map', mapId: 'forest' },
    seed: 1,
    rules: { fog: null, progression: null, needs: null, weather: null },
    speed: 1,
  },
  seats: [
    { player: 0, mode: 'human', offers: ['idle', 'ai', 'absent'], color: 0, nick: 'Ania', ready: true },
  ],
  members: [
    {
      nick: 'Ania',
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
const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null },
  speed: 1,
};
const FACTS: RelayFacts = {
  tick: 7,
  paused: true,
  speed: 2,
  bufferedTicks: 3,
  droppedTicks: 0,
  clickToApplyMs: 120,
  resultTick: null,
  endedTick: null,
  isOutOfSync: false,
  worldId: 1,
};

/** The network worker's end as the test plays it: what the connection posted, and a way to answer. */
function fakeWorker() {
  const posted: ToNetWorker<unknown>[] = [];
  let receive: (message: unknown, receiveMs: number) => void = () => undefined;
  const close = vi.fn();
  const port: SessionPort = {
    post: (message) => posted.push(message as ToNetWorker<unknown>),
    listen: (listener) => {
      receive = listener;
    },
    listenFailure: () => undefined,
    close,
  };
  return {
    port,
    posted,
    close,
    send: (message: FromNetWorker<unknown>) => receive(message, 0),
    kinds: () => posted.map((message) => message.kind),
  };
}

function connect(worker = fakeWorker()) {
  const connection = new NetworkConnection(
    'ws://example.test',
    { token: 'token-0123456789abcdef', nick: 'Ania' },
    () => worker.port,
  );
  return { connection, worker };
}

/** Lets the connection's awaited world port run. */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('network connection mirror', () => {
  it('connects on construction and follows the relay messages and facts the worker forwards', () => {
    const { connection, worker } = connect();
    expect(worker.posted[0]).toEqual({
      kind: 'connect',
      url: 'ws://example.test',
      token: 'token-0123456789abcdef',
      nick: 'Ania',
    });
    const events: string[] = [];
    connection.subscribe((event) => events.push(event.kind === 'message' ? event.message.kind : event.kind));
    worker.send({ kind: 'link', state: 'ok' });
    worker.send({
      kind: 'message',
      message: { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania (2)' },
    });
    worker.send({ kind: 'message', message: { kind: 'room', room: ROOM } });
    worker.send({ kind: 'facts', facts: FACTS });
    const { client } = connection;
    expect(connection.connected).toBe(true);
    expect([client.nick, client.welcomed, client.room?.id]).toEqual(['Ania (2)', true, 'r']);
    expect([client.tick, client.paused, client.speed, client.bufferedTicks, client.worldId]).toEqual([
      7,
      true,
      2,
      3,
      1,
    ]);
    expect(client.latency.clickToApplyMs).toBe(120);
    expect(events).toEqual(['link', 'welcome', 'room']);
  });

  it('requests a shared mode and displays only the relay-confirmed selection', () => {
    const { connection, worker } = connect();
    connection.client.setResponsiveness('responsive');
    expect(worker.posted.at(-1)).toEqual({ kind: 'responsiveness', mode: 'responsive' });
    expect(connection.client.responsiveness).toEqual({ mode: 'auto', bufferTicks: 2, by: null });
    const selected = {
      kind: 'responsiveness' as const,
      mode: 'responsive' as const,
      bufferTicks: 1,
      by: 'Bartek',
    };
    worker.send({ kind: 'message', message: selected });
    expect(connection.client.responsiveness).toEqual(selected);
    worker.send({ kind: 'message', message: { kind: 'left' } });
    expect(connection.client.responsiveness).toEqual({ mode: 'auto', bufferTicks: 2, by: null });
  });

  it('posts lobby actions and clock requests by name for the worker client to perform', () => {
    const { connection, worker } = connect();
    connection.client.joinRoom('r');
    connection.client.setSeat(0, { mode: 'ai' });
    connection.client.setSpeed(2);
    expect(worker.posted.slice(1)).toEqual([
      { kind: 'lobby', name: 'joinRoom', args: ['r'] },
      { kind: 'lobby', name: 'setSeat', args: [0, { mode: 'ai' }] },
      { kind: 'clock', speed: 2 },
    ]);
  });

  it('resets on a dropped link before announcing it, and a lobby room is left after the drop is heard', () => {
    const { connection, worker } = connect();
    const seen: string[] = [];
    connection.subscribe((event) => {
      if (event.kind === 'message') seen.push(event.message.kind);
      else if (event.kind === 'link') {
        seen.push(event.state);
        expect([connection.client.welcomed, connection.client.room]).toEqual([false, null]);
      }
    });
    worker.send({ kind: 'link', state: 'ok' });
    worker.send({ kind: 'message', message: { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' } });
    worker.send({ kind: 'message', message: { kind: 'room', room: ROOM } });
    worker.send({ kind: 'link', state: 'reconnecting' });
    expect(seen).toEqual(['ok', 'welcome', 'room', 'reconnecting', 'left']);
    // The worker's client left on its own retry.
    expect(worker.posted.at(-1)?.kind).toBe('connect');
  });

  it('keeps a started room over a dropped link, since the relay holds the seat', () => {
    const { connection, worker } = connect();
    const seen: string[] = [];
    connection.subscribe((event) => {
      if (event.kind === 'message') seen.push(event.message.kind);
    });
    worker.send({ kind: 'message', message: { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' } });
    worker.send({ kind: 'message', message: { kind: 'room', room: { ...ROOM, state: 'running' } } });
    worker.send({ kind: 'link', state: 'reconnecting' });
    expect(connection.client.welcomed).toBe(false);
    expect(connection.client.room?.id).toBe('r');
    expect(seen).toEqual(['welcome', 'room']);
  });

  it('asks a started room for its seat back on the welcome after a drop, and takes being in it quietly', () => {
    const { connection, worker } = connect();
    const seen: string[] = [];
    connection.subscribe((event) => seen.push(event.kind === 'message' ? event.message.kind : event.kind));
    worker.send({ kind: 'message', message: { kind: 'room', room: { ...ROOM, state: 'running' } } });
    worker.send({ kind: 'link', state: 'reconnecting' });
    worker.send({ kind: 'message', message: { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' } });
    expect(worker.posted.at(-1)).toEqual({ kind: 'lobby', name: 'joinRoom', args: ['r'] });
    worker.send({
      kind: 'message',
      message: { kind: 'rejected', of: 'joinRoom', reason: { code: 'alreadyInRoom' } },
    });
    expect(seen).toEqual(['room', 'link', 'welcome']);
    expect(connection.client.room?.id).toBe('r');
  });

  it('ends the game and leaves the room when the room refuses the seat back after a drop', () => {
    const { connection, worker } = connect();
    const events: string[] = [];
    connection.subscribe((event) => {
      if (event.kind === 'failure') events.push(`${event.what}: ${String(event.error)}`);
      else if (event.kind === 'message') events.push(event.message.kind);
    });
    worker.send({ kind: 'message', message: { kind: 'room', room: { ...ROOM, state: 'running' } } });
    worker.send({ kind: 'link', state: 'reconnecting' });
    worker.send({ kind: 'message', message: { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' } });
    worker.send({
      kind: 'message',
      message: { kind: 'rejected', of: 'joinRoom', reason: { code: 'gameStarted' } },
    });
    expect(events).toEqual(['room', 'welcome', `room: Error: ${messages().net.removedWhileAway}`, 'left']);
    expect(connection.client.room).toBeNull();
    // A lobby room is left on the drop itself; nothing is asked for it.
    worker.send({ kind: 'message', message: { kind: 'room', room: ROOM } });
    worker.send({ kind: 'link', state: 'reconnecting' });
    worker.send({ kind: 'message', message: { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' } });
    expect(worker.posted.filter((message) => message.kind === 'lobby')).toHaveLength(1);
  });

  it('leaves on disposal unless told to keep the seat, and ends the worker once it closed', () => {
    vi.useFakeTimers();
    for (const leave of [true, false]) {
      const { connection, worker } = connect();
      worker.send({ kind: 'message', message: { kind: 'room', room: ROOM } });
      connection.dispose(leave);
      expect(worker.posted.at(-1)).toEqual({ kind: 'leave', leave });
      expect(connection.client.room).toBeNull();
      expect(worker.close).not.toHaveBeenCalled();
      if (leave) worker.send({ kind: 'closed' });
      else vi.runAllTimers();
      expect(worker.close).toHaveBeenCalledOnce();
    }
  });

  it('reports a failure that ends the game and only logs one the link carries', () => {
    const { connection, worker } = connect();
    const failures: { what: string; error: unknown }[] = [];
    connection.subscribe((event) => {
      if (event.kind === 'failure') failures.push({ what: event.what, error: event.error });
    });
    const error = { name: 'Error', message: 'no map', stack: undefined };
    worker.send({ kind: 'failure', what: 'command', error });
    worker.send({ kind: 'failure', what: 'restore', error });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.what).toBe('restore');
    expect(String(failures[0]?.error)).toMatch(/no map/);
  });

  it('keeps the last link state and its close reason for a late subscriber', () => {
    const { connection, worker } = connect();
    expect(connection.linkState).toBeNull();
    worker.send({ kind: 'link', state: 'ok' });
    expect(connection.linkState).toEqual({ state: 'ok' });
    worker.send({ kind: 'link', state: 'closed', reason: 'gameStarted' });
    expect(connection.connected).toBe(false);
    expect(connection.linkState).toEqual({ state: 'closed', reason: 'gameStarted' });
  });

  it('rebuilds a relay refusal with its coded reason', () => {
    const { connection, worker } = connect();
    const failures: unknown[] = [];
    connection.subscribe((event) => {
      if (event.kind === 'failure') failures.push(event.error);
    });
    worker.send({
      kind: 'failure',
      what: 'open',
      error: { name: 'RelayRefusal', message: 'refused', stack: undefined, refusal: { code: 'noSnapshot' } },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(RelayRefusal);
    expect(failures[0]).toMatchObject({ reason: { code: 'noSnapshot' } });
  });

  it('answers the digests request from the worker', async () => {
    const { connection, worker } = connect();
    const digests = connection.digests();
    const request = worker.posted.at(-1);
    if (request?.kind !== 'request') throw new Error('expected a request');
    expect(request.request).toEqual({ method: 'digests' });
    worker.send({ kind: 'answer', id: request.id, ok: true, value: [] });
    await expect(digests).resolves.toEqual([]);
  });
});

describe('network connection world requests', () => {
  it('holds a request until a port is bound, and refuses it with null inputs when the port hosts none', async () => {
    const { connection, worker } = connect();
    worker.send({ kind: 'openWorld', requestId: 4, session: SESSION, snapshotTick: 12 });
    await turn();
    expect(worker.kinds()).not.toContain('worldInputs');
    const open = vi.fn(async () => undefined);
    connection.bindWorld({ open, restore: async () => undefined }, vi.fn());
    await turn();
    expect(open).toHaveBeenCalledWith(SESSION, 12, expect.any(Function));
    expect(worker.posted.at(-1)).toEqual({ kind: 'worldInputs', requestId: 4, world: null });
  });

  it('hands a port failure before any hosting back to the worker client', async () => {
    const { connection, worker } = connect();
    const port: NetWorldPort = {
      open: async () => {
        throw new Error('The session and verified map differ');
      },
      restore: async () => undefined,
    };
    connection.bindWorld(port, vi.fn());
    worker.send({ kind: 'openWorld', requestId: 0, session: SESSION, snapshotTick: null });
    await turn();
    expect(worker.posted.at(-1)).toMatchObject({
      kind: 'worldFailed',
      requestId: 0,
      error: { message: 'The session and verified map differ' },
    });
  });

  it('posts the hosted inputs, and settles quietly when the worker client does not adopt the world', async () => {
    const { connection, worker } = connect();
    const failures: unknown[] = [];
    connection.subscribe((event) => {
      if (event.kind === 'failure') failures.push(event.error);
    });
    const onWorld = vi.fn();
    const hosted: Promise<unknown>[] = [];
    connection.bindWorld(
      {
        open: async (_session, _tick, host) => {
          const session = host({ saveText: null } as never, { speed: 1 } as never);
          hosted.push(session);
          await session;
        },
        restore: async () => undefined,
      },
      onWorld,
    );
    worker.send({ kind: 'openWorld', requestId: 2, session: SESSION, snapshotTick: null });
    await turn();
    expect(worker.posted.at(-1)).toEqual({
      kind: 'worldInputs',
      requestId: 2,
      world: { boot: { saveText: null }, options: { speed: 1 } },
    });
    worker.send({ kind: 'unadopted', requestId: 2 });
    await expect(hosted[0]).rejects.toThrow(/did not adopt/);
    await turn();
    expect(onWorld).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  it('never calls a port bound after disposal', async () => {
    const { connection, worker } = connect();
    worker.send({ kind: 'openWorld', requestId: 0, session: SESSION, snapshotTick: null });
    connection.dispose();
    const open = vi.fn(async () => undefined);
    connection.bindWorld({ open, restore: async () => undefined }, vi.fn());
    await turn();
    expect(open).not.toHaveBeenCalled();
    expect(worker.kinds()).not.toContain('worldInputs');
  });
});
