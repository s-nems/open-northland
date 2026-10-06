import { randomUUID } from 'node:crypto';
import { connect as connectTcp } from 'node:net';
import type { GameSession } from '@open-northland/lockstep';
import { CLOSE_SERVICE_RESTART, PROTOCOL_VERSION, type RoomSettings } from '@open-northland/net-protocol';
import { HEALTH_PATH, type RelayHost, startRelayHost } from '@open-northland/net-server';
import {
  type Command,
  playerCommand,
  restoreSimulation,
  type SaveGame,
  Simulation,
} from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';

/**
 * The WebSocket host over a real socket: what the in-memory tests prove, once, through the wire.
 * `ON_RELAY_URL=wss://…` points the same run at a deployed relay instead of a host started here.
 */

const REMOTE_URL = process.env.ON_RELAY_URL;

const SETTINGS: RoomSettings = {
  name: 'socket',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  rules: { fog: null, progression: null, needs: null, weather: null },
  speed: 1,
};
const RUN_TICKS = 24;
const POLL_MS = 10;
const STEP_TIMEOUT_MS = 5000;
const SESSION_TIMEOUT_MS = 30_000;

async function buildWorld(session: GameSession): Promise<Simulation> {
  return new Simulation({ seed: session.seed, content: testContent() });
}

async function restoreWorld(_session: GameSession, save: SaveGame): Promise<Simulation> {
  return restoreSimulation(save, { content: testContent() });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + STEP_TIMEOUT_MS;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(POLL_MS);
  }
}

interface Target {
  readonly url: string;
  readonly host: RelayHost | null;
}

async function target(): Promise<Target> {
  if (REMOTE_URL !== undefined) return { url: REMOTE_URL, host: null };
  const host = await startRelayHost({ port: 0 });
  return { url: `ws://127.0.0.1:${host.port}`, host };
}

/** The health endpoint beside the WebSocket: the same origin over plain HTTP. */
function healthUrl(url: string): string {
  const http = new URL(url);
  http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
  http.pathname = HEALTH_PATH;
  return http.toString();
}

async function connect(url: string, nick: string): Promise<{ client: HeadlessClient; socket: WebSocket }> {
  const socket = new WebSocket(url);
  const client = new HeadlessClient({
    token: `${nick.toLowerCase()}-${randomUUID()}`,
    nick,
    buildWorld,
    restoreWorld,
  });
  socket.addEventListener('message', (event) => client.receive(JSON.parse(String(event.data))));
  client.attach((message) => socket.send(JSON.stringify(message)));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket failed to open')));
  });
  return { client, socket };
}

