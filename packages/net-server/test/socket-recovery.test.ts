import { connect, createServer, type Socket } from 'node:net';
import { RelaySocket } from '@open-northland/net-client';
import { startRelayHost } from '@open-northland/net-server';
import { restoreSimulation, Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';

/** A paused TCP reader lets the kernel coalesce traffic without changing WebSocket messages. */
async function upstreamGate(target: number) {
  const sockets = new Set<Socket>();
  let incoming: Socket | null = null;
  const server = createServer((client) => {
    const upstream = connect(target, '127.0.0.1');
    incoming = client;
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing proxy address');
  return {
    url: `ws://127.0.0.1:${address.port}`,
    pause: () => incoming?.pause(),
    resume: () => incoming?.resume(),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function until(condition: () => boolean, advance: readonly HeadlessClient[] = [], timeout = 20_000) {
  const deadline = performance.now() + timeout;
  let before = performance.now();
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('socket recovery timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const now = performance.now();
    for (const client of advance) client.advance(now - before);
    before = now;
  }
}

it('recovers when a stalled upload releases a valid catch-up acknowledgement burst', async () => {
  const host = await startRelayHost({ port: 0, host: '127.0.0.1' });
  const gate = await upstreamGate(host.port);
  const finalClosures: string[] = [];
  const opens = [0, 0];
  const links: RelaySocket[] = [];
  const clients = ['Ania', 'Bartek'].map(
    (nick) =>
      new HeadlessClient({
        nick,
        token: `burst-recovery-${nick}-0123456789`,
        buildWorld: async () => new Simulation({ seed: 3, content: testContent() }),
        restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent() }),
      }),
  );
  const [a, b] = clients;
  if (a === undefined || b === undefined) throw new Error('missing clients');
  try {
    for (const [i, client] of clients.entries()) {
      const link = new RelaySocket({
        url: i === 0 ? `ws://127.0.0.1:${host.port}` : gate.url,
        onOpen: () => {
          opens[i] = (opens[i] ?? 0) + 1;
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
    await until(() => clients.every((client) => client.welcomed));
    a.createRoom(
      {
        name: 'catch-up burst',
        world: { kind: 'scene', sceneId: 'fixture' },
        seed: 3,
        rules: { fog: null, progression: null, needs: null, weather: null },
        speed: 8,
      },
      clients.map((_, player) => ({ player, mode: 'idle', offers: ['idle', 'ai'], color: player })),
    );
    await until(() => a.room !== null);
    b.joinRoom(a.room?.id ?? '');
    await until(() => a.room?.members.length === 2);
    for (const [i, client] of clients.entries()) client.claimSeat(i);
    await until(
      () =>
        a.room?.seats.every((seat) => seat.nick !== null) === true &&
        a.room.members.every((member) => member.compatibility !== null),
    );
    for (const client of clients) client.setReady(true);
    await until(() => a.room?.seats.every((seat) => seat.ready) === true);
    a.start();
    await until(() => clients.every((client) => client.sim !== null));
    await until(() => b.bufferedTicks >= 800, [a]);

    gate.pause();
    const firstTick = b.tick ?? 0;
    await until(() => (b.tick ?? 0) - firstTick >= 700, clients);
    expect((b.tick ?? 0) - firstTick).toBeGreaterThan(512);
    gate.resume();
    await until(() => finalClosures.length > 0 || (opens[1] ?? 0) > 1, clients);
    expect([...finalClosures]).toEqual([]);
    expect(opens[1]).toBeGreaterThan(1);

    const target = Math.max(...clients.map((client) => client.tick ?? 0)) + 200;
    const captures = new Map<HeadlessClient, string>();
    const deadline = performance.now() + 20_000;
    let before = performance.now();
    while (captures.size < 2) {
      if (performance.now() > deadline) throw new Error('reconnected clients did not catch up');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const now = performance.now();
      for (const client of clients)
        if (!captures.has(client))
          client.advance(now - before, () => {
            if (client.tick === target && client.sim !== null) captures.set(client, client.sim.hashState());
          });
      before = now;
    }
    expect(captures.get(a)).toBe(captures.get(b));
    for (const client of clients) {
      expect(client.rejections).toEqual([]);
      expect(client.errors).toEqual([]);
      expect(client.desyncs).toEqual([]);
    }
  } finally {
    for (const link of links) link.close();
    await gate.close();
    await host.close();
  }
}, 60_000);
