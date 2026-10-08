import { RelaySocket } from '@open-northland/net-client';
import { startRelayHost } from '@open-northland/net-server';
import { type GroupDestination, playerCommand, restoreSimulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { expectRouted, map, members, world } from './support/army-world.js';
import { HeadlessClient } from './support/headless-client.js';

const STEP_TIMEOUT_MS = 10_000;
const POLL_MS = 10;

it('carries a 1000-soldier move, paused redirects and a reconnect through real WebSockets', async () => {
  const host = await startRelayHost({ port: 0, host: '127.0.0.1' });
  const links: RelaySocket[] = [];
  const sockets: WebSocket[] = [];
  const opens = [0, 0];
  const finalClosures: string[] = [];
  const clients = ['Ania', 'Bartek'].map(
    (nick) =>
      new HeadlessClient({
        token: `army-socket-${nick}-0123456789`,
        nick,
        buildWorld: async () => world(),
        restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent(), map }),
      }),
  );
  const [a, b] = clients;
  if (a === undefined || b === undefined) throw new Error('missing army clients');
  const applied = new Map<HeadlessClient, number[]>();
  const stepped = new Map<HeadlessClient, number[]>();
  const checkApplied = (client: HeadlessClient): void => {
    const sim = client.sim;
    if (sim === null) return;
    const sequence = stepped.get(client) ?? [];
    sequence.push(sim.tick);
    stepped.set(client, sequence);
    const current = sim.commands.log.filter(
      (entry) =>
        entry.applyTick === sim.tick &&
        (entry.command.kind === 'moveUnitGroup' || entry.command.kind === 'attackMoveUnitGroup'),
    );
    if (current.length === 0) return;
    const ticks = applied.get(client) ?? [];
    ticks.push(...current.map((entry) => entry.applyTick));
    applied.set(client, ticks);
    const final = current.at(-1)?.command;
    if (final?.kind === 'moveUnitGroup' || final?.kind === 'attackMoveUnitGroup')
      expectRouted(sim, final.members);
  };
  const until = async (what: string, condition: () => boolean, step = true): Promise<void> => {
    const deadline = performance.now() + STEP_TIMEOUT_MS;
    let previous = performance.now();
    while (!condition()) {
      if (performance.now() > deadline) throw new Error(`army sockets timed out: ${what}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const now = performance.now();
      if (step) for (const client of clients) client.advance(now - previous, () => checkApplied(client));
      previous = now;
      await Promise.all(clients.map((client) => client.settled()));
    }
  };
  try {
    for (const [index, client] of clients.entries()) {
      const link = new RelaySocket({
        url: `ws://127.0.0.1:${host.port}`,
        createSocket: (url) => {
          const socket = new WebSocket(url);
          sockets[index] = socket;
          return socket;
        },
        onOpen: () => {
          opens[index] = (opens[index] ?? 0) + 1;
          client.hello();
        },
        onMessage: (message) => client.receive(message),
        onClosed: (reason) => finalClosures.push(reason),
      });
      links.push(link);
      client.attach((message) => {
        link.send(message);
      });
    }
    await until('welcome', () => clients.every((client) => client.welcomed));
    a.createRoom(
      {
        name: 'army sockets',
        world: { kind: 'scene', sceneId: 'fixture' },
        seed: 7,
        rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
        speed: 2,
      },
      clients.map((_, player) => ({ player, mode: 'idle', offers: ['idle', 'ai'], color: player })),
    );
    await until('room', () => a.room !== null);
    b.joinRoom(a.room?.id ?? '');
    await until('both members', () => a.room?.members.length === 2);
    clients.forEach((client, seat) => {
      client.claimSeat(seat);
    });
    await until(
      'seats and compatibility',
      () =>
        a.room?.seats.every((seat) => seat.nick !== null) === true &&
        a.room.members.every((member) => member.compatibility !== null),
    );
    for (const client of clients) client.setReady(true);
    await until('ready', () => a.room?.seats.every((seat) => seat.ready) === true);
    a.start();
    await until('worlds', () => clients.every((client) => client.sim !== null && client.clockState !== null));
    if (a.sim === null) throw new Error('army world missing');
    const first = members(a.sim, 100);
    const move = playerCommand(0, { kind: 'moveUnitGroup', members: first });
    expect(Buffer.byteLength(JSON.stringify(move))).toBeGreaterThan(16 * 1024);
    a.submit(move);
    await until('first complete army move', () =>
      clients.every((client) => applied.get(client)?.length === 1),
    );
    a.setPaused(true);
    await until('paused and drained', () =>
      clients.every((client) => client.paused && client.bufferedTicks === 0),
    );
    expect(a.tick).toBe(b.tick);
    expect(a.sim.hashState()).toBe(b.sim?.hashState());
    const pauseTick = a.tick;
    if (pauseTick === null) throw new Error('no paused tick');

    const redirect: readonly GroupDestination[] = members(a.sim, 130);
    a.submit(playerCommand(0, { kind: 'moveUnitGroup', members: members(a.sim, 110) }));
    a.submit(playerCommand(0, { kind: 'attackMoveUnitGroup', members: redirect }));
    const save = await a.captureSave();
    const pending = save.sections.find((section) => section.id === 'commands')?.continuation;
    expect(pending).toHaveLength(2);
    expect(pending?.map(({ applyTick }) => applyTick)).toEqual([
      pending?.[0]?.applyTick,
      pending?.[0]?.applyTick,
    ]);
    expect(pending?.map(({ envelope }) => envelope.command.kind)).toEqual([
      'moveUnitGroup',
      'attackMoveUnitGroup',
    ]);
    const restored = restoreSimulation(save, { content: testContent(), map });

    const clocksBefore = b.clockNotices.length;
    sockets[1]?.close();
    await until(
      'automatic reconnect and readmission',
      () =>
        (opens[1] ?? 0) >= 2 &&
        b.clockNotices.length > clocksBefore &&
        a.waitingFor.length === 0 &&
        clients.every((client) => client.paused && client.bufferedTicks === 0),
    );
    expect(b.session?.localSeat).toBe(1);
    expect(a.tick).toBe(pauseTick);
    expect(b.tick).toBe(pauseTick);
    a.setPaused(false);

    const target = pauseTick + 12;
    const captures = new Map<HeadlessClient, string>();
    const deadline = performance.now() + STEP_TIMEOUT_MS;
    let previous = performance.now();
    while (captures.size < clients.length) {
      if (performance.now() > deadline) throw new Error('army clients did not reach the capture tick');
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const now = performance.now();
      for (const client of clients)
        if (!captures.has(client))
          client.advance(now - previous, () => {
            checkApplied(client);
            if (client.tick === target && client.sim !== null) captures.set(client, client.sim.hashState());
          });
      previous = now;
      await Promise.all(clients.map((client) => client.settled()));
    }
    restored.run(target - restored.tick);
    for (const client of clients) {
      expect(captures.get(client)).toBe(restored.hashState());
      expect(applied.get(client)).toHaveLength(3);
      expect(applied.get(client)?.slice(1)).toEqual([pending?.[0]?.applyTick, pending?.[0]?.applyTick]);
      if (client.sim === null) throw new Error('lost army world');
      expectRouted(client.sim, redirect);
      expect(client.rejections).toEqual([]);
      expect(client.errors).toEqual([]);
      expect(client.desyncs).toEqual([]);
      expect(stepped.get(client)?.slice(0, target)).toEqual(
        Array.from({ length: target }, (_, index) => index + 1),
      );
    }
    expect(finalClosures).toEqual([]);
    expect(opens).toEqual([1, 2]);
  } finally {
    for (const link of links) link.close();
    await host.close();
  }
}, 60_000);