describe('websocket host', () => {
  let host: RelayHost | null = null;
  afterEach(async () => {
    await host?.close();
    host = null;
  });

  it.each([2, 8])(
    'plays a session between %i clients over real sockets',
    async (count) => {
      const relay = await target();
      host = relay.host;
      const connections: Awaited<ReturnType<typeof connect>>[] = [];
      try {
        for (let i = 0; i < count; i++) connections.push(await connect(relay.url, `Player${i}`));
        const clients = connections.map(({ client }) => client);
        const creator = clients[0];
        if (creator === undefined) throw new Error('missing creator');
        for (const client of clients) client.hello();
        await until(() => clients.every((client) => client.welcomed), 'welcome');
        creator.createRoom(
          SETTINGS,
          clients.map((_, player) => ({ player, mode: 'idle', offers: ['idle', 'ai'], color: player })),
        );
        await until(() => creator.room !== null, 'the room');
        const roomId = creator.room?.id ?? '';
        for (const client of clients.slice(1)) client.joinRoom(roomId);
        await until(() => creator.room?.members.length === count, 'the joins');
        for (const [player, client] of clients.entries()) client.claimSeat(player);
        await until(() => creator.room?.seats.every((seat) => seat.nick !== null) === true, 'the seats');
        // Compatibility arrives independently on each connection; readiness waits for every report.
        await until(
          () => creator.room?.members.every((member) => member.compatibility !== null) === true,
          'compatibility',
        );
        for (const client of clients) client.setReady(true);
        await until(() => creator.room?.seats.every((seat) => seat.ready) === true, 'readiness');
        creator.start();
        await until(() => clients.every((client) => client.session !== null), 'the start');
        await Promise.all(clients.map((client) => client.settled()));
        await until(() => clients.every((client) => client.clockNotices.length > 0), 'the clock');

        const captures = new Map<
          HeadlessClient,
          { hash: string; orders: readonly (readonly [number, number, Command])[] }
        >();
        let last = performance.now();
        const deadline = last + SESSION_TIMEOUT_MS;
        while (captures.size < clients.length) {
          await sleep(POLL_MS);
          const now = performance.now();
          if (now > deadline) throw new Error('clients did not finish the socket session');
          const elapsed = now - last;
          last = now;
          for (const client of clients) {
            if (captures.has(client)) continue;
            client.advance(elapsed, () => {
              const sim = client.sim;
              if (sim === null) return;
              const seat = client.session?.localSeat;
              if (typeof seat === 'number' && sim.tick === 8) {
                for (let order = 0; order < 10; order++) {
                  client.submit(
                    playerCommand(seat, {
                      kind: 'setAssistantCounter',
                      player: seat,
                      counter: 'extraMen',
                      value: 100_000 + order,
                      infinite: false,
                    }),
                  );
                }
              }
              if (typeof seat === 'number' && sim.tick % count === seat) {
                client.submit(
                  playerCommand(seat, {
                    kind: 'setAssistantCounter',
                    player: seat,
                    counter: 'extraMen',
                    value: sim.tick,
                    infinite: false,
                  }),
                );
              }
              if (sim.tick === RUN_TICKS)
                captures.set(client, {
                  hash: sim.hashState(),
                  orders: sim.commands.log.map((entry) => [entry.applyTick, entry.sequence, entry.command]),
                });
            });
          }
        }
        const reference = captures.get(creator);
        expect(reference).toBeDefined();
        expect(creator.sim?.commands.log.length).toBeGreaterThan(0);
        for (const client of clients) {
          expect(captures.get(client), client.nick).toEqual(reference);
          expect(client.errors, client.nick).toEqual([]);
          expect(client.rejections, client.nick).toEqual([]);
          expect(client.desyncs, client.nick).toEqual([]);
          for (let seat = 0; seat < count; seat++) {
            expect(
              captures
                .get(client)
                ?.orders.flatMap(([, , command]) =>
                  command.kind === 'setAssistantCounter' &&
                  command.player === seat &&
                  command.value >= 100_000
                    ? [command.value]
                    : [],
                ),
              `${client.nick}: burst from seat ${seat}`,
            ).toEqual(Array.from({ length: 10 }, (_, order) => 100_000 + order));
          }
        }
        const orderedSeats = new Set(
          creator.sim?.commands.log.flatMap(({ command }) =>
            command.kind === 'setAssistantCounter' ? [command.player] : [],
          ),
        );
        expect(orderedSeats.size).toBe(count);
      } finally {
        for (const { socket } of connections) socket.close();
      }
    },
    SESSION_TIMEOUT_MS,
  );

  it('closes a connection that speaks before hello', async () => {
    const relay = await target();
    host = relay.host;
    const { client, socket } = await connect(relay.url, 'Cezary');
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener('close', resolve));
    client.say('hej');
    const event = await closed;
    expect(client.errors).toEqual([{ code: 'helloFirst' }]);
    expect(event.reason).toBe('helloFirst');
  });

  it.skipIf(REMOTE_URL !== undefined)('tells its clients it restarts when it shuts down', async () => {
    const local = await startRelayHost({ port: 0 });
    const { socket } = await connect(`ws://127.0.0.1:${local.port}`, 'Dorota');
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener('close', resolve));
    await local.close();
    const event = await closed;
    expect(event.code).toBe(CLOSE_SERVICE_RESTART);
    expect(event.reason).toBe('serverRestart');
  });

  it.skipIf(REMOTE_URL !== undefined)('survives a request target the URL parser would refuse', async () => {
    const relay = await target();
    host = relay.host;
    const port = new URL(relay.url).port;
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connectTcp(Number(port), '127.0.0.1', () => {
        socket.write('GET http://a:99999/ HTTP/1.1\r\nHost: relay\r\nConnection: close\r\n\r\n');
      });
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk.toString();
      });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
    expect(answer).toMatch(/^HTTP\/1\.1 404/);
    const response = await fetch(healthUrl(relay.url));
    expect(response.status).toBe(200);
  });

  it('answers the health check with what it speaks, and nothing else over plain HTTP', async () => {
    const relay = await target();
    host = relay.host;
    const response = await fetch(healthUrl(relay.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const health = await response.json();
    expect(health).toMatchObject({ ok: true, protocol: PROTOCOL_VERSION });
    expect(typeof health.rooms).toBe('number');
    expect(typeof health.clients).toBe('number');
    expect(typeof health.uptimeSeconds).toBe('number');
    const missing = await fetch(new URL('/no-such-path', healthUrl(relay.url)));
    expect(missing.status).toBe(404);
    if (relay.host !== null) expect(relay.host.health()).toMatchObject({ url: null, build: null });
  });
});
